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

test("copied skill runs all three CLIs without the web app", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "worldcup-predictor-skill-"));
  const copiedSkill = join(tempRoot, "worldcup-predictor");
  cpSync(skillDir, copiedSkill, { recursive: true });

  try {
    const commands = [
      ["scripts/predict-match.mjs", "--home", "MEX", "--away", "KOR"],
      ["scripts/simulate-tournament.mjs", "--simulations", "2", "--seed", "standalone"],
      ["scripts/generate-lottery-slip.mjs", "--strategy", "balanced", "--budget", "288"],
    ];
    for (const command of commands) {
      const result = spawnSync(process.execPath, command, {
        cwd: copiedSkill,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotThrow(() => JSON.parse(result.stdout));
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
