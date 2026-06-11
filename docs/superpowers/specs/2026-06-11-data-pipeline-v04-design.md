# 世界杯预测机 v0.4 设计：双管道数据架构 + 盲注承诺 + 模型独立性防火墙

日期：2026-06-11
状态：已获用户批准

## 目标

解决 v0.3 暴露的两个核心问题：

1. **基本面快照过期**：市场数据实时、基本面快照静态，分歧报告退化为"快照旧了"而非"市场错了"，价值识别失效。
2. **模型独立性不可证明**：用户（及任何审计方）无法证明模型概率形成于看到市场价之前，存在被市场锚定的嫌疑。

## 设计原则（专业定价团队纪律）

- **先有自己的数字，再看市场**：模型预测的生成时间必须可证明地早于市场数据接触时间。
- **自动化抓取，不自动化信任**：数据可以自动拉，但必须过质量门才能进入审计快照。
- **市场数据永远到不了模型上游**：基本面管道与市场管道物理隔离，只在最后的融合/分歧层相遇。

## 架构

```
基本面管道（喂模型，决不掺市场价）
  FIFA排名 / World Elo / 赛果(football-data.org) 
      ↓ 各源适配器（fetch 与 parse 分离）+ 质量门 + TTL 新鲜度清单
  审计快照 (dataVersion) ──▶ 纯模型预测 ──盲注承诺(哈希+时间戳落盘)──┐
                                                                    ├─▶ 分歧/价值/融合层
市场管道（只在最后一层相遇）                                        │
  Polymarket / 手填赔率 ──▶ 市场快照 ──▶ 去水 ──────────────────────┘
```

## 组件

### 1. 数据源适配器（`scripts/sources/`）

每个适配器导出三个分离的函数，网络只存在于 `fetchRaw`：

- `fetchRaw()` — 网络请求，返回原始响应文本/JSON；
- `parse(raw)` — 纯函数，原始数据 → 标准化记录（可用 fixture 离线测试）；
- `qualityGate(parsed)` — 纯函数，校验记录数下限、字段完整性、数值范围；不过门则抛错，调用方保留旧快照。

适配器清单：

| 适配器 | 源 | 输出 | 凭证 |
|---|---|---|---|
| `elo-ratings.mjs` | eloratings.net TSV（World.tsv） | 国家队 Elo 评分 | 无需 |
| `fifa-ranking.mjs` | FIFA 排名 JSON 端点 | FIFA 排名与积分 | 无需（非官方端点，质量门兜底） |
| `football-data.mjs` | football-data.org v4 | 世界杯赛程与已完成赛果 | 免费 API key（`FOOTBALL_DATA_API_KEY` 环境变量），无 key 则跳过并标注 |

### 2. 新鲜度清单与 TTL（`scripts/freshness.mjs` + `assets/freshness-manifest.json`）

清单记录每个源的 `lastFetchedAt`、`ttlHours`、`contentHash`：

```json
{
  "sources": {
    "elo-ratings": { "ttlHours": 24, "lastFetchedAt": "...", "contentHash": "..." },
    "fifa-ranking": { "ttlHours": 168, "lastFetchedAt": "...", "contentHash": "..." },
    "football-data": { "ttlHours": 1, "lastFetchedAt": "...", "contentHash": "..." }
  }
}
```

- `staleSources(manifest, now)` 纯函数返回过期源列表；
- 预测/扫描 CLI 启动时检查快照 `generatedAt` 与清单，过期输出 `snapshotStaleWarning`（不阻断，保留离线可用性）。

### 3. 刷新调度器（`scripts/refresh-snapshot.mjs`）

`node scripts/refresh-snapshot.mjs --base <snapshot> --out <snapshot> [--force] [--check]`

1. 读取基底快照与新鲜度清单；
2. `--check`：只报告各源新鲜度状态，不抓取；
3. 对过期源（或 `--force` 全部）调用适配器 `fetchRaw → parse → qualityGate`；
4. 任一源不过质量门：保留该源旧数据并在输出中标注 `degraded`，绝不混入半成品；
5. 通过的源合并进快照：更新 `teams[].ratingValue`（Elo 优先）、`fifaRank`、`matchStates`（新完成赛果，只增不改已锁定结果）；
6. 重算 `sourceVersions`（内容哈希）、`strengthSnapshotVersion`、`dataVersion`，更新清单 `lastFetchedAt`；
7. 输出仍须通过 `auditSnapshot` 才落盘。

队名→队伍 id 映射表维护在 `assets/team-aliases.json`（如 "Korea Republic" / "South Korea" → KOR）。

### 4. 盲注承诺（`scripts/blind-commit.mjs` + value-scan 集成）

- `node scripts/blind-commit.mjs --data <snapshot> [--matches id1,id2|--all]`：对指定对阵运行纯模型预测，写入 `logs/blind-commits.jsonl`，每行：`{ matchId, dataVersion, modelVersion, probs, sha256(probs+dataVersion), committedAt }`；
- `value-scan.mjs` 与 `predict-match.mjs --market`：融合前查找该 matchId + dataVersion 的承诺记录：
  - 找到且 `committedAt` 早于市场 `fetchedAt`：输出 `blindCommit: { verified: true, committedAt, hash }`；
  - 找不到：输出 `blindCommit: { verified: false, note }` 并照常计算（警示不阻断）；
  - `--require-blind-commit`：找不到则拒绝运行。
- 承诺日志只追加不修改；验证时重算哈希比对。

### 5. 模型独立性防火墙（`audit-input.mjs` 强化 + 测试）

- `auditSnapshot` 拒绝 `metadata.sourceVersions` 中含 `/polymarket|odds|market|betting/i` 的键，报错指明市场数据只能走市场快照通道；
- 测试断言该拒绝行为；
- 融合层输出永远同时含 `model90Prob`（纯模型）与 `blended90Prob`，已有行为加测试锁定。

## 非目标

- 不做赛后对账与 Brier/CLV 校准回路（留待 v0.5）；
- 不抓伤停/新闻类非结构化数据（仍走 `manual_review`）；
- 不引入第三方依赖（Node 20+ 原生 fetch）；
- 不改 core/ 概率公式（v0.4 是数据与流程层升级，模型版本不变，skill 版本升至 0.4.0）。

## 测试与验收

- 适配器 parse/qualityGate 用 fixture 离线测试（`tests/fixtures/`），不依赖网络；
- freshness 纯函数测试（过期判定、边界）；
- refresh 合并逻辑测试：评分更新、锁定赛果不被覆盖、不过门保留旧值、dataVersion 重算正确；
- 盲注测试：承诺→验证哈希、时间序校验、`--require-blind-commit` 拒绝路径；
- 防火墙测试：market 类源进 sourceVersions 被拒；
- 全部既有 33 测试不回归；`npm test` + `npm run smoke` 全绿。

## 关键决策记录

- 抓取自动化但落盘前必须过质量门 + auditSnapshot 双重校验，失败保留旧快照（决不混版本）；
- 盲注承诺用追加式 jsonl + 内容哈希实现可验证时间序，默认警示不阻断，`--require-blind-commit` 提供强制模式；
- football-data.org 需免费 key，无 key 优雅降级跳过，不影响其余源。
