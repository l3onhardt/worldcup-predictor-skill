import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { staleSources, touchSource } from "../scripts/freshness.mjs";
import { mergeEloRatings, mergeFinishedMatches, rebuildSnapshotVersions } from "../scripts/refresh-snapshot.mjs";
import { auditSnapshot } from "../scripts/audit-input.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function readSample(name) {
  return JSON.parse(readFileSync(join(skillDir, "assets/sample-data", name), "utf8"));
}

const NOW = "2026-06-11T12:00:00.000Z";

test("staleSources flags expired and never-fetched sources only", () => {
  const manifest = {
    sources: {
      "elo-ratings": { ttlHours: 24, lastFetchedAt: "2026-06-11T01:00:00.000Z" },
      "fifa-ranking": { ttlHours: 168, lastFetchedAt: "2026-06-01T00:00:00.000Z" },
      "football-data": { ttlHours: 1, lastFetchedAt: null },
    },
  };
  const stale = staleSources(manifest, NOW);
  assert.deepEqual(stale.sort(), ["fifa-ranking", "football-data"]);
});

test("touchSource updates lastFetchedAt and contentHash immutably", () => {
  const manifest = { sources: { "elo-ratings": { ttlHours: 24, lastFetchedAt: null } } };
  const touched = touchSource(manifest, "elo-ratings", NOW, "abc123");
  assert.equal(touched.sources["elo-ratings"].lastFetchedAt, NOW);
  assert.equal(touched.sources["elo-ratings"].contentHash, "abc123");
  assert.equal(manifest.sources["elo-ratings"].lastFetchedAt, null);
});

test("mergeEloRatings updates ratings via alias map and reports unmatched teams", () => {
  const snapshot = readSample("worldcup-2026.json");
  const aliases = JSON.parse(readFileSync(join(skillDir, "assets/team-aliases.json"), "utf8"));
  const eloRecords = [
    { code: "MX", rating: 1901 },
    { code: "ZA", rating: 1555 },
  ];
  const { teams, updated, unmatched } = mergeEloRatings(snapshot.teams, eloRecords, aliases);
  assert.equal(teams.find((team) => team.id === "MEX").ratingValue, 1901);
  assert.equal(teams.find((team) => team.id === "RSA").ratingValue, 1555);
  // 其余球队保留旧值
  assert.equal(teams.find((team) => team.id === "FRA").ratingValue, snapshot.teams.find((t) => t.id === "FRA").ratingValue);
  assert.equal(updated, 2);
  assert.ok(unmatched.includes("FRA"));
});

test("mergeFinishedMatches adds new results but never overwrites locked ones", () => {
  const snapshot = readSample("worldcup-2026.json");
  const aliases = JSON.parse(readFileSync(join(skillDir, "assets/team-aliases.json"), "utf8"));
  const finished = [
    // 已存在且锁定的 MEX vs KOR（快照里 2-1）—— 即便外部源给出不同比分也不得覆盖
    { externalId: 9001, stage: "group", homeName: "Mexico", awayName: "Korea Republic", score: { home: 9, away: 9 } },
    // 新完成场次应被加入
    { externalId: 9002, stage: "group", homeName: "France", awayName: "United States", score: { home: 2, away: 0 } },
  ];
  const { matchStates, added, skippedLocked } = mergeFinishedMatches(snapshot.matchStates, snapshot.teams, finished, aliases);
  const locked = matchStates.find((state) => state.matchId === "sample-group-a-1");
  assert.deepEqual(locked.actualScore90min, { home: 2, away: 1 });
  const newMatch = matchStates.find((state) => state.homeTeamId === "FRA" && state.awayTeamId === "USA");
  assert.ok(newMatch);
  assert.equal(newMatch.status, "final");
  assert.deepEqual(newMatch.actualScore90min, { home: 2, away: 0 });
  assert.equal(added, 1);
  assert.equal(skippedLocked, 1);
});

test("rebuildSnapshotVersions produces an auditable snapshot with refreshed versions", () => {
  const snapshot = readSample("worldcup-2026.json");
  const refreshed = rebuildSnapshotVersions(snapshot, { "elo-ratings": "hash-elo-1" }, NOW);
  assert.notEqual(refreshed.metadata.dataVersion, snapshot.metadata.dataVersion);
  assert.equal(refreshed.metadata.sourceVersions["elo-ratings"], "hash-elo-1");
  // 旧的预测源版本保留
  for (const key of Object.keys(snapshot.metadata.sourceVersions)) {
    assert.ok(refreshed.metadata.sourceVersions[key]);
  }
  assert.equal(refreshed.metadata.generatedAt, NOW);
  // 重建后的快照必须仍通过完整审计
  assert.doesNotThrow(() => auditSnapshot(refreshed));
});

test("mergeEloRatings keeps previous rating on suspicious jumps (alias-error guard)", () => {
  const snapshot = readSample("worldcup-2026.json");
  const aliases = JSON.parse(readFileSync(join(skillDir, "assets/team-aliases.json"), "utf8"));
  // SCO 旧值 1722，外部给 853（差 869 > 400）应被拒
  const { teams, suspicious } = mergeEloRatings(snapshot.teams, [{ code: "SQ", rating: 853 }], aliases);
  assert.equal(teams.find((team) => team.id === "SCO").ratingValue, 1722);
  assert.equal(suspicious.length, 1);
  assert.equal(suspicious[0].teamId, "SCO");
});
