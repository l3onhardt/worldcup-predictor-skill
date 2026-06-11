#!/usr/bin/env node
// 重新生成 core/manifest.json。core 在本仓库迭代后必须运行此脚本，否则 manifest 测试会失败。
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const coreDir = resolve(dirname(fileURLToPath(import.meta.url)), "../core");
const packageJson = JSON.parse(
  readFileSync(resolve(coreDir, "../package.json"), "utf8"),
);
const versionSource = readFileSync(join(coreDir, "version.mjs"), "utf8");
const modelVersion = versionSource.match(/DEFAULT_MODEL_VERSION = "([^"]+)"/)[1];
const coreVersion = versionSource.match(/PREDICTION_CORE_VERSION = "([^"]+)"/)[1];

const files = {};
for (const file of readdirSync(coreDir).filter((name) => name.endsWith(".mjs")).sort()) {
  files[file] = createHash("sha256").update(readFileSync(join(coreDir, file))).digest("hex");
}
const sourceHash = createHash("sha256").update(JSON.stringify(files)).digest("hex");

const manifest = {
  skillVersion: packageJson.version,
  sourceVersion: `prediction-core v${coreVersion} (in-repo)`,
  modelVersion,
  sourceHash,
  files,
};
writeFileSync(join(coreDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`core/manifest.json updated for prediction-core v${coreVersion}.`);
