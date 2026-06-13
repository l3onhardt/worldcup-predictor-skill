import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as skillCore from "../core/index.mjs";
import {
  auditSnapshot,
  dataVersionFromSources,
  reviewedContextAdjustments,
} from "../scripts/audit-input.mjs";
import { auditMarketSnapshot } from "../scripts/market-input.mjs";
import { gammaEventToMarkets, manualToSnapshot } from "../scripts/fetch-market.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSample(name) {
  return JSON.parse(readFileSync(join(skillDir, "assets/sample-data", name), "utf8"));
}

function fixedMatchInput() {
  const snapshot = auditSnapshot(readSample("worldcup-2026.json"));
  return {
    snapshot,
    input: {
      matchId: "sample-group-a-1",
      homeTeam: snapshot.teams.find((team) => team.id === "MEX"),
      awayTeam: snapshot.teams.find((team) => team.id === "KOR"),
      stage: "group",
      modelVersion: snapshot.metadata.modelVersion,
      dataVersion: snapshot.metadata.dataVersion,
      generatedAt: snapshot.metadata.generatedAt,
      venueCountryCode: "MEX",
      contextAdjustments: snapshot.contextAdjustments,
    },
  };
}

test("repository contains the required skill and bilingual documentation", () => {
  for (const file of ["SKILL.md", "README.md", "README.en.md", "agents/openai.yaml", "LICENSE"]) {
    assert.equal(existsSync(join(skillDir, file)), true, `${file} is required`);
  }
});

test("skill is positioned as a trading-decision skill", () => {
  const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  const reportTemplate = readFileSync(join(skillDir, "references/research-report.md"), "utf8");
  const communication = readFileSync(join(skillDir, "references/communication-guidelines.md"), "utf8");

  assert.match(skill, /Asian handicap trader/i);
  assert.match(skill, /profit maximization/i);
  assert.match(skill, /Trading Decision Card/i);
  assert.match(reportTemplate, /交易决策卡/);
  assert.match(communication, /最大化长期收益/);
  assert.doesNotMatch(skill, /never make the final decision for the user/i);
  assert.doesNotMatch(reportTemplate, /不替用户选择/);
  assert.doesNotMatch(communication, /不替用户决策/);
});

test("primary skill surfaces do not conflict with trading positioning", () => {
  const files = [
    "SKILL.md",
    "README.md",
    "README.en.md",
    "docs/QUICK-REFERENCE.md",
    "references/research-report.md",
    "references/communication-guidelines.md",
    "agents/openai.yaml",
    "package.json",
    "scripts/predict-markets.mjs",
    "scripts/value-scan.mjs",
  ];
  const forbidden = [
    /Prediction Market Research Assistant/i,
    /research assistant/i,
    /研究助手/,
    /教育性(?:概率分析|研究工具|示例|参考|公式演示|资金管理)/,
    /educational (?:probability|examples|reference|risk scenarios|capital)/i,
    /not betting advice/i,
    /非投注建议/,
    /非购彩建议/,
    /不是购彩建议/,
    /不替用户决策/,
    /don't decide for them/i,
    /must make their own decisions/i,
    /免责声明/,
  ];

  for (const file of files) {
    const content = readFileSync(join(skillDir, file), "utf8");
    assert.match(content, /Trading Decision|trading-decision|trade decisions|trading scan|trade ranking|交易决策|Asian Handicap Trader|盘口交易员|profit maximization|最大化长期收益/i, file);
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern, `${file} contains stale positioning: ${pattern}`);
    }
  }
});

test("bundled core files match the published manifest", () => {
  const manifest = JSON.parse(readFileSync(join(skillDir, "core/manifest.json"), "utf8"));
  for (const [file, expectedHash] of Object.entries(manifest.files)) {
    const content = readFileSync(join(skillDir, "core", file));
    assert.equal(createHash("sha256").update(content).digest("hex"), expectedHash, file);
  }
});

test("venue country controls host advantage", () => {
  const { input } = fixedMatchInput();
  const neutral = skillCore.predictMatch({ ...input, venueCountryCode: undefined });
  const hosted = skillCore.predictMatch(input);
  assert.ok(hosted.homeWin90Prob > neutral.homeWin90Prob);
});

