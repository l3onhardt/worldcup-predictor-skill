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

export function handicapValueMetrics(outcomes, decimalPrice) {
  if (!Number.isFinite(decimalPrice) || decimalPrice <= 1) {
    throw new Error("decimal price must be greater than 1.");
  }
  const fullWin = outcomes.fullWin ?? 0;
  const halfWin = outcomes.halfWin ?? 0;
  const halfLose = outcomes.halfLose ?? 0;
  const fullLose = outcomes.fullLose ?? 0;
  const winProfit = decimalPrice - 1;
  const ev = fullWin * winProfit + halfWin * (winProfit / 2) - halfLose * 0.5 - fullLose;
  const winEquivalent = fullWin + halfWin * 0.5;
  const lossEquivalent = fullLose + halfLose * 0.5;
  const denominator = winEquivalent * winProfit + lossEquivalent;
  const fullKelly = denominator > 0 ? ev / denominator : 0;
  const kellyFraction = clamp(Math.max(0, fullKelly) / KELLY_DIVISOR, 0, KELLY_CAP);
  return { ev: round(ev), kellyFraction: round(kellyFraction) };
}
