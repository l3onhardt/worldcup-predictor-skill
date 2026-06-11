#!/usr/bin/env node
// 跨平台 smoke：依次运行全部 CLI，丢弃 stdout，仅校验退出码与 JSON 可解析。
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commands = [
  ["scripts/predict-match.mjs", "--home", "MEX", "--away", "KOR"],
  ["scripts/predict-match.mjs", "--home", "MEX", "--away", "KOR", "--market", "assets/sample-data/market-snapshot.json"],
  ["scripts/predict-markets.mjs", "--home", "MEX", "--away", "KOR"],
  ["scripts/value-scan.mjs", "--market", "assets/sample-data/market-snapshot.json"],
  ["scripts/simulate-tournament.mjs", "--simulations", "2", "--seed", "smoke"],
  ["scripts/generate-lottery-slip.mjs", "--strategy", "balanced", "--budget", "288"],
];

for (const command of commands) {
  const result = spawnSync(process.execPath, command, { cwd: skillDir, encoding: "utf8" });
  if (result.status !== 0) {
    console.error(`smoke failed: ${command.join(" ")}\n${result.stderr}`);
    process.exit(1);
  }
  try {
    JSON.parse(result.stdout);
  } catch {
    console.error(`smoke failed: ${command.join(" ")} did not produce valid JSON.`);
    process.exit(1);
  }
  console.error(`ok: ${command.join(" ")}`);
}
console.error("smoke passed.");
