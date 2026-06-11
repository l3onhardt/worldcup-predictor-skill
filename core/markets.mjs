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
  // quarter 盘：拆为相邻两条非 quarter 线各押一半注。
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

// 概率分量保留全精度以保证各盘口严格归一；只对赔率做展示性舍入。
function sideWithFairOdds(outcomes) {
  const fair = fairDecimalOdds(outcomes);
  return { ...outcomes, fairOdds: fair === null ? null : round(fair, 3) };
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
    home: sideWithFairOdds(sideOutcomes(homeMargins, line)),
    away: sideWithFairOdds(sideOutcomes(awayMargins, -line)),
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
    over: sideWithFairOdds(sideOutcomes(overMargins, 0)),
    under: sideWithFairOdds(sideOutcomes(underMargins, 0)),
  };
}

export function bothTeamsToScore(distribution) {
  const yes = distribution
    .filter((entry) => entry.home > 0 && entry.away > 0)
    .reduce((sum, entry) => sum + entry.probability, 0);
  return { yes, no: 1 - yes };
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
  const awayWin90Prob = 1 - homeWin90Prob - draw90Prob;
  return {
    matchId: input.matchId ?? `${teamKey(input.homeTeam)}-${teamKey(input.awayTeam)}`,
    resultScope: "90minResult",
    homeTeamId: teamKey(input.homeTeam),
    awayTeamId: teamKey(input.awayTeam),
    expectedGoalsHome: round(expected.home, 2),
    expectedGoalsAway: round(expected.away, 2),
    oneXTwo: {
      homeWin90Prob: round(homeWin90Prob, 10),
      draw90Prob: round(draw90Prob, 10),
      awayWin90Prob: round(awayWin90Prob, 10),
      fairOdds: {
        home: round(1 / homeWin90Prob, 3),
        draw: round(1 / draw90Prob, 3),
        away: round(1 / awayWin90Prob, 3),
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
