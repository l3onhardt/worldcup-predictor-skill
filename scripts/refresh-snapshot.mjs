#!/usr/bin/env node
// 基本面快照刷新调度器：按 TTL 抓取过期源 → 质量门 → 合并 → 重算版本 → 完整审计后落盘。
// 任一源失败保留旧数据并标注 degraded，绝不混入半成品。市场数据与本管道物理隔离。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { auditSnapshot, contentHash, dataVersionFromSources, fail, parseArgs, readJson } from "./audit-input.mjs";
import { staleSources, touchSource } from "./freshness.mjs";
import * as elo from "./sources/elo-ratings.mjs";
import * as fifa from "./sources/fifa-ranking.mjs";
import * as fd from "./sources/football-data.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const skillDir = resolve(scriptDir, "..");
const defaultManifestPath = join(skillDir, "assets/freshness-manifest.json");
const defaultAliasesPath = join(skillDir, "assets/team-aliases.json");
const usage =
  "Usage: node scripts/refresh-snapshot.mjs --base <snapshot.json> --out <snapshot.json> [--force] [--check] [--manifest <freshness.json>]";

const MAX_RATING_JUMP = 400;

export function mergeEloRatings(teams, eloRecords, aliases) {
  const byCode = new Map(eloRecords.map((record) => [record.code, record.rating]));
  const codeForTeam = new Map(Object.entries(aliases.eloCodes ?? {}).map(([elo, id]) => [id, elo]));
  let updated = 0;
  const unmatched = [];
  const suspicious = [];
  const merged = teams.map((team) => {
    const eloCode = codeForTeam.get(team.id);
    const rating = eloCode === undefined ? undefined : byCode.get(eloCode);
    if (!Number.isFinite(rating)) {
      unmatched.push(team.id);
      return team;
    }
    const previous = team.ratingValue ?? team.eloRating;
    if (Number.isFinite(previous) && Math.abs(rating - previous) > MAX_RATING_JUMP) {
      // 评分突变更可能是别名映射错误而非真实实力变化：保留旧值并上报。
      suspicious.push({ teamId: team.id, previous, fetched: rating });
      return team;
    }
    updated += 1;
    return { ...team, ratingValue: rating, ratingSource: "elo-ratings" };
  });
  return { teams: merged, updated, unmatched, suspicious };
}

export function mergeFifaRanks(teams, fifaRecords, aliases) {
  const nameMap = aliases.names ?? {};
  const rankByTeamId = new Map();
  for (const record of fifaRecords) {
    const id = nameMap[String(record.name ?? "").toLowerCase()];
    if (id) rankByTeamId.set(id, record.rank);
  }
  let updated = 0;
  const merged = teams.map((team) => {
    const rank = rankByTeamId.get(team.id);
    if (!Number.isFinite(rank)) return team;
    updated += 1;
    return { ...team, fifaRank: rank };
  });
  return { teams: merged, updated };
}

export function mergeFinishedMatches(matchStates, teams, finishedRecords, aliases) {
  const nameMap = aliases.names ?? {};
  const teamIds = new Set(teams.map((team) => team.id));
  const resolveTeam = (name) => {
    const id = nameMap[String(name ?? "").toLowerCase()];
    return id && teamIds.has(id) ? id : null;
  };
  const states = matchStates.map((state) => ({ ...state }));
  const lockedPairs = new Map(
    states
      .filter((state) => state.status === "final")
      .map((state) => [[state.homeTeamId, state.awayTeamId].sort().join(":"), state]),
  );
  let added = 0;
  let skippedLocked = 0;
  let skippedUnmatched = 0;
  for (const record of finishedRecords) {
    const homeTeamId = resolveTeam(record.homeName);
    const awayTeamId = resolveTeam(record.awayName);
    if (!homeTeamId || !awayTeamId) {
      skippedUnmatched += 1;
      continue;
    }
    const pairKey = [homeTeamId, awayTeamId].sort().join(":");
    if (lockedPairs.has(pairKey)) {
      // 已锁定的完成赛果是审计事实，外部源不得覆盖。
      skippedLocked += 1;
      continue;
    }
    const state = {
      matchId: `fd-${record.externalId}`,
      stage: record.stage,
      homeTeamId,
      awayTeamId,
      status: "final",
      actualScore90min: { home: record.score.home, away: record.score.away },
    };
    states.push(state);
    lockedPairs.set(pairKey, state);
    added += 1;
  }
  return { matchStates: states, added, skippedLocked, skippedUnmatched };
}

