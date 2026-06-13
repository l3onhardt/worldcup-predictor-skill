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
  handicapValueMetrics,
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

test("handicap value metrics price full, half, and push outcomes", () => {
  const value = handicapValueMetrics(
    {
      fullWin: 0.42,
      halfWin: 0.08,
      push: 0.12,
      halfLose: 0.1,
      fullLose: 0.28,
    },
    2.05,
  );
  const expectedEv = 0.42 * 1.05 + 0.08 * 0.525 - 0.1 * 0.5 - 0.28;
  assert.ok(Math.abs(value.ev - expectedEv) < 1e-4);
  assert.ok(value.kellyFraction > 0);

  const negative = handicapValueMetrics(
    {
      fullWin: 0.25,
      halfWin: 0.05,
      push: 0.2,
      halfLose: 0.15,
      fullLose: 0.35,
    },
    1.9,
  );
  assert.ok(negative.ev < 0);
  assert.equal(negative.kellyFraction, 0);
});
