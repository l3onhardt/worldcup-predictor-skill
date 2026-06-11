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
