import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseEloTsv, eloQualityGate } from "../scripts/sources/elo-ratings.mjs";
import { parseFifaRanking, fifaQualityGate } from "../scripts/sources/fifa-ranking.mjs";
import { parseFootballData, footballDataQualityGate } from "../scripts/sources/football-data.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const eloFixture = readFileSync(join(skillDir, "tests/fixtures/elo-world.tsv"), "utf8");

test("elo adapter parses real-world TSV into code/rating records", () => {
  const records = parseEloTsv(eloFixture);
  assert.ok(records.length > 200);
  const spain = records.find((entry) => entry.code === "ES");
  assert.ok(spain);
  assert.ok(spain.rating > 1900 && spain.rating < 2400);
  for (const entry of records.slice(0, 50)) {
    assert.equal(typeof entry.code, "string");
    assert.ok(Number.isFinite(entry.rating));
  }
});

test("elo quality gate rejects tiny or corrupt payloads", () => {
  assert.throws(() => eloQualityGate(parseEloTsv("1\t1\tXX\tabc\n")), /quality gate/i);
  assert.throws(() => eloQualityGate([]), /quality gate/i);
  // 真实数据应通过
  assert.doesNotThrow(() => eloQualityGate(parseEloTsv(eloFixture)));
});

test("elo quality gate rejects out-of-range ratings", () => {
  const records = Array.from({ length: 120 }, (_, index) => ({ code: `T${index}`, rating: 9999 }));
  assert.throws(() => eloQualityGate(records), /quality gate/i);
});

test("fifa adapter parses ranking JSON and gates empty payloads", () => {
  const sample = {
    rankings: [
      { rankingItem: { name: "Argentina", countryCode: "ARG", rank: 1, totalPoints: 1860.14 } },
      { rankingItem: { name: "France", countryCode: "FRA", rank: 2, totalPoints: 1855.0 } },
    ],
  };
  const records = parseFifaRanking(JSON.stringify(sample));
  assert.equal(records.length, 2);
  assert.deepEqual(records[1], { name: "France", countryCode: "FRA", rank: 2, points: 1855.0 });
  assert.throws(() => fifaQualityGate(parseFifaRanking('{"rankings":[]}')), /quality gate/i);
});

test("football-data adapter parses finished matches and gates wrong competition", () => {
  const sample = {
    competition: { code: "WC" },
    matches: [
      {
        id: 1001,
        status: "FINISHED",
        stage: "GROUP_STAGE",
        homeTeam: { name: "Mexico" },
        awayTeam: { name: "South Africa" },
        score: { fullTime: { home: 2, away: 0 } },
      },
      {
        id: 1002,
        status: "TIMED",
        stage: "GROUP_STAGE",
        homeTeam: { name: "France" },
        awayTeam: { name: "United States" },
        score: { fullTime: { home: null, away: null } },
      },
    ],
  };
  const records = parseFootballData(JSON.stringify(sample));
  assert.equal(records.finished.length, 1);
  assert.deepEqual(records.finished[0], {
    externalId: 1001,
    stage: "group",
    homeName: "Mexico",
    awayName: "South Africa",
    score: { home: 2, away: 0 },
  });
  assert.doesNotThrow(() => footballDataQualityGate(records));
  const wrongCompetition = { ...sample, competition: { code: "PL" } };
  assert.throws(
    () => footballDataQualityGate(parseFootballData(JSON.stringify(wrongCompetition))),
    /quality gate/i,
  );
});
