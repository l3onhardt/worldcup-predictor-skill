import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { commitPredictions, verifyCommit } from "../scripts/blind-commit.mjs";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const samplePrediction = {
  matchId: "MEX-RSA",
  dataVersion: "official-test",
  modelVersion: "model-v0.3-market",
  probs: { "3": 0.5812, "1": 0.2455, "0": 0.1733 },
};

test("commitPredictions writes verifiable hash entries", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "blind-commit-"));
  const logPath = join(tempDir, "blind-commits.jsonl");
  try {
    const entries = commitPredictions([samplePrediction], logPath, "2026-06-11T10:00:00.000Z");
    assert.equal(entries.length, 1);
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.matchId, "MEX-RSA");
    assert.equal(entry.committedAt, "2026-06-11T10:00:00.000Z");
    assert.equal(typeof entry.hash, "string");
    assert.equal(entry.hash.length, 64);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("verifyCommit confirms hash and time order, rejects tampering", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "blind-commit-"));
  const logPath = join(tempDir, "blind-commits.jsonl");
  try {
    commitPredictions([samplePrediction], logPath, "2026-06-11T10:00:00.000Z");
    const ok = verifyCommit(logPath, "MEX-RSA", "official-test", samplePrediction.probs, "2026-06-11T11:00:00.000Z");
    assert.equal(ok.verified, true);
    assert.equal(ok.committedAt, "2026-06-11T10:00:00.000Z");

    // 市场快照早于承诺 → 时间序不成立
    const tooEarly = verifyCommit(logPath, "MEX-RSA", "official-test", samplePrediction.probs, "2026-06-11T09:00:00.000Z");
    assert.equal(tooEarly.verified, false);
    assert.match(tooEarly.note, /market data predates/i);

    // 概率被篡改 → 哈希不匹配
    const tampered = verifyCommit(logPath, "MEX-RSA", "official-test", { "3": 0.9, "1": 0.05, "0": 0.05 }, "2026-06-11T11:00:00.000Z");
    assert.equal(tampered.verified, false);
    assert.match(tampered.note, /hash mismatch/i);

    // 不存在的 matchId
    const missing = verifyCommit(logPath, "FRA-USA", "official-test", samplePrediction.probs, "2026-06-11T11:00:00.000Z");
    assert.equal(missing.verified, false);
    assert.match(missing.note, /no blind commit/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("blind-commit CLI commits sample match and value-scan reports blindCommit", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "blind-commit-cli-"));
  const logPath = join(tempDir, "blind-commits.jsonl");
  const marketPath = join(tempDir, "market.json");
  try {
    const commit = spawnSync(
      process.execPath,
      ["scripts/blind-commit.mjs", "--matches", "sample-group-a-1", "--log", logPath],
      { cwd: skillDir, encoding: "utf8" },
    );
    assert.equal(commit.status, 0, commit.stderr);
    const committed = JSON.parse(commit.stdout);
    assert.equal(committed.committed.length, 1);
    assert.equal(committed.committed[0].matchId, "sample-group-a-1");

    // 市场快照必须晚于承诺时间，时间序才可证明
    const baseMarket = JSON.parse(
      readFileSync(join(skillDir, "assets/sample-data/market-snapshot.json"), "utf8"),
    );
    writeFileSync(marketPath, JSON.stringify({ ...baseMarket, fetchedAt: "2099-01-01T00:00:00.000Z" }));

    const scan = spawnSync(
      process.execPath,
      ["scripts/value-scan.mjs", "--market", marketPath, "--blind-log", logPath],
      { cwd: skillDir, encoding: "utf8" },
    );
    assert.equal(scan.status, 0, scan.stderr);
    const report = JSON.parse(scan.stdout);
    const match = report.matches[0];
    assert.ok(match.blindCommit);
    assert.equal(match.blindCommit.verified, true, JSON.stringify(match.blindCommit));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("value-scan --require-blind-commit fails without a commit", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "blind-commit-missing-"));
  const emptyLog = join(tempDir, "empty.jsonl");
  try {
    const scan = spawnSync(
      process.execPath,
      [
        "scripts/value-scan.mjs",
        "--market", "assets/sample-data/market-snapshot.json",
        "--blind-log", emptyLog,
        "--require-blind-commit",
      ],
      { cwd: skillDir, encoding: "utf8" },
    );
    assert.notEqual(scan.status, 0);
    assert.match(scan.stderr, /blind commit/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
