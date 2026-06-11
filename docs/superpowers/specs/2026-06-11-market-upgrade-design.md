# 世界杯预测机 v0.3 设计：多盘口定价 + 市场融合升级

日期：2026-06-11
状态：已获用户批准

## 目标

以专业盘口交易员/预测市场视角升级 `worldcup-predictor` skill，使其能够：

1. 从现有比分概率矩阵推导亚盘（让球盘）、大小球、BTTS 等多盘口定价；
2. 拉取 Polymarket 等公开市场数据，去水后与自建模型概率加权融合；
3. 识别模型与市场的分歧，输出 EV 与分数 Kelly 参考（仅分析，非购彩建议）；
4. 修缮现有模型的已知粗糙点（Dixon-Coles ρ 阶梯、点球晋级概率）。

## 非目标

- 不做实时滚盘/滚球预测；
- 不提供购彩、投资建议或收益承诺（沿用现有免责声明）；
- 不引入数据库、常驻服务或第三方依赖（保持 Node 20+ 零依赖）；
- 不做历史回测框架（方案 C 内容，留待后续）。

## 架构总览

保持「审计快照 → 确定性核心 → CLI 输出 JSON」骨架，新增一条市场数据通路：

```
Polymarket / 博彩赔率 ──fetch-market.mjs──▶ 市场快照(带时间戳) ──┐
                                                                ├─▶ 核心 v0.3 ─▶ 融合概率 + 多盘口定价 + 价值识别
审计赛事快照(现有) ─────────────────────────────────────────────┘
```

网络请求只发生在 `scripts/fetch-market.mjs` 一个脚本中，结果落盘为带时间戳的快照文件；核心计算保持 100% 离线确定性、可审计、可复现。

## core 升级（v0.2.0 → v0.3.0，模型版本 `model-v0.3-market`）

本仓库即为 core 的事实源头，直接迭代，不再依赖上游同步。

### 新增 `core/markets.mjs` — 多盘口定价引擎

从现有比分概率矩阵（Poisson + Dixon-Coles）推导，全部为纯函数：

- **亚盘**：整数盘、半球盘、quarter 盘（0.25/0.75 用拆盘法：一半注押相邻两条线），输出上盘/下盘/走盘概率与公平赔率；
- **大小球**：0.5–5.5 全部线位的 Over/Under 概率与公平赔率；
- **BTTS**（双方进球是/否）；
- **净胜球分布**（附带输出）。

所有盘口由同一比分矩阵推导，保证内部自洽。

### 新增 `core/odds.mjs` — 赔率处理与价值识别

- 赔率↔概率互转（小数 / 美式 / 港盘）；
- **去水（de-vig）**：默认 power method，proportional 备选；
- **加权融合**：`blended = w·market + (1-w)·model`，默认市场 0.70 / 模型 0.30，权重可配置；无市场数据自动退回纯模型，输出标注 `fallback: model_only`；
- **分歧报告**：每个结果输出模型 vs 市场概率差与方向，超过阈值（默认 5 个百分点）标记 `divergence_flag`；
- **EV 与分数 Kelly**：对每个可下注结果计算期望值与 1/4 Kelly 参考仓位，仅作分析输出，沿用免责声明。

### 修缮 `core/match.mjs`（保持确定性）

- Dixon-Coles ρ 由 4 档阶梯改为关于 λ 的连续函数（消除档位边界跳变）；
- 淘汰赛平局后晋级概率拆为加时段 + 点球段两段建模：点球段比加时段更接近五五开，降低当前 0.22 评分系数对强队的偏高估计；
- expectedGoals 的 clamp 区间与系数保持不变。

## 脚本层

| 脚本 | 状态 | 作用 |
|---|---|---|
| `scripts/fetch-market.mjs` | 新增 | 拉取 Polymarket Gamma API（免费无 key）的世界杯相关市场（冠军、单场等）；支持 `--manual <file>` 导入手填博彩赔率；输出带 `fetchedAt`、来源、原始价格的市场快照 JSON |
| `scripts/predict-markets.mjs` | 新增 | 输入赛事快照 + 对阵，输出该场全部盘口定价：1X2、各亚盘线、各大小球线、BTTS、高概率比分 |
| `scripts/value-scan.mjs` | 新增 | 输入赛事快照 + 市场快照，对每场输出去水市场概率、融合概率、分歧报告、EV、Kelly 参考，按价值排序 |
| `scripts/predict-match.mjs` | 修改 | 新增可选 `--market <snapshot>`；提供时输出融合概率与分歧，不提供时行为完全不变 |
| `scripts/generate-lottery-slip.mjs` | 修改 | 期次文件带市场概率时，3/1/0 选择基于融合概率，输出注明数据来源 |

## 数据格式

市场快照 schema（写入 `references/data-schema.md`）：

```json
{
  "source": "polymarket | manual",
  "fetchedAt": "ISO-8601",
  "markets": [
    {
      "matchId": "或 marketId（outright）",
      "type": "1x2 | ah | ou | outright",
      "line": 2.5,
      "outcomes": [{ "name": "...", "price": 1.95, "impliedProb": 0.513 }]
    }
  ]
}
```

## 文档

- 新增 `references/market-methodology.md`：去水方法、融合权重依据、亚盘拆盘规则、Kelly 口径、Polymarket 数据语义（份额价格≈概率）；
- 更新 `SKILL.md`：市场快照为可选输入；快照过期超过配置时限须警告；
- 更新 `README.md` / `README.en.md` 能力描述与示例。

## 测试与合规

- 每个新模块配确定性单测：各盘口概率求和=1、quarter 盘拆盘正确性、去水后概率归一、融合权重边界（w=0/1）、无市场数据回退、Kelly 上限、赔率格式互转往返一致；
- `npm test` 与 `npm run smoke` 全绿为完成标准；
- EV/Kelly 输出沿用现有免责声明，不出现购彩建议措辞；
- `90minResult` 与 `advanceResult` 分离规则对新盘口同样生效：亚盘/大小球/BTTS 全部挂在 `90minResult` 口径下。

## 关键决策记录

- 市场数据通路采用「拉取→快照→计算」而非实时直算，保持可审计可复现；
- 市场概率与模型概率加权融合（默认 70/30）并输出分歧报告，而非仅对照或市场优先；
- core/ 直接在本仓库迭代到 v0.3（用户为仓库作者，本仓库即事实源头）。
