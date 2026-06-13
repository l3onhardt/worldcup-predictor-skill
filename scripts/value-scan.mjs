#!/usr/bin/env node
// Market vs model trading scan: devig -> blend -> divergence -> EV/Kelly -> trade ranking.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_DIVERGENCE_THRESHOLD,
  DEFAULT_MARKET_WEIGHT,
  blendProbabilities,
  devigPower,
  devigProportional,
  divergenceReport,
  handicapValueMetrics,
  priceMatchMarkets,
  predictMatch,
  valueMetrics,
} from "../core/index.mjs";
import { round } from "../core/utils.mjs";
import { auditSnapshot, fail, parseArgs, readJson } from "./audit-input.mjs";
import { verifyCommit } from "./blind-commit.mjs";
import { auditMarketSnapshot, marketAgeHours } from "./market-input.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultDataPath = resolve(scriptDir, "../assets/sample-data/worldcup-2026.json");
const defaultBlindLogPath = resolve(scriptDir, "../logs/blind-commits.jsonl");
const usage =
  "Usage: node scripts/value-scan.mjs --market <market-snapshot.json> [--data <audited-snapshot.json>] [--weight 0.7] [--devig power|proportional] [--threshold 0.05] [--max-age-hours 24] [--blind-log <jsonl>] [--require-blind-commit]";
const labels = ["3", "1", "0"];
const args = parseArgs(process.argv.slice(2));

if (args.help || !args.market) fail("Missing required --market argument.", usage);

function closeLine(left, right) {
  return Math.abs(left - right) < 1e-9;
}

function findOutcome(market, aliases) {
  const normalized = new Set(aliases.map((alias) => String(alias).toLowerCase()));
  return market.outcomes.find((outcome) => normalized.has(String(outcome.name).toLowerCase()));
}

function bestByEv(entries) {
  return entries.reduce((best, entry) => (entry.ev > best.ev ? entry : best));
}

function matchInputFromState({ snapshot, state, homeTeam, awayTeam }) {
  return {
    matchId: state.matchId,
    homeTeam,
    awayTeam,
    stage: state.stage,
    modelVersion: snapshot.metadata.modelVersion,
    dataVersion: snapshot.metadata.dataVersion,
    generatedAt: snapshot.metadata.generatedAt,
    venueCountryCode: state.venueCountryCode,
    contextAdjustments: snapshot.contextAdjustments,
  };
}

function blindCommitForMatch({ args, blindLogPath, marketFetchedAt, prediction, snapshot, state }) {
  const blindCommit = verifyCommit(
    blindLogPath,
    state.matchId,
    snapshot.metadata.dataVersion,
    { "3": prediction.homeWin90Prob, "1": prediction.draw90Prob, "0": prediction.awayWin90Prob },
    marketFetchedAt,
  );
  if (args["require-blind-commit"] && !blindCommit.verified) {
    throw new Error(`blind commit required but not verified for ${state.matchId}: ${blindCommit.note}`);
  }
  return blindCommit;
}

function scanOneXTwo({ market, state, homeTeam, awayTeam, marketBook, prediction, blindCommit, devig, weight, threshold }) {
  const modelProbs = [prediction.homeWin90Prob, prediction.draw90Prob, prediction.awayWin90Prob];
  const orderedOutcomes = labels.map((name) => {
    const outcome = market.outcomes.find((entry) => entry.name === name);
    if (!outcome) throw new Error(`Market ${market.matchId} is missing outcome ${name}.`);
    return outcome;
  });
  const marketProbs = devig(orderedOutcomes.map((outcome) => outcome.impliedProb));
  const blended = blendProbabilities(marketProbs, modelProbs, weight);
  const divergence = divergenceReport(modelProbs, marketProbs, threshold);
  const fairOdds = [
    marketBook.oneXTwo.fairOdds.home,
    marketBook.oneXTwo.fairOdds.draw,
    marketBook.oneXTwo.fairOdds.away,
  ];
  const valueEntries = labels.map((name, index) => ({
    outcome: name,
    price: orderedOutcomes[index].price,
    fairOdds: fairOdds[index],
    ...valueMetrics(blended[index], orderedOutcomes[index].price),
  }));
  const candidate = {
    type: "1x2",
    matchId: state.matchId,
    homeTeam: homeTeam.name,
    awayTeam: awayTeam.name,
    resultScope: "90minResult",
    blindCommit,
    overround: market.overround,
    model90Prob: Object.fromEntries(labels.map((name, index) => [name, round(modelProbs[index])])),
    market90Prob: Object.fromEntries(labels.map((name, index) => [name, round(marketProbs[index])])),
    blended90Prob: Object.fromEntries(labels.map((name, index) => [name, round(blended[index])])),
    divergence: divergence.map((entry, index) => ({ outcome: labels[index], ...entry })),
    valueMetrics: valueEntries,
    bestValue: bestByEv(valueEntries),
  };
  return candidate;
}

function sideValueEntry({ market, side, line }) {
  const offered = findOutcome(market, side.aliases);
  if (!offered) throw new Error(`Market ${market.matchId} ${market.type} ${line} is missing ${side.outcome}.`);
  return {
    outcome: side.outcome,
    side: side.outcome,
    line,
    price: offered.price,
    fairOdds: side.model.fairOdds,
    fullWin: round(side.model.fullWin),
    halfWin: round(side.model.halfWin),
    push: round(side.model.push),
    halfLose: round(side.model.halfLose),
    fullLose: round(side.model.fullLose),
    ...handicapValueMetrics(side.model, offered.price),
  };
}

