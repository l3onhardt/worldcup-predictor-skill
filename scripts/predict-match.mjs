#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_MARKET_WEIGHT,
  blendProbabilities,
  devigPower,
  divergenceReport,
  predictMatch,
} from "../core/index.mjs";
import { auditSnapshot, fail, findMatchState, findTeam, parseArgs, readJson } from "./audit-input.mjs";
import { auditMarketSnapshot, findMarketForMatch } from "./market-input.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const defaultDataPath = resolve(scriptDir, "../assets/sample-data/worldcup-2026.json");
const usage =
  "Usage: node scripts/predict-match.mjs --home FRA --away BRA [--data <audited-snapshot.json>] [--match match-id] [--stage group] [--venue-country USA] [--market <market-snapshot.json>] [--weight 0.7]";
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
  const prediction = predictMatch({
    matchId: args.match || matchState?.matchId,
    homeTeam,
    awayTeam,
    stage: args.stage || matchState?.stage,
    modelVersion: snapshot.metadata.modelVersion,
    dataVersion: snapshot.metadata.dataVersion,
    generatedAt: snapshot.metadata.generatedAt,
    venueCountryCode: args["venue-country"] || matchState?.venueCountryCode,
    contextAdjustments: snapshot.contextAdjustments,
  });

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
      prediction.marketBlend = {
        fallback: "model_only",
        note: `市场快照中没有 matchId 为 ${prediction.matchId} 的 1x2 盘口。`,
      };
    }
  }
  console.log(JSON.stringify(prediction, null, 2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), usage);
}