export function rebuildSnapshotVersions(snapshot, newSourceHashes, nowIso) {
  const strengthSnapshotVersion = `refreshed-${contentHash({
    base: snapshot.metadata.strengthSnapshotVersion,
    sources: newSourceHashes,
  }).slice(0, 12)}`;
  const sourceVersions = { ...snapshot.metadata.sourceVersions, ...newSourceHashes };
  const teams = snapshot.teams.map((team) => ({ ...team, strengthVersion: strengthSnapshotVersion }));
  return {
    ...snapshot,
    teams,
    metadata: {
      ...snapshot.metadata,
      sourceVersions,
      strengthSnapshotVersion,
      dataVersion: dataVersionFromSources(sourceVersions, strengthSnapshotVersion),
      generatedAt: nowIso,
    },
  };
}

const ADAPTERS = [
  {
    meta: elo.eloSourceMeta,
    run: async () => elo.eloQualityGate(elo.parseEloTsv(await elo.fetchRaw())),
  },
  {
    meta: fifa.fifaSourceMeta,
    run: async () => fifa.fifaQualityGate(fifa.parseFifaRanking(await fifa.fetchRaw())),
  },
  {
    meta: fd.footballDataSourceMeta,
    run: async () => fd.footballDataQualityGate(fd.parseFootballData(await fd.fetchRaw())),
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.base) fail("Missing required --base argument.", usage);
  const manifestPath = args.manifest || defaultManifestPath;
  const nowIso = new Date().toISOString();
  let manifest = readJson(manifestPath);
  const stale = args.force ? ADAPTERS.map((adapter) => adapter.meta.id) : staleSources(manifest, nowIso);

  if (args.check) {
    console.log(JSON.stringify({ checkedAt: nowIso, staleSources: stale, manifest: manifest.sources }, null, 2));
    return;
  }
  if (!args.out) fail("Missing required --out argument.", usage);

  const snapshot = readJson(args.base);
  const aliases = readJson(defaultAliasesPath);
  let teams = snapshot.teams;
  let matchStates = snapshot.matchStates ?? [];
  const newSourceHashes = {};
  const report = { refreshedAt: nowIso, sources: {} };

  for (const adapter of ADAPTERS) {
    const id = adapter.meta.id;
    if (!stale.includes(id)) {
      report.sources[id] = { status: "fresh_skip" };
      continue;
    }
    if (adapter.meta.requiresKey && !process.env[adapter.meta.requiresKey]) {
      report.sources[id] = { status: "skipped_no_key", note: `set ${adapter.meta.requiresKey} to enable` };
      continue;
    }
    try {
      const records = await adapter.run();
      if (id === "elo-ratings") {
        const result = mergeEloRatings(teams, records, aliases);
        teams = result.teams;
        report.sources[id] = { status: "ok", updatedTeams: result.updated, unmatched: result.unmatched, suspicious: result.suspicious };
      } else if (id === "fifa-ranking") {
        const result = mergeFifaRanks(teams, records, aliases);
        teams = result.teams;
        report.sources[id] = { status: "ok", updatedTeams: result.updated };
      } else if (id === "football-data") {
        const result = mergeFinishedMatches(matchStates, teams, records.finished, aliases);
        matchStates = result.matchStates;
        report.sources[id] = {
          status: "ok",
          addedMatches: result.added,
          skippedLocked: result.skippedLocked,
          skippedUnmatched: result.skippedUnmatched,
        };
      }
      const hash = contentHash(records);
      newSourceHashes[id] = hash;
      manifest = touchSource(manifest, id, nowIso, hash);
    } catch (error) {
      // 质量门或网络失败：保留旧数据，标注降级，绝不混入半成品。
      report.sources[id] = { status: "degraded_kept_previous", error: error instanceof Error ? error.message : String(error) };
    }
  }

  const refreshed = rebuildSnapshotVersions({ ...snapshot, teams, matchStates }, newSourceHashes, nowIso);
  const audited = auditSnapshot(refreshed);
  writeFileSync(args.out, `${JSON.stringify(refreshed, null, 2)}\n`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  report.out = args.out;
  report.dataVersion = audited.metadata.dataVersion;
  report.teamCount = audited.teams.length;
  report.completedMatches = audited.matchStates.filter((state) => state.status === "final").length;
  console.log(JSON.stringify(report, null, 2));
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error), usage));
}
