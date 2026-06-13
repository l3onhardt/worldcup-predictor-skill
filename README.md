# World Cup Asian Handicap Trader Skill

**定位 / Positioning**: 世界杯亚洲盘口交易决策 Skill，面向 Codex、Claude Code 和兼容 Agent 环境。它把审计后的球队快照、盘口、赔率和模型概率转成明确的交易决策：`TRADE`、`SMALL TRADE`、`WAIT`、`PASS` 或 `HEDGE/REDUCE`。

[English](README.en.md) | [Quick Reference](docs/QUICK-REFERENCE.md)

## 核心目标

这个 skill 的目标是长期收益最大化，而不是写一份温吞的概率报告。它像盘口交易员一样工作：

- 先给交易结论，再解释原因。
- 比较模型公平价、市场去水价和融合概率。
- 读取盘口移动、水位变化、热门队税、冷门队挤压和跨市场不一致。
- 分析球队状态、动机、赛程、对位和已审计的伤停调整。
- 给入场价、触发价、仓位、Kelly 折扣、失效条件、退出/对冲条件。
- 如果边际不够，明确 `PASS`；如果方向对但价格差，明确 `WAIT`。

它不会声称稳赚、必中、保本、固定赛果、内部消息或无风险交易。这些说法不是专业交易，是错误定价的噪音。

## 30 秒开始

```bash
npx skills add https://github.com/l3onhardt/worldcup-predictor-skill --skill worldcup-predictor
```

手动安装：

```bash
git clone https://github.com/l3onhardt/worldcup-predictor-skill.git ~/.codex/skills/worldcup-predictor
```

安装后可以这样调用：

```text
使用 worldcup-predictor，以亚洲盘口交易员视角分析法国 vs 巴西，先给交易决策卡。
使用 worldcup-predictor，这场让半球怎么交易？给入场价、仓位和失效条件。
使用 worldcup-predictor，对比模型和 Polymarket，找最有 EV 的交易。
使用 worldcup-predictor，按盘口、水位、球队状态，判断现在是 TRADE 还是 WAIT。
使用 worldcup-predictor，分析 3/1/0：哪些做胆，哪些覆盖，哪些砍掉。
使用 worldcup-predictor，模拟冠军盘，按 EV、锁仓时间和对冲难度给交易计划。
```

## 标准输出

每个可交易分析必须先给：

```text
Decision: TRADE / SMALL TRADE / WAIT / PASS / HEDGE-REDUCE
Best market: Asian handicap / total / 1x2 / outright / 3-1-0
Side: <team/line/outcome>
Entry: acceptable at <line/odds>; improve position at <trigger>
Size: <fraction of bankroll or budget>, with Kelly basis and haircut reason
Confidence: high / medium / low
Invalidation: <lineup/news/line move/liquidity/data condition>
Exit/Hedge: <hold/add/reduce/hedge condition>
```

然后展开球队状态、盘口意图、概率链、EV/Kelly、执行策略和最坏路径。

## 核心能力

### 盘口交易

- 90 分钟胜平负概率、预期进球和比分分布。
- 亚盘、大小球、BTTS 公平价。
- 盘口移动和水位变化解释。
- 开盘/即时盘/市场快照对比。
- `TRADE / WAIT / PASS / HEDGE` 决策。

### 市场定价

- Polymarket 或手填赔率转市场快照。
- Power method 去水。
- 模型概率、去水市场概率、融合概率并列输出。
- EV 和 fractional Kelly。
- 价格触发、仓位折扣、相关敞口控制。

### 球队状态

- Elo/FIFA/评分版本和新鲜度。
- 已审计的 form、伤停、主场、赛程和动机调整。
- 小组赛动机、可接受平局、轮换、淘汰赛晋级激励。
- 对位风险：压迫、转换、防空、定位球、门将波动等有数据支持的因素。

### 锦标赛和 3/1/0

- 48 队世界杯模拟，小组出线、晋级路径、冠军概率。
- 已完成赛果锁定，不覆盖官方格式结果。
- 3/1/0 输出胆、覆盖、砍单、任九剔除和预算裁剪。

## 命令行示例

需要 Node.js 20 或更高版本，不需要安装依赖。

```bash
node scripts/predict-match.mjs --data assets/sample-data/worldcup-2026.json --home MEX --away KOR
node scripts/predict-markets.mjs --data assets/sample-data/worldcup-2026.json --home MEX --away KOR
node scripts/fetch-market.mjs --manual my-odds.json --out market.json
node scripts/value-scan.mjs --data assets/sample-data/worldcup-2026.json --market assets/sample-data/market-snapshot.json
node scripts/blind-commit.mjs --data assets/sample-data/worldcup-2026.json --all
node scripts/simulate-tournament.mjs --data assets/sample-data/synthetic-48-team.json --simulations 10000 --seed 2026
node scripts/generate-lottery-slip.mjs --issue assets/sample-data/lottery-issue.json --strategy balanced --budget 288
```

所有命令向标准输出写入 JSON，供 Agent 生成交易决策卡和执行计划。

## 技术口径

- `90minResult`: 90 分钟含伤停补时，用于胜平负、亚盘、大小球、BTTS、3/1/0、小组积分。
- `advanceResult`: 加时或点球后晋级，用于淘汰赛晋级、冠军路径和冠军盘。
- `officialFacts`、天气、新闻和名单默认只用于审计与解释。
- 只有 `manual_review` 或带版本号的 `deterministic_rule` 调整可以影响计算。
- 市场数据不能进入基本面 `sourceVersions`，市场快照和模型快照必须分离。
- LLM 只解释 CLI 输出，不手算概率、不编造实时信息。

## 开发与验证

```bash
npm test
npm run smoke
npm run update-core-manifest
```

## License

[MIT](LICENSE)
