#!/usr/bin/env node
// 盲注承诺：在接触市场数据之前，把纯模型预测哈希落盘（只追加 jsonl）。
// 时间序 committedAt < market.fetchedAt 在审计日志中可验证——证明模型概率未被市场锚定。

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { predictMatch } from "../core/index.mjs";
import { auditSnapshot, fail, parseArgs, readJson } from "./audit-input.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(scriptDir, "..");
const defaultDataPath = join(skillDir, "assets/sample-data/worldcup-2026.json");
const defaultLogPath = join(skillDir, "logs/blind-commits.jsonl");
const usage =
  "Usage: node scripts/blind-commit.mjs [--data <snapshot.json>] (--matches id1,id2 | --all) [--log <blind-commits.jsonl>]";

function entryHash(probs, dataVersion) {
  return createHash("sha256")
    .update(JSON.stringify({ probs, dataVersion }))
    .digest("hex");
}

export function commitPredictions(predictions, logPath, committedAt) {
  mkdirSync(dirname(logPath), { recursive: true });
  const entries = predictions.map((prediction) => ({
    matchId: prediction.matchId,
    dataVersion: prediction.dataVersion,
    modelVersion: prediction.modelVersion,
    probs: prediction.probs,
    hash: entryHash(prediction.probs, prediction.dataVersion),
    committedAt,
  }));
  appendFileSync(logPath, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
  return entries;
}

export function verifyCommit(logPath, matchId, dataVersion, probs, marketFetchedAt) {
  if (!existsSync(logPath)) {
    return { verified: false, note: `no blind commit log at ${logPath}.` };
  }
  const entries = readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.matchId === matchId && entry.dataVersion === dataVersion);
  if (entries.length === 0) {
    return { verified: false, note: `no blind commit for ${matchId} @ ${dataVersion}.` };
  }
  // 取最早的承诺：后补的承诺不能改善时间序。
  const earliest = entries.reduce((left, right) =>
    new Date(left.committedAt) <= new Date(right.committedAt) ? left : right,
  );
  if (entryHash(probs, dataVersion) !== earliest.hash) {
    return { verified: false, note: "hash mismatch: current model probabilities differ from committed ones." };
  }
  if (marketFetchedAt && new Date(earliest.committedAt) >= new Date(marketFetchedAt)) {
    return { verified: false, note: "market data predates the blind commit; time order not provable." };
  }
  return { verified: true, committedAt: earliest.committedAt, hash: earliest.hash };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.matches && !args.all)) fail("Provide --matches id1,id2 or --all.", usage);
  const snapshot = auditSnapshot(readJson(args.data || defaultDataPath));
  const logPath = args.log || defaultLogPath;
  const teamsById = new Map(snapshot.teams.map((team) => [team.id, team]));
  const wanted = args.all ? null : new Set(String(args.matches).split(",").map((id) => id.trim()));

  const predictions = [];
  for (const state of snapshot.matchStates) {
    if (wanted && !wanted.has(state.matchId)) continue;
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
    predictions.push({
      matchId: prediction.matchId,
      dataVersion: prediction.dataVersion,
      modelVersion: prediction.modelVersion,
      probs: { "3": prediction.homeWin90Prob, "1": prediction.draw90Prob, "0": prediction.awayWin90Prob },
    });
  }
  if (predictions.length === 0) fail("No matching match states found in snapshot.", usage);
  const entries = commitPredictions(predictions, logPath, new Date().toISOString());
  console.log(JSON.stringify({ log: logPath, committed: entries }, null, 2));
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error), usage));
}
