import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { auditMarketSnapshot } from "../scripts/market-input.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("fetch-free-market normalizes composite free-source observations and appends history", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "worldcup-free-market-"));
  const inputPath = join(tempRoot, "composite.json");
  const outPath = join(tempRoot, "market.json");
  const historyDir = join(tempRoot, "history");
  writeFileSync(
    inputPath,
    JSON.stringify(
      {
        source: "free-composite",
        fetchedAt: "2026-06-04T12:00:00.000Z",
        observations: [
          {
            provider: "public-board-a",
            captureMethod: "browser",
            quality: 0.66,
            matchId: "sample-group-a-1",
            marketType: "1x2",
            homeName: "Mexico",
            awayName: "South Korea",
            prices: { home: 2.3, draw: 3.2, away: 3.1 },
          },
          {
            provider: "public-board-a",
            captureMethod: "browser",
            quality: 0.72,
            matchId: "sample-group-a-1",
            marketType: "ah",
            line: 0,
            prices: { home: 1.95, away: 1.95 },
          },
          {
            provider: "public-board-b",
            captureMethod: "api",
            quality: 0.78,
            matchId: "sample-group-a-1",
            marketType: "ou",
            line: 2.5,
            prices: { over: 1.98, under: 1.88 },
          },
        ],
      },
      null,
      2,
    ),
  );

  try {
    const result = spawnSync(
      process.execPath,
      ["scripts/fetch-free-market.mjs", "--composite", inputPath, "--out", outPath, "--append-history", historyDir],
      { cwd: skillDir, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(outPath), true);
    const snapshot = auditMarketSnapshot(JSON.parse(readFileSync(outPath, "utf8")));
    assert.equal(snapshot.source, "free-composite");
    assert.equal(snapshot.sourceQuality, 0.72);
    assert.deepEqual(snapshot.markets.map((market) => market.type).sort(), ["1x2", "ah", "ou"]);
    assert.equal(snapshot.markets.find((market) => market.type === "ah").line, 0);
    assert.equal(snapshot.markets.find((market) => market.type === "ou").line, 2.5);

    const historyPath = join(historyDir, "market-history.jsonl");
    assert.equal(existsSync(historyPath), true);
    const history = readFileSync(historyPath, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    assert.equal(history.length, 3);
    assert.ok(history.every((entry) => entry.source === "free-composite"));
    assert.ok(history.some((entry) => entry.market.type === "ah"));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("fetch-free-market converts The Odds API event export into 1x2, AH, and OU markets", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "worldcup-odds-api-"));
  const inputPath = join(tempRoot, "odds-api-event.json");
  writeFileSync(
    inputPath,
    JSON.stringify(
      {
        id: "event-1",
        home_team: "Mexico",
        away_team: "South Korea",
        bookmakers: [
          {
            key: "pinnacle",
            title: "Pinnacle",
            markets: [
              {
                key: "h2h",
                last_update: "2026-06-04T12:00:00.000Z",
                outcomes: [
                  { name: "Mexico", price: 2.3 },
                  { name: "Draw", price: 3.2 },
                  { name: "South Korea", price: 3.1 },
                ],
              },
              {
                key: "spreads",
                last_update: "2026-06-04T12:03:00.000Z",
                outcomes: [
                  { name: "Mexico", price: 1.95, point: 0 },
                  { name: "South Korea", price: 1.95, point: 0 },
                ],
              },
              {
                key: "totals",
                last_update: "2026-06-04T12:05:00.000Z",
                outcomes: [
                  { name: "Over", price: 1.9, point: 2.5 },
                  { name: "Under", price: 2, point: 2.5 },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );

  try {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/fetch-free-market.mjs",
        "--the-odds-api-file",
        inputPath,
        "--match-id",
        "sample-group-a-1",
        "--bookmaker",
        "pinnacle",
        "--source-quality",
        "0.82",
      ],
      { cwd: skillDir, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const snapshot = auditMarketSnapshot(JSON.parse(result.stdout));
    assert.equal(snapshot.source, "the-odds-api-free");
    assert.equal(snapshot.fetchedAt, "2026-06-04T12:05:00.000Z");
    assert.equal(snapshot.sourceQuality, 0.82);
    assert.deepEqual(snapshot.markets.map((market) => market.type).sort(), ["1x2", "ah", "ou"]);
    assert.equal(snapshot.markets.find((market) => market.type === "ah").outcomes[0].name, "home");
    assert.equal(snapshot.markets.find((market) => market.type === "ou").outcomes[0].name, "over");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("fetch-free-market reports skipped_no_key for free API fetches without a key", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/fetch-free-market.mjs", "--the-odds-api-event", "event-1", "--sport", "soccer_fifa_world_cup"],
    { cwd: skillDir, encoding: "utf8", env: { ...process.env, THE_ODDS_API_KEY: "" } },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "skipped_no_key");
  assert.equal(report.provider, "the-odds-api");
});