function scanAsianHandicap({ market, state, homeTeam, awayTeam, marketBook, blindCommit }) {
  const pricedLine = marketBook.asianHandicaps.find((entry) => closeLine(entry.line, market.line));
  if (!pricedLine) return null;
  const valueEntries = [
    { outcome: "home", aliases: ["home", "3", "h"], model: pricedLine.home },
    { outcome: "away", aliases: ["away", "0", "a"], model: pricedLine.away },
  ].map((side) => sideValueEntry({ market, side, line: market.line }));
  return {
    type: "ah",
    matchId: state.matchId,
    homeTeam: homeTeam.name,
    awayTeam: awayTeam.name,
    resultScope: "90minResult",
    blindCommit,
    line: market.line,
    overround: market.overround,
    valueMetrics: valueEntries,
    bestValue: bestByEv(valueEntries),
  };
}

function scanOverUnder({ market, state, homeTeam, awayTeam, marketBook, blindCommit }) {
  const pricedLine = marketBook.overUnders.find((entry) => closeLine(entry.line, market.line));
  if (!pricedLine) return null;
  const valueEntries = [
    { outcome: "over", aliases: ["over", "o"], model: pricedLine.over },
    { outcome: "under", aliases: ["under", "u"], model: pricedLine.under },
  ].map((side) => sideValueEntry({ market, side, line: market.line }));
  return {
    type: "ou",
    matchId: state.matchId,
    homeTeam: homeTeam.name,
    awayTeam: awayTeam.name,
    resultScope: "90minResult",
    blindCommit,
    line: market.line,
    overround: market.overround,
    valueMetrics: valueEntries,
    bestValue: bestByEv(valueEntries),
  };
}

try {
  const snapshot = auditSnapshot(readJson(args.data || defaultDataPath));
  const marketSnapshot = auditMarketSnapshot(readJson(args.market));
  const weight = args.weight === undefined ? DEFAULT_MARKET_WEIGHT : Number(args.weight);
  const threshold = args.threshold === undefined ? DEFAULT_DIVERGENCE_THRESHOLD : Number(args.threshold);
  const maxAgeHours = args["max-age-hours"] === undefined ? 24 : Number(args["max-age-hours"]);
  const devig = (args.devig ?? "power") === "proportional" ? devigProportional : devigPower;
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error("--weight must be between 0 and 1.");

  const teamsById = new Map(snapshot.teams.map((team) => [team.id, team]));
  const blindLogPath = args["blind-log"] || defaultBlindLogPath;
  const matches = [];
  const markets = [];

  for (const market of marketSnapshot.markets) {
    if (market.type === "outright") continue;
    const state = snapshot.matchStates.find((entry) => entry.matchId === market.matchId);
    if (!state) continue;
    const homeTeam = teamsById.get(state.homeTeamId);
    const awayTeam = teamsById.get(state.awayTeamId);
    if (!homeTeam || !awayTeam) continue;

    const matchInput = matchInputFromState({ snapshot, state, homeTeam, awayTeam });
    const prediction = predictMatch(matchInput);
    const marketBook = priceMatchMarkets(matchInput);
    const blindCommit = blindCommitForMatch({
      args,
      blindLogPath,
      marketFetchedAt: marketSnapshot.fetchedAt,
      prediction,
      snapshot,
      state,
    });

    if (market.type === "1x2") {
      const candidate = scanOneXTwo({
        market,
        state,
        homeTeam,
        awayTeam,
        marketBook,
        prediction,
        blindCommit,
        devig,
        weight,
        threshold,
      });
      matches.push(candidate);
      markets.push(candidate);
    } else if (market.type === "ah") {
      const candidate = scanAsianHandicap({ market, state, homeTeam, awayTeam, marketBook, blindCommit });
      if (candidate) markets.push(candidate);
    } else if (market.type === "ou") {
      const candidate = scanOverUnder({ market, state, homeTeam, awayTeam, marketBook, blindCommit });
      if (candidate) markets.push(candidate);
    }
  }

  matches.sort((left, right) => right.bestValue.ev - left.bestValue.ev);
  markets.sort((left, right) => right.bestValue.ev - left.bestValue.ev);

  const ageHours = marketAgeHours(marketSnapshot, snapshot.metadata.generatedAt);
  const report = {
    modelVersion: snapshot.metadata.modelVersion,
    dataVersion: snapshot.metadata.dataVersion,
    marketSource: marketSnapshot.source,
    marketFetchedAt: marketSnapshot.fetchedAt,
    marketSourceQuality: marketSnapshot.sourceQuality ?? null,
    marketAgeHours: ageHours === null ? null : round(ageHours, 2),
    staleWarning:
      ageHours !== null && ageHours > maxAgeHours
        ? `Market snapshot is ${round(ageHours, 1)} hours from event snapshot, above ${maxAgeHours} hour threshold.`
        : undefined,
    marketWeight: weight,
    devigMethod: args.devig ?? "power",
    matches,
    markets,
    tradingNote:
      "EV and Kelly rank candidate trades. Apply liquidity, lineup, stale-data, correlation, and invalidation haircuts before final sizing.",
  };
  if (markets.length === 0) {
    report.fallback = "model_only";
    report.note = "No 1x2/AH/OU market in the market snapshot matched the audited event snapshot.";
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), usage);
}