test("completed official-format results remain locked and invalid participants fail", () => {
  const snapshot = auditSnapshot(readSample("synthetic-48-team.json"));
  const result = skillCore.simulateTournament({
    teams: snapshot.teams,
    matchStates: snapshot.matchStates,
    simulationCount: 5,
    seed: "locked-results",
  });
  assert.equal(result.completedMatchCount, 73);
  assert.equal(result.groupRankProbabilities.A.T01, 1);
  assert.equal(result.teamStageProbabilities.find((team) => team.teamId === "T02")?.qualify16Prob, 1);

  const invalidStates = snapshot.matchStates.map((state) =>
    state.matchNumber === 73 ? { ...state, awayTeamId: "T07" } : state,
  );
  assert.throws(
    () => skillCore.simulateTournament({
      teams: snapshot.teams,
      matchStates: invalidStates,
      simulationCount: 1,
      seed: "invalid-locked-result",
    }),
    /participants do not match the resolved bracket/,
  );
});

test("90-minute and advancement result scopes stay separate", () => {
  const { input } = fixedMatchInput();
  const result = skillCore.predictMatch({ ...input, stage: "round_of_32" });
  assert.equal(result.resultScope, "90minResult");
  assert.equal(result.advanceResultScope, "advanceResult");
  assert.ok(result.homeAdvanceProb > result.homeWin90Prob);
});

test("unreviewed LLM adjustments cannot affect skill predictions", () => {
  const { input } = fixedMatchInput();
  const llmAdjustment = {
    id: "llm-only",
    derivation: "llm_extraction",
    scope: "team",
    type: "injury",
    target: "home",
    teamCode: "MEX",
    title: "Unreviewed LLM claim",
    impact: { attackMultiplier: 0.1 },
  };
  const filtered = reviewedContextAdjustments([llmAdjustment]);
  assert.deepEqual(filtered, []);
  assert.deepEqual(
    skillCore.predictMatch({ ...input, contextAdjustments: filtered }),
    skillCore.predictMatch({ ...input, contextAdjustments: [] }),
  );
});

test("audit-only facts do not change dataVersion", () => {
  const snapshot = readSample("worldcup-2026.json");
  const version = dataVersionFromSources(
    snapshot.metadata.sourceVersions,
    snapshot.metadata.strengthSnapshotVersion,
  );
  const changedAuditFacts = { ...snapshot, officialFacts: [{ id: "changed-audit-only-fact" }] };
  assert.equal(
    dataVersionFromSources(
      changedAuditFacts.metadata.sourceVersions,
      changedAuditFacts.metadata.strengthSnapshotVersion,
    ),
    version,
  );
});

test("audited snapshots reject incomplete or mixed strength versions", () => {
  const snapshot = readSample("worldcup-2026.json");
  assert.throws(
    () => auditSnapshot({ ...snapshot, teams: snapshot.teams.slice(1) }),
    /expectedTeamCount must equal teams.length/,
  );
  assert.throws(
    () => auditSnapshot({
      ...snapshot,
      teams: snapshot.teams.map((team, index) =>
        index === 0 ? { ...team, strengthVersion: "mixed-version" } : team,
      ),
    }),
    /does not use strength version/,
  );
});

test("dixon-coles rho is continuous in average lambda", () => {
  const { scoreDistribution } = skillCore;
  // 阶梯函数在档位边界会跳变；连续函数下相邻强度的 0-0 概率差应当很小
  const base = { id: "A", name: "A", ratingValue: 1700 };
  const nearLow = scoreDistribution({ ...base, goalsPerMatch: 0.92 }, { id: "B", name: "B", ratingValue: 1700, goalsPerMatch: 0.92 });
  const nearHigh = scoreDistribution({ ...base, goalsPerMatch: 0.93 }, { id: "B", name: "B", ratingValue: 1700, goalsPerMatch: 0.93 });
  const p00Low = nearLow.find((e) => e.home === 0 && e.away === 0).probability;
  const p00High = nearHigh.find((e) => e.home === 0 && e.away === 0).probability;
  assert.ok(Math.abs(p00Low - p00High) < 0.005);
});

test("knockout draw advancement is softer than pure rating projection", () => {
  const strong = { id: "S", name: "Strong", ratingValue: 1950 };
  const weak = { id: "W", name: "Weak", ratingValue: 1750 };
  const probability = skillCore.homeAdvanceAfterDrawProb(strong, weak);
  // 两段式建模：点球段接近五五开，整体应低于旧的 0.5 + delta*0.22 = 0.61
  assert.ok(probability > 0.5);
  assert.ok(probability < 0.61);
});

