# 世界杯预测机 v0.3 市场升级实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 worldcup-predictor skill 增加多盘口定价（亚盘/大小球/BTTS）、Polymarket 与手填赔率的市场快照通路、去水+加权融合+分歧报告+EV/Kelly 价值识别，并修缮 Dixon-Coles ρ 与点球晋级模型，core 升级到 v0.3.0。

**Architecture:** 保持「审计快照 → 确定性核心 → CLI 输出 JSON」骨架。新增 `core/markets.mjs`（从比分矩阵推导全部盘口）与 `core/odds.mjs`（赔率处理/融合/价值）两个纯函数模块；网络请求只存在于 `scripts/fetch-market.mjs`，拉取结果落盘为带时间戳的市场快照，核心计算保持 100% 离线确定性。

**Tech Stack:** Node.js >= 20，零依赖 ESM，`node --test` 单测。

**对照设计文档:** `docs/superpowers/specs/2026-06-11-market-upgrade-design.md`

---

## 文件结构总览

| 文件 | 动作 | 职责 |
|---|---|---|
| `core/markets.mjs` | 新建 | 比分矩阵 → 净胜球/总进球分布、亚盘（含 quarter 拆盘）、大小球、BTTS、公平赔率 |
| `core/odds.mjs` | 新建 | 赔率格式互转、去水（power/proportional）、加权融合、分歧报告、EV/分数 Kelly |
| `core/match.mjs` | 修改 | 连续 Dixon-Coles ρ；两段式（加时+点球）平局晋级概率 |
| `core/version.mjs` | 修改 | 0.3.0 / `model-v0.3-market` |
| `core/betting.mjs` | 修改 | 期次带 `market310` 时按融合概率选 3/1/0 |
| `core/index.mjs` | 修改 | 导出新模块 |
| `core/manifest.json` | 重新生成 | 文件哈希清单 |
| `scripts/update-core-manifest.mjs` | 新建 | 重新生成 manifest（core 在本仓库迭代后的配套工具） |
| `scripts/market-input.mjs` | 新建 | 市场快照校验（auditMarketSnapshot） |
| `scripts/fetch-market.mjs` | 新建 | Polymarket Gamma 拉取 + 手填赔率转换 → 市场快照 |
| `scripts/predict-markets.mjs` | 新建 | 单场全盘口定价 CLI |
| `scripts/value-scan.mjs` | 新建 | 市场 vs 模型：去水、融合、分歧、EV/Kelly 扫描 CLI |
| `scripts/predict-match.mjs` | 修改 | 可选 `--market` 输出融合概率与分歧 |
| `assets/sample-data/market-snapshot.json` | 新建 | 烟测用市场快照样例 |
| `tests/markets.test.mjs` | 新建 | markets 模块单测 |
| `tests/odds.test.mjs` | 新建 | odds 模块单测 |
| `tests/skill.test.mjs` | 修改 | 模型修缮、融合清单、新 CLI 独立运行测试 |
| `references/market-methodology.md` | 新建 | 市场方法论文档 |
| `references/data-schema.md` | 修改 | 市场快照 schema |
| `SKILL.md` / `README.md` / `README.en.md` | 修改 | 工作流与能力描述 |
| `package.json` | 修改 | 0.3.0 + smoke 扩展 |

约定：所有新概率输出挂 `90minResult` 口径；EV/Kelly 仅为分析参考，沿用现有免责声明；`llm_extraction` 过滤规则不变。

---

### Task 1: core/markets.mjs — 多盘口定价引擎

**Files:**
- Create: `core/markets.mjs`
- Test: `tests/markets.test.mjs`

- [ ] **Step 1: Write the failing tests**

创建 `tests/markets.test.mjs`：

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  asianHandicap,
  bothTeamsToScore,
  goalDifferenceDistribution,
  overUnder,
  priceMatchMarkets,
  totalGoalsDistribution,
} from "../core/markets.mjs";
import { scoreDistribution } from "../core/match.mjs";

const home = { id: "FRA", name: "France", ratingValue: 1900, formScore: 60 };
const away = { id: "BRA", name: "Brazil", ratingValue: 1850, formScore: 58 };

function distribution() {
  return scoreDistribution(home, away);
}

test("goal difference and total goals distributions sum to 1", () => {
  const dist = distribution();
  const diffSum = goalDifferenceDistribution(dist).reduce((s, e) => s + e.probability, 0);
  const totalSum = totalGoalsDistribution(dist).reduce((s, e) => s + e.probability, 0);
  assert.ok(Math.abs(diffSum - 1) < 1e-9);
  assert.ok(Math.abs(totalSum - 1) < 1e-9);
});

test("integer handicap exposes push and win/lose complement", () => {
  const diffs = goalDifferenceDistribution(distribution());
  const ah = asianHandicap(diffs, -1);
  assert.ok(ah.home.push > 0);
  assert.ok(Math.abs(ah.home.fullWin + ah.home.push + ah.home.fullLose - 1) < 1e-9);
  assert.equal(ah.home.halfWin, 0);
  assert.equal(ah.home.halfLose, 0);
});

test("quarter handicap splits into half win/lose components", () => {
  const diffs = goalDifferenceDistribution(distribution());
  const ah = asianHandicap(diffs, -0.25);
  assert.ok(ah.home.halfLose > 0);
  const mass =
    ah.home.fullWin + ah.home.halfWin + ah.home.push + ah.home.halfLose + ah.home.fullLose;
  assert.ok(Math.abs(mass - 1) < 1e-9);
  // -0.25 = 一半注 0 球盘（可走盘）+ 一半注 -0.5：不存在整注走盘
  assert.equal(ah.home.push, 0);
});

test("home and away sides of the same line are consistent", () => {
  const diffs = goalDifferenceDistribution(distribution());
  const ah = asianHandicap(diffs, -0.5);
  // 半球盘无走盘：双方胜率互补
  assert.ok(Math.abs(ah.home.fullWin + ah.away.fullWin - 1) < 1e-9);
  assert.ok(ah.home.fairOdds > 1);
  assert.ok(ah.away.fairOdds > 1);
});

test("over/under probabilities complement at half lines", () => {
  const totals = totalGoalsDistribution(distribution());
  const ou = overUnder(totals, 2.5);
  assert.ok(Math.abs(ou.over.fullWin + ou.under.fullWin - 1) < 1e-9);
  assert.equal(ou.over.push, 0);
});

test("over/under integer line pushes on exact total", () => {
  const totals = totalGoalsDistribution(distribution());
  const ou = overUnder(totals, 2);
  const exactlyTwo = totals.find((e) => e.total === 2)?.probability ?? 0;
  assert.ok(Math.abs(ou.over.push - exactlyTwo) < 1e-9);
});

test("btts yes/no sums to 1", () => {
  const btts = bothTeamsToScore(distribution());
  assert.ok(Math.abs(btts.yes + btts.no - 1) < 1e-9);
});

