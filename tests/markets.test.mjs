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
