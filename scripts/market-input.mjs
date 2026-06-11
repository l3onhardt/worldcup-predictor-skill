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
    if (!marketTypes.has(market.type)) {
      throw new Error(`markets[${index}].type must be one of ${[...marketTypes].join(", ")}.`);
    }
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