test("priceMatchMarkets returns a coherent 90minResult market book", () => {
  const book = priceMatchMarkets({ homeTeam: home, awayTeam: away, matchId: "fra-bra" });
  assert.equal(book.resultScope, "90minResult");
  const { homeWin90Prob, draw90Prob, awayWin90Prob } = book.oneXTwo;
  assert.ok(Math.abs(homeWin90Prob + draw90Prob + awayWin90Prob - 1) < 1e-6);
  assert.equal(book.asianHandicaps.length, 21);
  assert.equal(book.overUnders.length, 21);
  // 同一比分矩阵推导，自洽性检查：-0.5 亚盘主胜 == 1X2 主胜
  const halfLine = book.asianHandicaps.find((e) => e.line === -0.5);
  assert.ok(Math.abs(halfLine.home.fullWin - homeWin90Prob) < 1e-9);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/markets.test.mjs`
Expected: FAIL（`core/markets.mjs` 不存在）

- [ ] **Step 3: Write the implementation**

创建 `core/markets.mjs`：

```js
// prediction-core v0.3.0 — maintained in this repository (worldcup-predictor-skill).
import { applyContextAdjustments, expectedGoals, scoreDistribution } from "./match.mjs";
import { round, teamKey } from "./utils.mjs";

const AH_LINES = Array.from({ length: 21 }, (_, index) => (index - 10) / 4); // -2.5 .. 2.5 step 0.25
const OU_LINES = Array.from({ length: 21 }, (_, index) => 0.5 + index * 0.25); // 0.5 .. 5.5 step 0.25

function withVenueHostFlag(team, venueCountryCode) {
  if (!venueCountryCode) return team;
  return { ...team, isHost: team.countryCode === venueCountryCode };
}

export function goalDifferenceDistribution(distribution) {
  const diffs = new Map();
  for (const entry of distribution) {
    const difference = entry.home - entry.away;
    diffs.set(difference, (diffs.get(difference) ?? 0) + entry.probability);
  }
  return [...diffs.entries()]
    .sort(([left], [right]) => left - right)
    .map(([difference, probability]) => ({ difference, probability }));
}

export function totalGoalsDistribution(distribution) {
  const totals = new Map();
  for (const entry of distribution) {
    const total = entry.home + entry.away;
    totals.set(total, (totals.get(total) ?? 0) + entry.probability);
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left - right)
    .map(([total, probability]) => ({ total, probability }));
}

// 对单条非 quarter 盘口线判定投注结果。margin 为下注方视角的净胜球，line 为其让球数（负数=让球）。
function singleLineOutcome(margin, line) {
  const adjusted = margin + line;
  if (adjusted > 0) return "win";
  if (adjusted === 0) return "push";
  return "lose";
}

function isQuarterLine(line) {
  return Math.abs((line * 4) % 2) === 1;
}

// margins: [{ margin, probability }]，已换算为下注方视角。
function sideOutcomes(margins, line) {
  const result = { fullWin: 0, halfWin: 0, push: 0, halfLose: 0, fullLose: 0 };
  if (!isQuarterLine(line)) {
    for (const { margin, probability } of margins) {
      const outcome = singleLineOutcome(margin, line);
      if (outcome === "win") result.fullWin += probability;
      else if (outcome === "push") result.push += probability;
      else result.fullLose += probability;
    }
    return result;
  }
  const lower = line - 0.25;
  const upper = line + 0.25;
  for (const { margin, probability } of margins) {
    const a = singleLineOutcome(margin, lower);
    const b = singleLineOutcome(margin, upper);
    if (a === "win" && b === "win") result.fullWin += probability;
    else if (a === "lose" && b === "lose") result.fullLose += probability;
    else if (a === "push") result[b === "win" ? "halfWin" : "halfLose"] += probability;
    else if (b === "push") result[a === "win" ? "halfWin" : "halfLose"] += probability;
  }
  return result;
}

// 公平小数赔率：使 EV = 1 的 d。
// EV = fullWin*d + halfWin*(0.5d + 0.5) + push*1 + halfLose*0.5 = 1
export function fairDecimalOdds(outcomes) {
  const numerator = 1 - outcomes.push - 0.5 * outcomes.halfWin - 0.5 * outcomes.halfLose;
  const denominator = outcomes.fullWin + 0.5 * outcomes.halfWin;
  if (denominator <= 0) return null;
  return numerator / denominator;
}

function roundedSide(outcomes) {
  return {
    fullWin: round(outcomes.fullWin),
    halfWin: round(outcomes.halfWin),
    push: round(outcomes.push),
    halfLose: round(outcomes.halfLose),
    fullLose: round(outcomes.fullLose),
    fairOdds: fairDecimalOdds(outcomes) === null ? null : round(fairDecimalOdds(outcomes), 3),
  };
}

export function asianHandicap(diffDistribution, line) {
  const homeMargins = diffDistribution.map((entry) => ({
    margin: entry.difference,
    probability: entry.probability,
  }));
  const awayMargins = diffDistribution.map((entry) => ({
    margin: -entry.difference,
    probability: entry.probability,
  }));
  return {
    line,
    home: roundedSide(sideOutcomes(homeMargins, line)),
    away: roundedSide(sideOutcomes(awayMargins, -line)),
  };
}

export function overUnder(totalsDistribution, line) {
  const overMargins = totalsDistribution.map((entry) => ({
    margin: entry.total - line,
    probability: entry.probability,
  }));
  const underMargins = totalsDistribution.map((entry) => ({
    margin: line - entry.total,
    probability: entry.probability,
  }));
  return {
    line,
    over: roundedSide(sideOutcomes(overMargins, 0)),
    under: roundedSide(sideOutcomes(underMargins, 0)),
  };
}

export function bothTeamsToScore(distribution) {
  const yes = distribution
    .filter((entry) => entry.home > 0 && entry.away > 0)
    .reduce((sum, entry) => sum + entry.probability, 0);
  return { yes: round(yes), no: round(1 - yes) };
}

export function priceMatchMarkets(input) {
  const adjustedHome = applyContextAdjustments({
    team: withVenueHostFlag(input.homeTeam, input.venueCountryCode),
    role: "home",
    matchId: input.matchId,
    generatedAt: input.generatedAt,
    contextAdjustments: input.contextAdjustments,
  });
  const adjustedAway = applyContextAdjustments({
    team: withVenueHostFlag(input.awayTeam, input.venueCountryCode),
    role: "away",
    matchId: input.matchId,
    generatedAt: input.generatedAt,
    contextAdjustments: input.contextAdjustments,
  });
  const homeTeam = adjustedHome.team;
  const awayTeam = adjustedAway.team;
  const context = { homeAdvantageDelta: adjustedHome.homeAdvantageDelta };
  const distribution = scoreDistribution(homeTeam, awayTeam, input.maxGoals, context);
  const expected = expectedGoals(homeTeam, awayTeam, context);
  const diffs = goalDifferenceDistribution(distribution);
  const totals = totalGoalsDistribution(distribution);
  const homeWin90Prob = diffs
    .filter((entry) => entry.difference > 0)
    .reduce((sum, entry) => sum + entry.probability, 0);
  const draw90Prob = diffs.find((entry) => entry.difference === 0)?.probability ?? 0;
  return {
    matchId: input.matchId ?? `${teamKey(input.homeTeam)}-${teamKey(input.awayTeam)}`,
    resultScope: "90minResult",
    homeTeamId: teamKey(input.homeTeam),
    awayTeamId: teamKey(input.awayTeam),
    expectedGoalsHome: round(expected.home, 2),
    expectedGoalsAway: round(expected.away, 2),
    oneXTwo: {
      homeWin90Prob: round(homeWin90Prob),
      draw90Prob: round(draw90Prob),
      awayWin90Prob: round(1 - homeWin90Prob - draw90Prob),
      fairOdds: {
        home: round(1 / homeWin90Prob, 3),
        draw: round(1 / draw90Prob, 3),
        away: round(1 / (1 - homeWin90Prob - draw90Prob), 3),
      },
    },
    asianHandicaps: AH_LINES.map((line) => asianHandicap(diffs, line)),
    overUnders: OU_LINES.map((line) => overUnder(totals, line)),
    btts: bothTeamsToScore(distribution),
    goalDifference: diffs.map((entry) => ({
      difference: entry.difference,
      probability: round(entry.probability),
    })),
  };
}
```

注意：`scoreDistribution(homeTeam, awayTeam, input.maxGoals, context)` 第三参为 `undefined` 时使用 match.mjs 内部默认值 7，与 predictMatch 行为一致。

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/markets.test.mjs`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
git add core/markets.mjs tests/markets.test.mjs
git commit -m "feat(core): add markets module for AH/OU/BTTS pricing from score matrix"
```

---

### Task 2: core/odds.mjs — 赔率处理与价值识别

**Files:**
- Create: `core/odds.mjs`
- Test: `tests/odds.test.mjs`

- [ ] **Step 1: Write the failing tests**

创建 `tests/odds.test.mjs`：

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  blendProbabilities,
  decimalFromAmerican,
  decimalFromHongKong,
  devigPower,
  devigProportional,
  divergenceReport,
  impliedFromDecimal,
  valueMetrics,
} from "../core/odds.mjs";

test("odds format conversions round-trip", () => {
  assert.equal(decimalFromAmerican(150), 2.5);
  assert.equal(decimalFromAmerican(-200), 1.5);
  assert.equal(decimalFromHongKong(0.95), 1.95);
  assert.ok(Math.abs(impliedFromDecimal(2.5) - 0.4) < 1e-12);
  assert.throws(() => impliedFromDecimal(1), /decimal odds/);
});

test("proportional devig normalizes implied probabilities", () => {
  const fair = devigProportional([0.55, 0.3, 0.25]); // sum = 1.10
  assert.ok(Math.abs(fair.reduce((s, p) => s + p, 0) - 1) < 1e-12);
  assert.ok(Math.abs(fair[0] - 0.5) < 1e-12);
});

test("power devig normalizes and shades longshots more than favourites", () => {
  const implied = [0.55, 0.3, 0.25];
  const power = devigPower(implied);
  const proportional = devigProportional(implied);
  assert.ok(Math.abs(power.reduce((s, p) => s + p, 0) - 1) < 1e-9);
  // power method 应给热门保留更多概率、对冷门去掉更多水
  assert.ok(power[0] > proportional[0]);
  assert.ok(power[2] < proportional[2]);
});

test("power devig falls back to proportional when no vig present", () => {
  const fair = devigPower([0.5, 0.3, 0.2]);
  assert.deepEqual(fair, [0.5, 0.3, 0.2]);
});

test("blend respects weight boundaries", () => {
  const market = [0.5, 0.3, 0.2];
  const model = [0.4, 0.35, 0.25];
  assert.deepEqual(blendProbabilities(market, model, 1), market);
  assert.deepEqual(blendProbabilities(market, model, 0), model);
  const blended = blendProbabilities(market, model, 0.7);
  assert.ok(Math.abs(blended[0] - (0.7 * 0.5 + 0.3 * 0.4)) < 1e-12);
  assert.ok(Math.abs(blended.reduce((s, p) => s + p, 0) - 1) < 1e-12);
});

test("divergence report flags gaps above threshold", () => {
  const report = divergenceReport([0.5, 0.3, 0.2], [0.42, 0.33, 0.25], 0.05);
  assert.equal(report[0].flag, true);
  assert.equal(report[0].direction, "model_higher");
  assert.equal(report[1].flag, false);
  assert.equal(report[2].direction, "market_higher");
});

test("value metrics compute EV and capped quarter Kelly", () => {
  const value = valueMetrics(0.5, 2.4);
  assert.ok(Math.abs(value.ev - 0.2) < 1e-9);
  // full Kelly = 0.2 / 1.4 ≈ 0.1429 → quarter ≈ 0.0357
  assert.ok(Math.abs(value.kellyFraction - 0.0357) < 1e-3);
  const negative = valueMetrics(0.3, 2.4);
  assert.ok(negative.ev < 0);
  assert.equal(negative.kellyFraction, 0);
  const capped = valueMetrics(0.9, 10);
  assert.equal(capped.kellyFraction, 0.1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/odds.test.mjs`
Expected: FAIL（`core/odds.mjs` 不存在）

- [ ] **Step 3: Write the implementation**

创建 `core/odds.mjs`：

```js
// prediction-core v0.3.0 — maintained in this repository (worldcup-predictor-skill).
import { clamp, round } from "./utils.mjs";

export const DEFAULT_MARKET_WEIGHT = 0.7;
export const DEFAULT_DIVERGENCE_THRESHOLD = 0.05;
const KELLY_DIVISOR = 4;
const KELLY_CAP = 0.1;

export function decimalFromAmerican(american) {
  if (!Number.isFinite(american) || american === 0) {
    throw new Error("american odds must be a non-zero number.");
  }
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function decimalFromHongKong(hongKong) {
  if (!Number.isFinite(hongKong) || hongKong <= 0) {
    throw new Error("hong kong odds must be a positive number.");
  }
  return hongKong + 1;
}

export function impliedFromDecimal(decimal) {
  if (!Number.isFinite(decimal) || decimal <= 1) {
    throw new Error("decimal odds must be greater than 1.");
  }
  return 1 / decimal;
}

export function devigProportional(implied) {
  const total = implied.reduce((sum, probability) => sum + probability, 0);
  if (total <= 0) throw new Error("implied probabilities must sum to a positive value.");
  return implied.map((probability) => probability / total);
}

// Power method：求 k 使 sum(q_i^k) = 1，比 proportional 更好地处理 favourite-longshot bias。
export function devigPower(implied) {
  const total = implied.reduce((sum, probability) => sum + probability, 0);
  if (total <= 1) return devigProportional(implied);
  let low = 1;
  let high = 20;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const mid = (low + high) / 2;
    const sum = implied.reduce((acc, probability) => acc + probability ** mid, 0);
    if (sum > 1) low = mid;
    else high = mid;
  }
  const exponent = (low + high) / 2;
  const powered = implied.map((probability) => probability ** exponent);
  const poweredTotal = powered.reduce((sum, probability) => sum + probability, 0);
  return powered.map((probability) => probability / poweredTotal);
}

export function blendProbabilities(market, model, weight = DEFAULT_MARKET_WEIGHT) {
  if (market.length !== model.length) {
    throw new Error("market and model probability arrays must align.");
  }
  const boundedWeight = clamp(weight, 0, 1);
  const blended = market.map(
    (probability, index) => boundedWeight * probability + (1 - boundedWeight) * model[index],
  );
  const total = blended.reduce((sum, probability) => sum + probability, 0);
  return blended.map((probability) => probability / total);
}

export function divergenceReport(model, market, threshold = DEFAULT_DIVERGENCE_THRESHOLD) {
  if (model.length !== market.length) {
    throw new Error("model and market probability arrays must align.");
  }
  return model.map((probability, index) => {
    const delta = probability - market[index];
    return {
      modelProb: round(probability),
      marketProb: round(market[index]),
      delta: round(delta),
      direction: delta >= 0 ? "model_higher" : "market_higher",
      flag: Math.abs(delta) >= threshold,
    };
  });
}

export function valueMetrics(probability, decimalPrice) {
  if (!Number.isFinite(decimalPrice) || decimalPrice <= 1) {
    throw new Error("decimal price must be greater than 1.");
  }
  const ev = probability * decimalPrice - 1;
  const fullKelly = (probability * decimalPrice - 1) / (decimalPrice - 1);
  const kellyFraction = clamp(Math.max(0, fullKelly) / KELLY_DIVISOR, 0, KELLY_CAP);
  return { ev: round(ev), kellyFraction: round(kellyFraction) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/odds.test.mjs`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add core/odds.mjs tests/odds.test.mjs
git commit -m "feat(core): add odds module with devig, blending, divergence and Kelly metrics"
```

---

### Task 3: 模型修缮 + 版本升级 + manifest 工具

**Files:**
- Modify: `core/match.mjs:112-121`（dixonColesRho）、`core/match.mjs:166-169`（homeAdvanceAfterDrawProb）
- Modify: `core/version.mjs`、`core/index.mjs`、`core/manifest.json`
- Create: `scripts/update-core-manifest.mjs`
- Modify: `package.json`（加 manifest script）
- Test: `tests/skill.test.mjs`（新增 2 个测试）

- [ ] **Step 1: Write the failing tests**

在 `tests/skill.test.mjs` 末尾追加：

```js
test("dixon-coles rho is continuous in average lambda", async () => {
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
```

同时修改既有 manifest 测试不需要动（重新生成 manifest 后哈希自然匹配）。

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test tests/skill.test.mjs`
Expected: `knockout draw advancement` FAIL（旧公式给出 0.61）；rho 连续性测试也可能 FAIL（0.92/0.93 跨 λ<1.0 档位边界，含 Dixon-Coles 跳变）。manifest 测试此时仍 PASS。

- [ ] **Step 3: Modify core/match.mjs**

将 `dixonColesRho`（core/match.mjs:112-121）替换为：

```js
function dixonColesRho(lambdaHome, lambdaAway) {
    const avgLambda = (lambdaHome + lambdaAway) / 2;
    // 对原 4 档阶梯（-0.13/-0.10/-0.06/-0.03）的连续线性拟合，消除档位边界跳变。
    return clamp(0.0833 * avgLambda - 0.1967, -0.15, -0.02);
}
```

将 `homeAdvanceAfterDrawProb`（core/match.mjs:166-169）替换为：

```js
const EXTRA_TIME_DECIDED_SHARE = 0.45;
export function homeAdvanceAfterDrawProb(homeTeam, awayTeam) {
    const ratingDelta = (teamRating(homeTeam) - teamRating(awayTeam)) / 400;
    const hostDelta = (homeTeam.isHost ? 0.03 : 0) - (awayTeam.isHost ? 0.03 : 0);
    // 两段式：加时段实力差仍然有效，点球段接近五五开。
    const extraTimeWin = clamp(0.5 + ratingDelta * 0.18 + hostDelta, 0.3, 0.7);
    const penaltyWin = clamp(0.5 + ratingDelta * 0.06, 0.4, 0.6);
    return clamp(EXTRA_TIME_DECIDED_SHARE * extraTimeWin + (1 - EXTRA_TIME_DECIDED_SHARE) * penaltyWin, 0.25, 0.75);
}
```

- [ ] **Step 4: Update version, index, file headers**

`core/version.mjs` 全文替换：

```js
// prediction-core v0.3.0 — maintained in this repository (worldcup-predictor-skill).
export const PREDICTION_CORE_VERSION = "0.3.0";
export const DEFAULT_MODEL_VERSION = "model-v0.3-market";
export const DEFAULT_SIMULATION_COUNT = 10000;
```

`core/index.mjs` 全文替换：

```js
// prediction-core v0.3.0 — maintained in this repository (worldcup-predictor-skill).
export * from "./betting.mjs";
export * from "./markets.mjs";
export * from "./match.mjs";
export * from "./odds.mjs";
export * from "./tournament.mjs";
export * from "./version.mjs";
```

将所有 core/*.mjs 文件第一行的 `// Generated from packages/prediction-core. Run pnpm skill:sync-core to refresh.` 替换为 `// prediction-core v0.3.0 — maintained in this repository (worldcup-predictor-skill).`（涉及 betting.mjs、match.mjs、tournament.mjs、types.mjs、utils.mjs）。

- [ ] **Step 5: Create scripts/update-core-manifest.mjs**

```js
#!/usr/bin/env node
// 重新生成 core/manifest.json。core 在本仓库迭代后必须运行此脚本，否则 manifest 测试会失败。
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const coreDir = resolve(dirname(fileURLToPath(import.meta.url)), "../core");
const packageJson = JSON.parse(
  readFileSync(resolve(coreDir, "../package.json"), "utf8"),
);
const versionSource = readFileSync(join(coreDir, "version.mjs"), "utf8");
const modelVersion = versionSource.match(/DEFAULT_MODEL_VERSION = "([^"]+)"/)[1];
const coreVersion = versionSource.match(/PREDICTION_CORE_VERSION = "([^"]+)"/)[1];

const files = {};
for (const file of readdirSync(coreDir).filter((name) => name.endsWith(".mjs")).sort()) {
  files[file] = createHash("sha256").update(readFileSync(join(coreDir, file))).digest("hex");
}
const sourceHash = createHash("sha256").update(JSON.stringify(files)).digest("hex");

const manifest = {
  skillVersion: packageJson.version,
  sourceVersion: `prediction-core v${coreVersion} (in-repo)`,
  modelVersion,
  sourceHash,
  files,
};
writeFileSync(join(coreDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`core/manifest.json updated for prediction-core v${coreVersion}.`);
```

`package.json` 的 `scripts` 增加一行（version 字段此时一并升为 `"0.3.0"`）：

```json
"update-core-manifest": "node scripts/update-core-manifest.mjs"
```

- [ ] **Step 6: Regenerate manifest and run full tests**

Run: `npm run update-core-manifest && npm test`
Expected: 全部 PASS（包括 manifest 哈希测试与两个新测试）

- [ ] **Step 7: Commit**

```bash
git add core/ scripts/update-core-manifest.mjs package.json tests/skill.test.mjs
git commit -m "feat(core): continuous DC rho, two-stage shootout model, bump core to v0.3.0"
```

---

### Task 4: 市场快照校验 + fetch-market 脚本

**Files:**
- Create: `scripts/market-input.mjs`
- Create: `scripts/fetch-market.mjs`
- Create: `assets/sample-data/market-snapshot.json`
- Test: `tests/skill.test.mjs`（新增 3 个测试）

- [ ] **Step 1: Write the failing tests**

在 `tests/skill.test.mjs` 顶部 import 区追加：

```js
import { auditMarketSnapshot } from "../scripts/market-input.mjs";
import { gammaEventToMarkets, manualToSnapshot } from "../scripts/fetch-market.mjs";
```

末尾追加：

```js
test("market snapshot audit accepts valid input and rejects bad prices", () => {
  const valid = auditMarketSnapshot(readSample("market-snapshot.json"));
  assert.equal(valid.markets[0].type, "1x2");
  assert.ok(valid.markets[0].overround > 1);
  assert.throws(
    () => auditMarketSnapshot({ source: "manual", fetchedAt: "2026-06-04T12:00:00.000Z", markets: [{ matchId: "x", type: "1x2", outcomes: [{ name: "3", price: 0.9 }] }] }),
    /price/,
  );
  assert.throws(() => auditMarketSnapshot({ markets: [] }), /fetchedAt/);
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
  assert.ok(Math.abs(homeOutcome.impliedProb - 1 / 2.3) < 1e-9);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/skill.test.mjs`
Expected: FAIL（模块与样例文件不存在）

- [ ] **Step 3: Create assets/sample-data/market-snapshot.json**

```json
{
  "source": "manual",
  "fetchedAt": "2026-06-04T12:00:00.000Z",
  "markets": [
    {
      "matchId": "sample-group-a-1",
      "type": "1x2",
      "outcomes": [
        { "name": "3", "label": "Mexico", "price": 2.3, "impliedProb": 0.4348 },
        { "name": "1", "label": "Draw", "price": 3.2, "impliedProb": 0.3125 },
        { "name": "0", "label": "South Korea", "price": 3.1, "impliedProb": 0.3226 }
      ]
    }
  ]
}
```

- [ ] **Step 4: Create scripts/market-input.mjs**

```js
import { round } from "../core/utils.mjs";

const marketTypes = new Set(["1x2", "ah", "ou", "outright"]);

function requiredString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value;
}

export function auditMarketSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") throw new Error("Market snapshot must be a JSON object.");
  requiredString(snapshot.source, "source");
  requiredString(snapshot.fetchedAt, "fetchedAt");
  if (Number.isNaN(new Date(snapshot.fetchedAt).getTime())) {
    throw new Error("fetchedAt must be a valid ISO-8601 timestamp.");
  }
  if (!Array.isArray(snapshot.markets) || snapshot.markets.length === 0) {
    throw new Error("markets must contain at least one market.");
  }
  const markets = snapshot.markets.map((market, index) => {
    if (!marketTypes.has(market.type)) throw new Error(`markets[${index}].type must be one of ${[...marketTypes].join(", ")}.`);
    if (market.type !== "outright") requiredString(market.matchId, `markets[${index}].matchId`);
    if ((market.type === "ah" || market.type === "ou") && !Number.isFinite(market.line)) {
      throw new Error(`markets[${index}].line is required for ${market.type} markets.`);
    }
    if (!Array.isArray(market.outcomes) || market.outcomes.length < 2) {
      throw new Error(`markets[${index}].outcomes must contain at least two outcomes.`);
    }
    const outcomes = market.outcomes.map((outcome, outcomeIndex) => {
      requiredString(outcome.name, `markets[${index}].outcomes[${outcomeIndex}].name`);
      if (!Number.isFinite(outcome.price) || outcome.price <= 1) {
        throw new Error(`markets[${index}].outcomes[${outcomeIndex}].price must be decimal odds greater than 1.`);
      }
      const impliedProb = Number.isFinite(outcome.impliedProb) ? outcome.impliedProb : 1 / outcome.price;
      if (impliedProb <= 0 || impliedProb >= 1) {
        throw new Error(`markets[${index}].outcomes[${outcomeIndex}].impliedProb must be inside (0, 1).`);
      }
      return { ...outcome, impliedProb: round(impliedProb) };
    });
    const overround = outcomes.reduce((sum, outcome) => sum + outcome.impliedProb, 0);
    return { ...market, outcomes, overround: round(overround) };
  });
  return { ...snapshot, markets };
}

export function findMarketForMatch(snapshot, matchId, type = "1x2") {
  return snapshot.markets.find((market) => market.matchId === matchId && market.type === type);
}

// 市场快照相对赛事快照的时效检查；返回小时差，调用方决定是否警告。
export function marketAgeHours(marketSnapshot, eventGeneratedAt) {
  const fetched = new Date(marketSnapshot.fetchedAt).getTime();
  const generated = new Date(eventGeneratedAt).getTime();
  if (Number.isNaN(fetched) || Number.isNaN(generated)) return null;
  return Math.abs(generated - fetched) / 3600000;
}
```

- [ ] **Step 5: Create scripts/fetch-market.mjs**

```js
#!/usr/bin/env node
// 市场数据唯一的网络入口：拉取 Polymarket Gamma API 或转换手填赔率，落盘为市场快照。
// 核心计算永远不直接联网；下游脚本只消费本脚本产出的快照文件。

import { writeFileSync } from "node:fs";

import { decimalFromAmerican, decimalFromHongKong } from "../core/odds.mjs";
import { round } from "../core/utils.mjs";
import { fail, parseArgs, readJson } from "./audit-input.mjs";
import { auditMarketSnapshot } from "./market-input.mjs";

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const usage = [
  "Usage:",
  "  node scripts/fetch-market.mjs --manual <odds.json> [--out <snapshot.json>]",
  "  node scripts/fetch-market.mjs --gamma-slug <event-slug> [--match-id id --home Name --away Name] [--out <snapshot.json>]",
].join("\n");

function toDecimal(value, format = "decimal") {
  if (format === "decimal") return value;
  if (format === "american") return decimalFromAmerican(value);
  if (format === "hongkong") return decimalFromHongKong(value);
  throw new Error(`Unsupported odds format: ${format}`);
}

export function manualToSnapshot(manual) {
  if (!manual || !Array.isArray(manual.matches) || manual.matches.length === 0) {
    throw new Error("manual input must contain a non-empty matches array.");
  }
  const labels = { "3": "homeName", "1": null, "0": "awayName" };
  const markets = manual.matches.map((match, index) => {
    if (!match.matchId) throw new Error(`matches[${index}].matchId is required.`);
    if (!match.odds || !["3", "1", "0"].every((key) => Number.isFinite(match.odds[key]))) {
      throw new Error(`matches[${index}].odds must contain numeric 3/1/0 entries.`);
    }
    const outcomes = ["3", "1", "0"].map((name) => {
      const price = toDecimal(match.odds[name], match.format ?? "decimal");
      return {
        name,
        label: labels[name] ? match[labels[name]] ?? name : "Draw",
        price: round(price, 4),
        impliedProb: round(1 / price),
      };
    });
    return { matchId: match.matchId, type: "1x2", outcomes };
  });
  return {
    source: manual.source ?? "manual",
    fetchedAt: manual.fetchedAt ?? new Date().toISOString(),
    markets,
  };
}

function parseJsonArray(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed : [];
}

export function gammaEventToMarkets(event, options = {}) {
  const rawMarkets = Array.isArray(event?.markets) ? event.markets : [];
  if (rawMarkets.length === 0) throw new Error("Gamma event contains no markets.");

  const threeWay = rawMarkets.find((market) => {
    const outcomes = parseJsonArray(market.outcomes);
    return outcomes.length === 3 && outcomes.some((name) => /draw/i.test(name));
  });
  if (threeWay && options.matchId) {
    const outcomes = parseJsonArray(threeWay.outcomes);
    const prices = parseJsonArray(threeWay.outcomePrices).map(Number);
    const mapped = outcomes.map((name, index) => {
      const price = prices[index];
      const label310 = /draw/i.test(name)
        ? "1"
        : options.home && name.toLowerCase().includes(options.home.toLowerCase())
          ? "3"
          : "0";
      return { name: label310, label: name, price: round(1 / price, 4), impliedProb: round(price) };
    });
    return [{ matchId: options.matchId, type: "1x2", outcomes: mapped }];
  }

  const binaries = rawMarkets.filter((market) => parseJsonArray(market.outcomes).length === 2);
  if (binaries.length === 0) throw new Error("Gamma event has no convertible markets.");
  const outcomes = binaries.map((market) => {
    const prices = parseJsonArray(market.outcomePrices).map(Number);
    const yesPrice = prices[0];
    return {
      name: market.groupItemTitle || market.question || market.id,
      label: market.groupItemTitle || market.question || market.id,
      price: round(1 / yesPrice, 4),
      impliedProb: round(yesPrice),
    };
  });
  return [{ marketId: event.slug ?? event.id, type: "outright", outcomes }];
}

async function fetchGammaEvent(slug) {
  const response = await fetch(`${GAMMA_BASE}/events?slug=${encodeURIComponent(slug)}`);
  if (!response.ok) throw new Error(`Gamma API request failed: ${response.status}`);
  const events = await response.json();
  if (!Array.isArray(events) || events.length === 0) throw new Error(`No Gamma event found for slug: ${slug}`);
  return events[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.manual && !args["gamma-slug"])) fail("Provide --manual or --gamma-slug.", usage);
  let snapshot;
  if (args.manual) {
    snapshot = manualToSnapshot(readJson(args.manual));
  } else {
    const event = await fetchGammaEvent(args["gamma-slug"]);
    snapshot = {
      source: "polymarket",
      fetchedAt: new Date().toISOString(),
      markets: gammaEventToMarkets(event, { matchId: args["match-id"], home: args.home, away: args.away }),
    };
  }
  const audited = auditMarketSnapshot(snapshot);
  const output = JSON.stringify(audited, null, 2);
  if (args.out) {
    writeFileSync(args.out, `${output}\n`);
    console.error(`Market snapshot written to ${args.out}`);
  } else {
    console.log(output);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isDirectRun) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error), usage));
}
```

注意 Windows 路径：`isDirectRun` 判断按上面写法处理反斜杠；如果执行时发现判断不可靠，退化方案是把 CLI 入口拆到独立小文件，转换函数留在可导入模块中。测试只 import `manualToSnapshot` / `gammaEventToMarkets`，不触发网络。

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/skill.test.mjs`
Expected: 新增 3 个测试 PASS，既有测试全部 PASS

- [ ] **Step 7: Commit**

```bash
git add scripts/market-input.mjs scripts/fetch-market.mjs assets/sample-data/market-snapshot.json tests/skill.test.mjs
git commit -m "feat: add market snapshot pipeline (audit, manual odds, Polymarket Gamma fetch)"
```

---

### Task 5: scripts/predict-markets.mjs — 全盘口定价 CLI

**Files:**
- Create: `scripts/predict-markets.mjs`
- Test: `tests/skill.test.mjs`（扩展独立 CLI 测试）

- [ ] **Step 1: Extend the standalone CLI test (failing first)**

修改 `tests/skill.test.mjs` 中 `copied skill runs all three CLIs without the web app` 测试：标题改为 `copied skill runs all bundled CLIs without the web app`，commands 数组追加：

```js
      ["scripts/predict-markets.mjs", "--home", "MEX", "--away", "KOR"],
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/skill.test.mjs`
Expected: FAIL（脚本不存在，spawn status 非 0）

- [ ] **Step 3: Create scripts/predict-markets.mjs**

```js
#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { priceMatchMarkets } from "../core/index.mjs";
import { auditSnapshot, fail, findMatchState, findTeam, parseArgs, readJson } from "./audit-input.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultDataPath = resolve(scriptDir, "../assets/sample-data/worldcup-2026.json");
const usage =
  "Usage: node scripts/predict-markets.mjs --home FRA --away BRA [--data <audited-snapshot.json>] [--match match-id] [--venue-country USA]";
const args = parseArgs(process.argv.slice(2));

if (args.help || !args.home || !args.away) fail("Missing required --home or --away argument.", usage);

try {
  const snapshot = auditSnapshot(readJson(args.data || defaultDataPath));
  const homeTeam = findTeam(snapshot.teams, args.home);
  const awayTeam = findTeam(snapshot.teams, args.away);
  if (!homeTeam) throw new Error(`Home team not found: ${args.home}`);
  if (!awayTeam) throw new Error(`Away team not found: ${args.away}`);
  if (homeTeam.id === awayTeam.id) throw new Error("Home and away teams must be different.");

  const matchState = findMatchState(snapshot, homeTeam, awayTeam, args.match);
  const book = priceMatchMarkets({
    matchId: args.match || matchState?.matchId,
    homeTeam,
    awayTeam,
    generatedAt: snapshot.metadata.generatedAt,
    venueCountryCode: args["venue-country"] || matchState?.venueCountryCode,
    contextAdjustments: snapshot.contextAdjustments,
  });
  console.log(
    JSON.stringify(
      {
        modelVersion: snapshot.metadata.modelVersion,
        dataVersion: snapshot.metadata.dataVersion,
        generatedAt: snapshot.metadata.generatedAt,
        disclaimer:
          "盘口定价为模型公平价，仅供分析参考，不构成任何购彩或投资建议。",
        ...book,
      },
      null,
      2,
    ),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), usage);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/skill.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/predict-markets.mjs tests/skill.test.mjs
git commit -m "feat: add predict-markets CLI for full market book pricing"
```

---

### Task 6: scripts/value-scan.mjs — 价值扫描 CLI

**Files:**
- Create: `scripts/value-scan.mjs`
- Test: `tests/skill.test.mjs`（新增 1 个行为测试 + CLI 列表追加）

- [ ] **Step 1: Write the failing tests**

`tests/skill.test.mjs` 的 CLI commands 数组追加：

```js
      ["scripts/value-scan.mjs", "--market", "assets/sample-data/market-snapshot.json"],
```

末尾追加行为测试：

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/skill.test.mjs`
Expected: FAIL（脚本不存在）

- [ ] **Step 3: Create scripts/value-scan.mjs**

```js
#!/usr/bin/env node
// 市场 vs 模型价值扫描：去水 → 加权融合 → 分歧 → EV/Kelly。仅分析参考，不构成购彩建议。

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_DIVERGENCE_THRESHOLD,
  DEFAULT_MARKET_WEIGHT,
  blendProbabilities,
  devigPower,
  devigProportional,
  divergenceReport,
  predictMatch,
  valueMetrics,
} from "../core/index.mjs";
import { round } from "../core/utils.mjs";
import { auditSnapshot, fail, parseArgs, readJson } from "./audit-input.mjs";
import { auditMarketSnapshot, marketAgeHours } from "./market-input.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultDataPath = resolve(scriptDir, "../assets/sample-data/worldcup-2026.json");
const usage =
  "Usage: node scripts/value-scan.mjs --market <market-snapshot.json> [--data <audited-snapshot.json>] [--weight 0.7] [--devig power|proportional] [--threshold 0.05] [--max-age-hours 24]";
const labels = ["3", "1", "0"];
const args = parseArgs(process.argv.slice(2));

if (args.help || !args.market) fail("Missing required --market argument.", usage);

try {
  const snapshot = auditSnapshot(readJson(args.data || defaultDataPath));
  const marketSnapshot = auditMarketSnapshot(readJson(args.market));
  const weight = args.weight === undefined ? DEFAULT_MARKET_WEIGHT : Number(args.weight);
  const threshold = args.threshold === undefined ? DEFAULT_DIVERGENCE_THRESHOLD : Number(args.threshold);
  const maxAgeHours = args["max-age-hours"] === undefined ? 24 : Number(args["max-age-hours"]);
  const devig = (args.devig ?? "power") === "proportional" ? devigProportional : devigPower;
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error("--weight must be between 0 and 1.");

  const teamsById = new Map(snapshot.teams.map((team) => [team.id, team]));
  const matches = [];
  for (const market of marketSnapshot.markets) {
    if (market.type !== "1x2") continue;
    const state = snapshot.matchStates.find((entry) => entry.matchId === market.matchId);
    if (!state) continue;
    const homeTeam = teamsById.get(state.homeTeamId);
    const awayTeam = teamsById.get(state.awayTeamId);
    if (!homeTeam || !awayTeam) continue;

    const prediction = predictMatch({
      matchId: state.matchId,
      homeTeam,
      awayTeam,
      stage: state.stage,
      modelVersion: snapshot.metadata.modelVersion,
      dataVersion: snapshot.metadata.dataVersion,
      generatedAt: snapshot.metadata.generatedAt,
      venueCountryCode: state.venueCountryCode,
      contextAdjustments: snapshot.contextAdjustments,
    });
    const modelProbs = [prediction.homeWin90Prob, prediction.draw90Prob, prediction.awayWin90Prob];
    const orderedOutcomes = labels.map((name) => {
      const outcome = market.outcomes.find((entry) => entry.name === name);
      if (!outcome) throw new Error(`Market ${market.matchId} is missing outcome ${name}.`);
      return outcome;
    });
    const marketProbs = devig(orderedOutcomes.map((outcome) => outcome.impliedProb));
    const blended = blendProbabilities(marketProbs, modelProbs, weight);
    const divergence = divergenceReport(modelProbs, marketProbs, threshold);

    matches.push({
      matchId: state.matchId,
      homeTeam: homeTeam.name,
      awayTeam: awayTeam.name,
      resultScope: "90minResult",
      overround: market.overround,
      model90Prob: Object.fromEntries(labels.map((name, index) => [name, round(modelProbs[index])])),
      market90Prob: Object.fromEntries(labels.map((name, index) => [name, round(marketProbs[index])])),
      blended90Prob: Object.fromEntries(labels.map((name, index) => [name, round(blended[index])])),
      divergence: divergence.map((entry, index) => ({ outcome: labels[index], ...entry })),
      valueMetrics: labels.map((name, index) => ({
        outcome: name,
        price: orderedOutcomes[index].price,
        ...valueMetrics(blended[index], orderedOutcomes[index].price),
      })),
      bestValue: null,
    });
  }
  for (const match of matches) {
    match.bestValue = match.valueMetrics.reduce((best, entry) => (entry.ev > best.ev ? entry : best));
  }
  matches.sort((left, right) => right.bestValue.ev - left.bestValue.ev);

  const ageHours = marketAgeHours(marketSnapshot, snapshot.metadata.generatedAt);
  const report = {
    modelVersion: snapshot.metadata.modelVersion,
    dataVersion: snapshot.metadata.dataVersion,
    marketSource: marketSnapshot.source,
    marketFetchedAt: marketSnapshot.fetchedAt,
    marketAgeHours: ageHours === null ? null : round(ageHours, 2),
    staleWarning:
      ageHours !== null && ageHours > maxAgeHours
        ? `市场快照与赛事快照时间差 ${round(ageHours, 1)} 小时，超过 ${maxAgeHours} 小时阈值，结果可能过期。`
        : undefined,
    marketWeight: weight,
    devigMethod: args.devig ?? "power",
    matches,
    disclaimer:
      "EV 与 Kelly 仅为模型与市场对比的分析参考，不构成任何购彩、投资或收益建议。请遵守当地法律法规。",
  };
  if (matches.length === 0) {
    report.fallback = "model_only";
    report.note = "市场快照中没有可与赛事快照匹配的 1x2 盘口。";
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), usage);
}
```

前置条件：`assets/sample-data/worldcup-2026.json` 的 matchStates 中存在 `sample-group-a-1`（MEX vs KOR，既有测试已依赖）。若该 matchState 缺少 `homeTeamId/awayTeamId` 字段，按实际字段名调整查找逻辑。

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/skill.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/value-scan.mjs tests/skill.test.mjs
git commit -m "feat: add value-scan CLI (devig, blend, divergence, EV/Kelly)"
```

---

### Task 7: predict-match.mjs 增加 --market 融合输出

**Files:**
- Modify: `scripts/predict-match.mjs`
- Test: `tests/skill.test.mjs`（新增 1 个测试）

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/skill.test.mjs`
Expected: FAIL（`marketBlend` 不存在）

- [ ] **Step 3: Modify scripts/predict-match.mjs**

在现有 import 后追加：

```js
import {
  DEFAULT_MARKET_WEIGHT,
  blendProbabilities,
  devigPower,
  divergenceReport,
} from "../core/index.mjs";
import { auditMarketSnapshot, findMarketForMatch } from "./market-input.mjs";
```

usage 行更新为：

```js
const usage =
  "Usage: node scripts/predict-match.mjs --home FRA --away BRA [--data <audited-snapshot.json>] [--match match-id] [--stage group] [--venue-country USA] [--market <market-snapshot.json>] [--weight 0.7]";
```

在 `const prediction = predictMatch({...});` 之后、`console.log` 之前插入：

```js
  if (args.market) {
    const marketSnapshot = auditMarketSnapshot(readJson(args.market));
    const market = findMarketForMatch(marketSnapshot, prediction.matchId);
    if (market) {
      const labels = ["3", "1", "0"];
      const ordered = labels.map((name) => {
        const outcome = market.outcomes.find((entry) => entry.name === name);
        if (!outcome) throw new Error(`Market ${market.matchId} is missing outcome ${name}.`);
        return outcome;
      });
      const weight = args.weight === undefined ? DEFAULT_MARKET_WEIGHT : Number(args.weight);
      const modelProbs = [prediction.homeWin90Prob, prediction.draw90Prob, prediction.awayWin90Prob];
      const marketProbs = devigPower(ordered.map((outcome) => outcome.impliedProb));
      const blended = blendProbabilities(marketProbs, modelProbs, weight);
      prediction.marketBlend = {
        resultScope: "90minResult",
        marketSource: marketSnapshot.source,
        marketFetchedAt: marketSnapshot.fetchedAt,
        marketWeight: weight,
        market90Prob: Object.fromEntries(labels.map((name, index) => [name, marketProbs[index]])),
        blended90Prob: Object.fromEntries(labels.map((name, index) => [name, blended[index]])),
        divergence: divergenceReport(modelProbs, marketProbs).map((entry, index) => ({
          outcome: labels[index],
          ...entry,
        })),
      };
    } else {
      prediction.marketBlend = { fallback: "model_only", note: `市场快照中没有 matchId 为 ${prediction.matchId} 的 1x2 盘口。` };
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/skill.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/predict-match.mjs tests/skill.test.mjs
git commit -m "feat: optional --market blending in predict-match"
```

---

### Task 8: betting.mjs 支持融合概率的 3/1/0 清单

**Files:**
- Modify: `core/betting.mjs`
- Test: `tests/skill.test.mjs`（新增 2 个测试）

- [ ] **Step 1: Write the failing tests**

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/skill.test.mjs`
Expected: FAIL（`probabilitySource` 不存在）

- [ ] **Step 3: Modify core/betting.mjs**

文件头 import 改为：

```js
import { DEFAULT_MARKET_WEIGHT, blendProbabilities } from "./odds.mjs";
import { round } from "./utils.mjs";
```

新增内部函数（放在 `probabilityMap` 之前）：

```js
function withBlendedProbabilities(match, marketWeight) {
  const market = match.market310;
  if (!market || !["3", "1", "0"].every((label) => Number.isFinite(market[label]))) {
    return { ...match, probabilitySource: "model_only" };
  }
  const blended = blendProbabilities(
    [market["3"], market["1"], market["0"]],
    [Number(match.homeWin90Prob), Number(match.draw90Prob), Number(match.awayWin90Prob)],
    marketWeight,
  );
  return {
    ...match,
    homeWin90Prob: blended[0],
    draw90Prob: blended[1],
    awayWin90Prob: blended[2],
    probabilitySource: "blended",
  };
}
```

`buildSelection` 的返回对象中（`resultScope: "90minResult",` 之后）追加一行：

```js
        probabilitySource: match.probabilitySource ?? "model_only",
```

`generateBettingSlip` 中，把

```js
    const selections = trimToBudget(input.issue.matches.map((match) => buildSelection(match, strategy)), maxStake);
```

替换为：

```js
    const marketWeight = input.marketWeight ?? DEFAULT_MARKET_WEIGHT;
    const selections = trimToBudget(
        input.issue.matches.map((match) => buildSelection(withBlendedProbabilities(match, marketWeight), strategy)),
        maxStake,
    );
```

并在返回对象的 `strategy,` 之后追加：

```js
        marketWeight: input.issue.matches.some((match) => match.market310) ? marketWeight : undefined,
```

- [ ] **Step 4: Regenerate manifest and run tests**

Run: `npm run update-core-manifest && npm test`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add core/betting.mjs core/manifest.json tests/skill.test.mjs
git commit -m "feat(core): blend market310 probabilities into lottery slip selection"
```

---

### Task 9: 文档与版本收尾

**Files:**
- Create: `references/market-methodology.md`
- Modify: `references/data-schema.md`、`references/model-methodology.md`、`SKILL.md`、`README.md`、`README.en.md`、`package.json`（smoke）

- [ ] **Step 1: Create references/market-methodology.md**

```markdown
# Market Methodology

适用版本：prediction-core v0.3.0（`model-v0.3-market`）。

## 多盘口定价（core/markets.mjs）

所有盘口由同一个比分概率矩阵（Poisson + Dixon-Coles）推导，保证内部自洽：

- **亚盘**：整数/半球盘直接按净胜球判定胜/走/负；quarter 盘（±0.25/±0.75）按拆盘法
  一半注押相邻两条线，输出 fullWin/halfWin/push/halfLose/fullLose 五段概率。
- **公平赔率**：解 EV=1 的小数赔率
  `d = (1 − push − 0.5·halfWin − 0.5·halfLose) / (fullWin + 0.5·halfWin)`。
- **大小球**：0.5–5.5 全线位（含 quarter），同一拆盘逻辑。
- **BTTS**：比分矩阵中双方均进球的质量和。

所有盘口概率挂 `90minResult` 口径，不涉及加时与点球。

## 去水（de-vig）

- 默认 **power method**：求 k 使 Σqᵢᵏ = 1（二分 80 轮，确定性），比 proportional 更好地
  处理 favourite-longshot bias（对冷门去更多水）。
- 备选 proportional：pᵢ = qᵢ / Σq。
- 隐含概率之和 ≤ 1（无水/套利盘）时退化为 proportional 归一。

## 融合与分歧

- `blended = w·market + (1−w)·model`，默认 w = 0.7（市场为主、模型为辅，
  封盘前的市场共识通常强于单一模型）。w 可经 `--weight` 配置。
- 无市场数据时自动退回纯模型，输出 `fallback: "model_only"`。
- 分歧报告：每个结果输出 model − market 差值与方向，|Δ| ≥ 5pp（可配）标记 `flag: true`。

## EV 与 Kelly

- `EV = p·d − 1`（p 为融合概率，d 为市场小数价）。
- Kelly：`f* = (p·d − 1)/(d − 1)`，输出 1/4 Kelly，上限 10%。
- 仅为分析参考，不构成任何购彩、投资或收益建议。

## Polymarket 数据语义

- Polymarket 份额价格（0–1）≈ 该结果的市场隐含概率，YES 价即概率，小数赔率 = 1/价格。
- Gamma API（gamma-api.polymarket.com）免费无需 key；本 skill 只通过
  `scripts/fetch-market.mjs` 拉取并落盘为带 `fetchedAt` 的快照，核心计算不联网。
- 市场快照相对赛事快照超过 `--max-age-hours`（默认 24h）输出 `staleWarning`。

## 模型修缮（v0.3）

- Dixon-Coles ρ 由 4 档阶梯改为 λ 的连续线性函数 `clamp(0.0833·λ̄ − 0.1967, −0.15, −0.02)`。
- 淘汰赛平局晋级拆为两段：加时段 `0.5 + Δ·0.18 ± host 0.03`（clamp 0.3–0.7），
  点球段 `0.5 + Δ·0.06`（clamp 0.4–0.6），按 45%/55% 加权，整体 clamp 0.25–0.75。
```

- [ ] **Step 2: Update references/data-schema.md**

在文件末尾追加：

```markdown
## Market Snapshot Schema

`scripts/fetch-market.mjs` 产出、`--market` 参数消费的市场快照：

​```json
{
  "source": "polymarket | manual",
  "fetchedAt": "2026-06-04T12:00:00.000Z",
  "markets": [
    {
      "matchId": "sample-group-a-1",
      "type": "1x2 | ah | ou | outright",
      "line": 2.5,
      "outcomes": [
        { "name": "3", "label": "Mexico", "price": 2.3, "impliedProb": 0.4348 }
      ]
    }
  ]
}
​```

- `price` 为小数赔率（>1）；`impliedProb` 缺省时按 1/price 推得。
- `1x2` 盘口的 outcome `name` 固定为 `"3" | "1" | "0"`。
- `outright` 盘口用 `marketId` 代替 `matchId`。
- 市场快照不进入 `metadata.sourceVersions`，不改变 `dataVersion`；
  它是融合层输入，原始模型概率始终单独保留输出。
```

（注意去掉 ``` 前的零宽转义，写入真实 fenced block。）

- [ ] **Step 3: Update references/model-methodology.md**

第 3 行版本说明改为 `The bundled core is generated from prediction-core v0.3.0 (maintained in this repository).`；Match Prediction 一节追加两行：

```markdown
- Dixon-Coles rho is a continuous linear function of average expected goals.
- Knockout draws use a two-stage extra-time/penalty advancement model.
```

末尾新增一节：

```markdown
## Market Integration

- Market snapshots are optional inputs; see `references/market-methodology.md`.
- Blended probabilities never replace model output; both are always reported.
- EV and fractional Kelly are analysis references only, never betting advice.
```

- [ ] **Step 4: Update SKILL.md**

- description 行追加触发词：在 `or cautious China football lottery 3/1/0 reference lists` 前插入 `Asian handicap and over/under fair pricing, market odds blending and value scanning (Polymarket or manual odds), `。
- Workflow 第 4 步命令块追加：

```bash
node scripts/predict-markets.mjs --data <snapshot> --home FRA --away BRA
node scripts/fetch-market.mjs --manual <odds.json> --out market.json
node scripts/value-scan.mjs --data <snapshot> --market market.json
```

- Workflow 追加第 7 步：`7. When a market snapshot is supplied, report model, devigged market, and blended probabilities together, plus divergence flags. Treat EV/Kelly as analysis references only. Warn when the snapshot is stale.`
- Non-Negotiable Rules 追加三条：

```markdown
- Asian handicap, over/under, and BTTS outputs always use the `90minResult` scope.
- Market snapshots never modify `dataVersion`; blended and pure-model probabilities must both be reported.
- Never present EV or Kelly fractions as betting advice or guaranteed value.
```

- Bundled Data 追加：`- assets/sample-data/market-snapshot.json: synthetic manual-odds market snapshot for smoke tests.`
- References 追加：`- Read references/market-methodology.md before explaining market blending, devig, fair pricing, EV, or Kelly outputs.`

- [ ] **Step 5: Update README.md and README.en.md**

README.md「能力」列表追加：

```markdown
- 从同一比分矩阵推导亚盘（含 quarter 盘拆盘）、大小球全线位与 BTTS 公平定价。
- 拉取 Polymarket 或手填博彩赔率生成市场快照，去水后与模型概率加权融合（默认市场 0.7）。
- 输出模型 vs 市场分歧报告、EV 与 1/4 Kelly 分析参考（非购彩建议）。
```

「命令行示例」追加：

```bash
# 全盘口定价（亚盘/大小球/BTTS）
node scripts/predict-markets.mjs \
  --data assets/sample-data/worldcup-2026.json \
  --home MEX --away KOR

# 市场快照（手填赔率或 Polymarket）
node scripts/fetch-market.mjs --manual my-odds.json --out market.json

# 价值扫描：去水、融合、分歧、EV/Kelly
node scripts/value-scan.mjs \
  --data assets/sample-data/worldcup-2026.json \
  --market assets/sample-data/market-snapshot.json
```

「30 秒开始」自然语言示例追加：

```text
使用世界杯预测机，这场球亚盘让半球该怎么看？
使用世界杯预测机，2.5 大小球的公平概率是多少？
使用世界杯预测机，对比一下模型和 Polymarket 的冠军概率谁高。
使用世界杯预测机，这份赔率里有没有偏离模型的价值点？
```

开发与验证一节中 `core/ 是由上游 packages/prediction-core 确定性生成的快照，请不要手动修改。` 改为 `core/ 即 prediction-core 的事实源头，在本仓库直接迭代；修改后运行 npm run update-core-manifest 刷新清单。`

README.en.md 做对应英文同步（能力 3 条、命令示例、core 维护说明）。

- [ ] **Step 6: Update package.json smoke script**

```json
"smoke": "node scripts/predict-match.mjs --home MEX --away KOR > /dev/null && node scripts/predict-match.mjs --home MEX --away KOR --market assets/sample-data/market-snapshot.json > /dev/null && node scripts/predict-markets.mjs --home MEX --away KOR > /dev/null && node scripts/value-scan.mjs --market assets/sample-data/market-snapshot.json > /dev/null && node scripts/simulate-tournament.mjs --simulations 2 --seed smoke > /dev/null && node scripts/generate-lottery-slip.mjs --strategy balanced --budget 288 > /dev/null"
```

description 字段更新为：`"A deterministic World Cup prediction Agent Skill with audited offline inputs, market odds blending, and multi-market fair pricing."`，keywords 追加 `"asian-handicap", "betting-markets", "polymarket"`。

- [ ] **Step 7: Run full verification**

Run: `npm test && npm run smoke`
Expected: 全部 PASS、smoke 退出码 0

- [ ] **Step 8: Commit**

```bash
git add references/ SKILL.md README.md README.en.md package.json
git commit -m "docs: document v0.3 market pricing, blending and value scanning"
```

---

### Task 10: 终验

- [ ] **Step 1: Full test + smoke**

Run: `npm test && npm run smoke`
Expected: 全部 PASS

- [ ] **Step 2: Standalone copy sanity**

Run: `node --test tests/skill.test.mjs`（包含拷贝目录独立运行全部 CLI 的测试）
Expected: PASS

- [ ] **Step 3: 检查无遗漏**

逐条核对设计文档验收点：盘口求和=1、quarter 拆盘、去水归一、融合边界 w=0/1、无市场回退、Kelly 上限、口径分离、免责声明、`llm_extraction` 过滤不变。对应测试均存在且通过。

- [ ] **Step 4: Final commit (if any stragglers)**

```bash
git status
git add -A && git commit -m "chore: finalize v0.3 market upgrade"
```