test("copied skill runs all bundled CLIs without the web app", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "worldcup-predictor-skill-"));
  const copiedSkill = join(tempRoot, "worldcup-predictor");
  cpSync(skillDir, copiedSkill, { recursive: true });

  try {
    const commands = [
      ["scripts/predict-match.mjs", "--home", "MEX", "--away", "KOR"],
      ["scripts/predict-markets.mjs", "--home", "MEX", "--away", "KOR"],
      ["scripts/value-scan.mjs", "--market", "assets/sample-data/market-snapshot.json"],
      ["scripts/simulate-tournament.mjs", "--simulations", "2", "--seed", "standalone"],
      ["scripts/generate-lottery-slip.mjs", "--strategy", "balanced", "--budget", "288"],
    ];
    for (const command of commands) {
      const result = spawnSync(process.execPath, command, {
        cwd: copiedSkill,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      if (["scripts/predict-markets.mjs", "scripts/value-scan.mjs", "scripts/generate-lottery-slip.mjs"].includes(command[0])) {
        assert.equal(parsed.disclaimer, undefined, `${command[0]} should use tradingNote instead of disclaimer`);
        assert.ok(parsed.tradingNote, `${command[0]} should expose tradingNote`);
      }
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("market snapshot audit accepts valid input and rejects bad prices", () => {
  const valid = auditMarketSnapshot(readSample("market-snapshot.json"));
  assert.equal(valid.markets[0].type, "1x2");
  assert.ok(valid.markets[0].overround > 1);
  assert.throws(
    () => auditMarketSnapshot({ source: "manual", fetchedAt: "2026-06-04T12:00:00.000Z", markets: [{ matchId: "x", type: "1x2", outcomes: [{ name: "3", price: 0.9 }, { name: "0", price: 2 }] }] }),
    /price/,
  );
  assert.throws(() => auditMarketSnapshot({ source: "manual", markets: [] }), /fetchedAt/);
});

test("manual odds convert to a market snapshot with implied probabilities", () => {
  const snapshot = manualToSnapshot({
    fetchedAt: "2026-06-04T12:00:00.000Z",
    matches: [
      {
        matchId: "sample-group-a-1",
        homeName: "Mexico",
        awayName: "South Korea",
        odds: { "3": 2.3, "1": 3.2, "0": 3.1 },
      },
    ],
  });
  assert.equal(snapshot.source, "manual");
  const market = snapshot.markets[0];
  assert.equal(market.type, "1x2");
  const homeOutcome = market.outcomes.find((outcome) => outcome.name === "3");
  assert.ok(Math.abs(homeOutcome.impliedProb - 1 / 2.3) < 1e-4);
});

test("gamma outright event transforms into one outright market", () => {
  const event = {
    slug: "2026-fifa-world-cup-winner",
    markets: [
      { id: "m1", groupItemTitle: "France", outcomes: '["Yes","No"]', outcomePrices: '["0.18","0.82"]' },
      { id: "m2", groupItemTitle: "Brazil", outcomes: '["Yes","No"]', outcomePrices: '["0.15","0.85"]' },
    ],
  };
  const markets = gammaEventToMarkets(event);
  assert.equal(markets.length, 1);
  assert.equal(markets[0].type, "outright");
  assert.equal(markets[0].outcomes.length, 2);
  assert.ok(Math.abs(markets[0].outcomes[0].impliedProb - 0.18) < 1e-9);
  assert.ok(markets[0].outcomes[0].price > 5.5);
});

test("value scan blends devigged market with model and reports divergence", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/value-scan.mjs", "--market", "assets/sample-data/market-snapshot.json"],
    { cwd: skillDir, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.fallback, undefined);
  assert.equal(report.matches.length, 1);
  const match = report.matches[0];
  assert.equal(match.resultScope, "90minResult");
  const blendedSum = match.blended90Prob["3"] + match.blended90Prob["1"] + match.blended90Prob["0"];
  assert.ok(Math.abs(blendedSum - 1) < 1e-6);
  assert.equal(match.divergence.length, 3);
  for (const outcome of match.valueMetrics) {
    assert.ok(Number.isFinite(outcome.ev));
    assert.ok(outcome.kellyFraction >= 0 && outcome.kellyFraction <= 0.1);
  }
  assert.ok(typeof report.marketAgeHours === "number");
});

test("predict-match with --market blends probabilities and stays unchanged without it", () => {
  const plain = spawnSync(
    process.execPath,
    ["scripts/predict-match.mjs", "--home", "MEX", "--away", "KOR", "--match", "sample-group-a-1"],
    { cwd: skillDir, encoding: "utf8" },
  );
  const withMarket = spawnSync(
    process.execPath,
    [
      "scripts/predict-match.mjs", "--home", "MEX", "--away", "KOR", "--match", "sample-group-a-1",
      "--market", "assets/sample-data/market-snapshot.json",
    ],
    { cwd: skillDir, encoding: "utf8" },
  );
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(withMarket.status, 0, withMarket.stderr);
  const plainResult = JSON.parse(plain.stdout);
  const marketResult = JSON.parse(withMarket.stdout);
  assert.equal(plainResult.marketBlend, undefined);
  assert.ok(marketResult.marketBlend);
  assert.equal(marketResult.marketBlend.fallback, undefined);
  // 不带 --market 的字段保持完全不变
  assert.equal(marketResult.homeWin90Prob, plainResult.homeWin90Prob);
  const sum =
    marketResult.marketBlend.blended90Prob["3"] +
    marketResult.marketBlend.blended90Prob["1"] +
    marketResult.marketBlend.blended90Prob["0"];
  assert.ok(Math.abs(sum - 1) < 1e-6);
});

test("lottery slip without market data is identical to model-only behaviour", () => {
  const issue = readSample("lottery-issue.json");
  const slip = skillCore.generateBettingSlip({ issue, strategy: "balanced", generatedAt: issue.generatedAt });
  for (const selection of slip.selections) {
    assert.equal(selection.probabilitySource, "model_only");
  }
});

test("lottery slip blends market310 probabilities when present", () => {
  const issue = readSample("lottery-issue.json");
  const blendedIssue = {
    ...issue,
    matches: issue.matches.map((match, index) =>
      index === 0
        ? { ...match, market310: { "3": 0.55, "1": 0.25, "0": 0.2 } }
        : match,
    ),
  };
  const slip = skillCore.generateBettingSlip({ issue: blendedIssue, strategy: "balanced", generatedAt: issue.generatedAt });
  const first = slip.selections.find((selection) => selection.matchId === issue.matches[0].matchId);
  assert.equal(first.probabilitySource, "blended");
  // market 0.55 / model 0.38, weight 0.7 → 0.7*0.55 + 0.3*0.38 = 0.499
  assert.ok(Math.abs(first.probabilities["3"] - 0.499) < 1e-3);
});

test("firewall: market-like sources are rejected from fundamental sourceVersions", () => {
  const snapshot = readSample("worldcup-2026.json");
  for (const bad of ["polymarket", "betting-odds", "market-snapshot"]) {
    const polluted = {
      ...snapshot,
      metadata: {
        ...snapshot.metadata,
        sourceVersions: { ...snapshot.metadata.sourceVersions, [bad]: "hash" },
      },
    };
    assert.throws(() => auditSnapshot(polluted), /market data must stay in the market pipeline/i, bad);
  }
});

test("blend output always preserves the pure model column", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/value-scan.mjs", "--market", "assets/sample-data/market-snapshot.json"],
    { cwd: skillDir, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const match = JSON.parse(result.stdout).matches[0];
  assert.ok(match.model90Prob);
  assert.ok(match.blended90Prob);
  assert.notDeepEqual(match.model90Prob, match.blended90Prob);
});

test("gamma match event with three binary markets assembles a 1x2 market", () => {
  const event = {
    slug: "fifwc-mex-rsa-2026-06-11",
    markets: [
      { id: "m1", groupItemTitle: "Mexico", outcomes: '["Yes","No"]', outcomePrices: '["0.685","0.315"]' },
      { id: "m2", groupItemTitle: "Draw (Mexico vs. South Africa)", outcomes: '["Yes","No"]', outcomePrices: '["0.205","0.795"]' },
      { id: "m3", groupItemTitle: "South Africa", outcomes: '["Yes","No"]', outcomePrices: '["0.105","0.895"]' },
    ],
  };
  const markets = gammaEventToMarkets(event, { matchId: "sample-group-a-1", home: "Mexico", away: "South Africa" });
  assert.equal(markets.length, 1);
  assert.equal(markets[0].type, "1x2");
  assert.equal(markets[0].matchId, "sample-group-a-1");
  const byName = Object.fromEntries(markets[0].outcomes.map((outcome) => [outcome.name, outcome]));
  assert.ok(Math.abs(byName["3"].impliedProb - 0.685) < 1e-9);
  assert.ok(Math.abs(byName["1"].impliedProb - 0.205) < 1e-9);
  assert.ok(Math.abs(byName["0"].impliedProb - 0.105) < 1e-9);
});
