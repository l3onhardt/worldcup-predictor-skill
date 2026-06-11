# Market Methodology

适用版本：prediction-core v0.3.0（`model-v0.3-market`）。

## 多盘口定价（core/markets.mjs）

所有盘口由同一个比分概率矩阵（Poisson + Dixon-Coles）推导，保证内部自洽：

- **亚盘**：整数/半球盘直接按净胜球判定胜/走/负；quarter 盘（±0.25/±0.75）按拆盘法
  一半注押相邻两条线，输出 fullWin/halfWin/push/halfLose/fullLose 五段概率。
- **公平赔率**：解 EV=1 的小数赔率
  `d = (1 − push − 0.5·halfWin − 0.5·halfLose) / (fullWin + 0.5·halfWin)`。
- **大小球**：0.5–5.5 全线位（含 quarter），同一拆盘逻辑。
- **BTTS**：比分矩阵中双方均进球的质量和。

所有盘口概率挂 `90minResult` 口径，不涉及加时与点球。

## 去水（de-vig）

- 默认 **power method**：求 k 使 Σqᵢᵏ = 1（二分 80 轮，确定性），比 proportional 更好地
  处理 favourite-longshot bias（对冷门去更多水）。
- 备选 proportional：pᵢ = qᵢ / Σq。
- 隐含概率之和 ≤ 1（无水/套利盘）时退化为 proportional 归一。

## 融合与分歧

- `blended = w·market + (1−w)·model`，默认 w = 0.7（市场为主、模型为辅，
  封盘前的市场共识通常强于单一模型）。w 可经 `--weight` 配置。
- 无市场数据时自动退回纯模型，输出 `fallback: "model_only"`。
- 分歧报告：每个结果输出 model − market 差值与方向，|Δ| ≥ 5pp（可配）标记 `flag: true`。

## EV 与 Kelly

- `EV = p·d − 1`（p 为融合概率，d 为市场小数价）。
- Kelly：`f* = (p·d − 1)/(d − 1)`，输出 1/4 Kelly，上限 10%。
- 仅为分析参考，不构成任何购彩、投资或收益建议。

## Polymarket 数据语义

- Polymarket 份额价格（0–1）≈ 该结果的市场隐含概率，YES 价即概率，小数赔率 = 1/价格。
- Gamma API（gamma-api.polymarket.com）免费无需 key；本 skill 只通过
  `scripts/fetch-market.mjs` 拉取并落盘为带 `fetchedAt` 的快照，核心计算不联网。
- 市场快照相对赛事快照超过 `--max-age-hours`（默认 24h）输出 `staleWarning`。

## 模型修缮（v0.3）

- Dixon-Coles ρ 由 4 档阶梯改为 λ 的连续线性函数 `clamp(0.0833·λ̄ − 0.1967, −0.15, −0.02)`。
- 淘汰赛平局晋级拆为两段：加时段 `0.5 + Δ·0.18 ± host 0.03`（clamp 0.3–0.7），
  点球段 `0.5 + Δ·0.06`（clamp 0.4–0.6），按 45%/55% 加权，整体 clamp 0.25–0.75。
