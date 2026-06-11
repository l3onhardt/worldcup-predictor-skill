# Data Pipeline（v0.4 双管道架构）

## 原则

- **先有自己的数字，再看市场**：模型预测可证明地形成于接触市场数据之前（盲注承诺）。
- **自动化抓取，不自动化信任**：数据自动拉取，但必须过质量门 + auditSnapshot 双重校验才进入快照。
- **市场数据永远到不了模型上游**：防火墙在 auditSnapshot 层强制（含 market/odds/polymarket/betting 字样的源直接拒绝）。

## 基本面管道

| 源 | 适配器 | TTL | 凭证 |
|---|---|---|---|
| World Football Elo (eloratings.net) | `scripts/sources/elo-ratings.mjs` | 24h | 无需 |
| FIFA 男足排名 | `scripts/sources/fifa-ranking.mjs` | 168h | 无需（端点不稳定，质量门兜底） |
| football-data.org 赛程赛果 | `scripts/sources/football-data.mjs` | 1h | 免费 key（`FOOTBALL_DATA_API_KEY`） |

每个适配器三段分离：`fetchRaw`（唯一联网点）→ `parse`（纯函数）→ `qualityGate`（纯函数，记录数/数值范围/重复检查）。

## 刷新调度

```bash
node scripts/refresh-snapshot.mjs --base <snapshot> --out <snapshot> [--force] [--check]
```

- 按 `assets/freshness-manifest.json` 的 TTL 决定哪些源过期需要抓；`--check` 只报告不抓取。
- 不过质量门的源：保留旧数据，报告标注 `degraded_kept_previous`，绝不混半成品。
- 评分突变超过 400 分被视为别名映射错误（`suspicious`），保留旧值上报。
- 已锁定的完成赛果（status=final）外部源不得覆盖。
- 合并后重算 `sourceVersions`/`strengthSnapshotVersion`/`dataVersion`，再过一次 auditSnapshot 才落盘。
- 队名/代码映射维护在 `assets/team-aliases.json`。

## 盲注承诺（Blind Commit）

```bash
node scripts/blind-commit.mjs --data <snapshot> --all          # 接触市场价前先承诺
node scripts/value-scan.mjs --market <m.json> [--require-blind-commit]
```

- 纯模型概率 + dataVersion 的 sha256 追加写入 `logs/blind-commits.jsonl`（只追加不改写）。
- value-scan 验证：哈希匹配 + `committedAt < market.fetchedAt` 时间序，输出 `blindCommit.verified`。
- `--require-blind-commit` 强制模式：无承诺拒绝运行。
- 正确工作流：刷新快照 → 盲注承诺 → 拉市场数据 → 价值扫描。

## 模型独立性保证

1. 防火墙：市场源进不了 `sourceVersions`（测试锁定）。
2. 融合输出永远同时保留 `model90Prob`（纯模型）与 `blended90Prob`（测试锁定）。
3. `--weight 0` 可完全关闭市场影响，纯独立模式。
4. 盲注承诺让"模型没看市场"从口头声明变成可验证事实。
