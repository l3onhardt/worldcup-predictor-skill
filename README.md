# 世界杯预测市场研究助手：概率分析与风险管理 Skill

**定位 / Positioning**: 严谨的预测市场研究工具，专注于概率分析、风险评估和教育性决策框架

[English](README.en.md) | [快速参考](docs/QUICK-REFERENCE.md) | [优化说明](docs/SKILL-OPTIMIZATION-SUMMARY.md)

## ⚠️ 重要声明 / Important Notice

**这是什么 / What This Is**:
- ✅ 教育性概率分析工具
- ✅ 风险管理研究框架
- ✅ 预测市场方法论演示

**这不是什么 / What This Is NOT**:
- ❌ 投资建议或下注指令
- ❌ 保证收益的算法
- ❌ 购彩代理或赌博顾问

所有输出都是教育性示例和研究参考，不构成任何投资建议。用户必须自行判断、自担风险、遵守当地法律法规。

## 在线预测网站

基于本 Skill 开发的世界杯预测网站已上线：[https://world-cup.justidea.cn/](https://world-cup.justidea.cn/)。

网站内容会随比赛进程实时更新，可直接查看冠军概率、单场预测、小组出线、淘汰赛路径等**研究性分析结果**。

![世界杯预测台线上网站截图](assets/screenshots/world-cup-predictor-console.png)

## 项目定位

世界杯预测市场研究助手是一个面向 Codex、Claude Code 等 Agent 环境的预测市场研究 Skill。它使用离线审计快照和内置确定性核心，提供 2026 世界杯概率分析、风险评估、市场价值研究，以及教育性资金管理框架演示。

**一句话**：提供基于概率论的足球比赛分析框架，帮助理解预测市场、隐含概率、期望值和风险管理的基本原理。

**适合**：
- 想学习概率分析和风险管理方法的研究者
- 需要理解预测市场运作机制的学习者
- 希望系统化评估不确定性的决策者
- 对体育数据分析和概率建模感兴趣的开发者

**不适合**：
- 寻找"稳赚""必赢"策略的人（不存在这种东西）
- 希望 AI 替自己做决策的人（决策责任在你）
- 无法承受损失或使用借贷资金的人（极度危险）
- 所在地法律禁止相关活动的人（请遵守法律）

**核心原则**：
- 🔬 **概率优先**: 一切基于概率论和统计学，不靠直觉或迷信
- 🛡️ **风险优先**: 默认保守，强制风险上限，强调不确定性
- 📖 **教育优先**: 所有输出都是教学示例，不是行动指令
- 🔍 **透明优先**: 公开所有计算公式、假设和局限
- 👤 **自主优先**: 尊重用户独立判断，不替用户决策

**注意**：安装和内部调用名仍是 `worldcup-predictor`，中文显示名现为「世界杯预测市场研究助手」或简称「预测市场研究助手」。

2026 世界杯采用 48 队、12 个小组、104 场比赛的新赛制。本项目只处理经过审计的离线数据，不依赖 Next.js、数据库、在线抓取或大模型计算概率。LLM 只能解释结果和展示教育性框架，不能替代规则与概率计算，更不能保证任何收益。

## v0.5 重大更新：研究助手定位

**2026-06-12 更新**：本 skill 已从"预测工具"重新定位为"预测市场研究助手"。

### 核心变化
- **新身份**: 概率分析师 + 风险管理顾问，而非下注代理
- **新输出**: 8 章节结构化研究报告，包含风险分析、情景建模、教育性资金管理框架
- **新规则**: 严格的行为准则、禁用语言列表、强制风险上限、纠正性反馈机制
- **新工作流**: 5 阶段流程，强调 blind-commit 模型独立性和用户确认

### 为什么改变
原定位可能让用户误以为这是"保证收益"的工具。实际上：
- 预测市场和体育赛事高度不确定
- 模型只是概率估计，不是未来保证
- 即使正 EV 的决策也会频繁亏损（方差）
- 用户需要完整的风险信息才能负责任地决策

新定位明确了这是**教育和研究工具**，所有输出都是"示例"和"参考"，最终决策和风险由用户自己承担。

详细说明见 [优化总结文档](docs/SKILL-OPTIMIZATION-SUMMARY.md)。

## 30 秒开始

使用支持 Agent Skills 的安装工具：

```bash
npx skills add https://github.com/qqyule/worldcup-predictor-skill --skill worldcup-predictor
```

也可以手动安装：

```bash
git clone https://github.com/qqyule/worldcup-predictor-skill.git ~/.codex/skills/worldcup-predictor
```

Claude Code 用户可以将仓库克隆到 `~/.claude/skills/worldcup-predictor`。

安装后可以直接用更自然的话对 Agent 说：

```text
# 基础概率分析
使用世界杯预测市场研究助手，分析法国对巴西的概率。
使用世界杯预测市场研究助手，这场球 90 分钟胜平负概率如何？
使用世界杯预测市场研究助手，给我几个最可能的比分。
使用世界杯预测市场研究助手，解释一下为什么模型看好这支队。

# 市场价值研究
使用世界杯预测市场研究助手，对比模型和 Polymarket 的概率。
使用世界杯预测市场研究助手，这份赔率里有没有偏离模型的价值点？
使用世界杯预测市场研究助手，帮我分析市场隐含概率和去水后的公平概率。
使用世界杯预测市场研究助手，亚盘让半球的公平概率是多少？

# 风险评估与情景分析
使用世界杯预测市场研究助手，给我完整的风险分析报告。
使用世界杯预测市场研究助手，2000 元预算的保守/中性/激进方案对比。
使用世界杯预测市场研究助手，这场比赛的主要风险因素是什么？
使用世界杯预测市场研究助手，最坏情况下可能损失多少？

# 锦标赛模拟
使用世界杯预测市场研究助手，模拟一下 2026 世界杯冠军概率。
使用世界杯预测市场研究助手，哪些队最可能进八强？
使用世界杯预测市场研究助手，这个小组谁更可能出线？
使用世界杯预测市场研究助手，按现在赛果继续推演淘汰赛。

# 彩票参考分析（教育性）
使用世界杯预测市场研究助手，我有 14 场 JSON，分析一下 3/1/0 概率分布。
使用世界杯预测市场研究助手，给我一份偏稳的参考分析（注意不是购彩建议）。
使用世界杯预测市场研究助手，把这期比赛按风险高低分类。
```

**重要提示**：Agent 会先说明这是研究工具（非投资建议），然后询问确认数据来源、预算范围、风险偏好等信息，最后提供结构化分析报告。

## 核心能力 / Core Capabilities

### 概率分析 / Probability Analysis
- 审计结构化离线输入，拒绝不完整或混合版本数据
- 输出单场 90 分钟胜、平、负概率、预期进球和高概率比分
- 区分 `90minResult`（常规时间）与 `advanceResult`（含加时点球）
- 从同一比分矩阵推导亚盘、大小球、BTTS 公平定价

### 市场研究 / Market Research
- 拉取 Polymarket 或手填博彩赔率生成市场快照
- Power method 去水，移除庄家利润，计算公平隐含概率
- 模型概率与市场概率加权融合（默认市场 0.7、模型 0.3）
- 输出价值差异报告：标记 |Δ| ≥ 5pp 的显著分歧
- 计算 EV 和 fractional Kelly（**仅作分析参考，非购彩建议**）

### 风险管理 / Risk Management
- 8 章节结构化研究报告（数据摘要、隐含概率、主观判断、价值差异、风险因素、情景分析、资金分配示例、结论建议）
- 保守/中性/激进三种风险情景对比
- 最佳/最坏情况建模，展示回撤和破产风险
- 强制风险上限：单笔 ≤ 10%、总敞口 ≤ 30%（可配置更保守）
- 自动警告触发：超限、追损、借贷、数据过期

### 数据独立性 / Data Independence
- **Blind Commit**: 模型概率在接触市场价前哈希落盘，时间序可验证
- **审计防火墙**: 市场类数据源（polymarket/odds/betting）禁止进入基本面快照
- **版本隔离**: 市场快照不修改 `dataVersion`，模型与市场概率始终并列报告
- **TTL 刷新**: 按 TTL 自动刷新基本面快照（World Elo / FIFA / football-data），质量门不通过则保留旧值

### 锦标赛模拟 / Tournament Simulation
- 从已完成赛果继续模拟 2026 世界杯，不覆盖已确认结果
- 输出小组出线、淘汰赛路径与冠军概率
- Monte Carlo 模拟（默认 10000 轮），可重现的确定性随机数
- 适合赛程推演和"如果 X 队赢了会怎样"的情景探索

### 教育性参考 / Educational Reference
- 基于 `90minResult` 生成中国足球彩票 3/1/0 概率分布分析
- 明确标注为"娱乐参考"或"教育示例"，不是购彩建议
- 按风险高低分类，展示概率分布和不确定性
- 过滤未经人工审核的 LLM 临场调整

## 明确不做的事 / What This Does NOT Do

### 技术边界 / Technical Boundaries
- ❌ 不内置官方数据包、不自动抓取实时比分、新闻、赔率或官方数据
- ❌ 不使用 LLM 编造缺失数据或直接计算概率（LLM 只做解释和展示）
- ❌ 不将淘汰赛晋级概率当作 90 分钟胜率（严格区分 90min vs advance）
- ❌ 不提供实时推送、自动交易、API 集成或生产级服务

### 定位边界 / Positioning Boundaries
- ❌ 不提供投资建议、购彩建议或保证收益
- ❌ 不替用户做决策或承诺"稳赚""必赢"
- ❌ 不鼓励超预算、借贷、追损等高风险行为
- ❌ 不声称官方背书、内部消息或独家算法
- ❌ 不掩盖模型局限、数据缺失或不确定性

### 合规边界 / Compliance Boundaries
- ❌ 不提供代购、支付、返利或任何金融服务
- ❌ 不绕过当地法律法规或鼓励违法行为
- ❌ 不对未成年人提供预测市场相关内容
- ❌ 不处理可能导致问题赌博的请求（会建议寻求专业帮助）

所有输出都明确标注为"教育性研究工具"，用户需自行判断、自担风险、遵守法律。
- 使用未授权 FIFA 标识、球队队徽或商业数据资产。

## 命令行示例

需要 Node.js 20 或更高版本，不需要安装依赖。

```bash
# 单场预测
node scripts/predict-match.mjs \
  --data assets/sample-data/worldcup-2026.json \
  --home MEX \
  --away KOR

# 赛事模拟
node scripts/simulate-tournament.mjs \
  --data assets/sample-data/synthetic-48-team.json \
  --simulations 10000 \
  --seed 2026

# 3/1/0 娱乐参考清单
node scripts/generate-lottery-slip.mjs \
  --issue assets/sample-data/lottery-issue.json \
  --strategy balanced \
  --budget 288

# 全盘口定价（亚盘/大小球/BTTS）
node scripts/predict-markets.mjs \
  --data assets/sample-data/worldcup-2026.json \
  --home MEX --away KOR

# 市场快照（手填赔率或 Polymarket）
node scripts/fetch-market.mjs --manual my-odds.json --out market.json

# 价值扫描：去水、融合、分歧、EV/Kelly
node scripts/value-scan.mjs \
  --data assets/sample-data/worldcup-2026.json \
  --market assets/sample-data/market-snapshot.json

# 刷新基本面快照（Elo/FIFA/赛果，按 TTL 自动判断）
node scripts/refresh-snapshot.mjs \
  --base assets/sample-data/worldcup-2026.json \
  --out fresh-snapshot.json

# 盲注承诺（接触市场价之前先锁定模型概率）
node scripts/blind-commit.mjs --data fresh-snapshot.json --all
```

所有命令向标准输出写入 JSON，适合 Agent、脚本或其他应用继续处理。

## 输入与模型边界

CLI 只接受经过审计的离线 JSON 快照。输入必须包含一致的数据版本、完整的球队强度版本和可验证的已完成赛果。

重要口径：

- `90minResult`：90 分钟含伤停补时结果，只用于胜平负预测、小组积分和 3/1/0 清单。
- `advanceResult`：加时或点球后晋级结果，只用于淘汰赛路径与冠军概率。
- `officialFacts`、天气、新闻和名单默认只用于审计与解释。
- 只有 `manual_review` 或带版本号的 `deterministic_rule` 调整可以影响计算。

详细格式与方法见：

- [`references/data-schema.md`](references/data-schema.md)
- [`references/official-data-sources.md`](references/official-data-sources.md)
- [`references/model-methodology.md`](references/model-methodology.md)
- [`references/market-methodology.md`](references/market-methodology.md)
- [`references/data-pipeline.md`](references/data-pipeline.md)
- [`references/tournament-rules.md`](references/tournament-rules.md)
- [`references/lottery-rules.md`](references/lottery-rules.md)

## 仓库结构

```text
.
├── SKILL.md                 # Agent 工作流入口
├── agents/openai.yaml       # Codex UI 元数据
├── core/                    # prediction-core 的确定性 ESM 快照
├── scripts/                 # 审计、预测、模拟与清单 CLI
├── references/              # 数据、模型、赛制与合规规则
├── assets/official-sources.json # 轻量官方来源索引，不含官方数据
├── assets/sample-data/      # 合成烟测数据，不是官方数据源
├── tests/                   # 独立运行测试
├── README.md                # 中文说明
├── README.en.md             # English documentation
└── LICENSE                  # MIT
```

## 开发与验证

```bash
npm test
npm run smoke
```

- `npm test` 验证输入审计、结果口径、已完成赛果锁定、核心清单哈希和独立 CLI。
- `npm run smoke` 使用内置样例运行三个 CLI。
- `core/` 即 prediction-core 的事实源头，在本仓库直接迭代；修改后运行 `npm run update-core-manifest` 刷新清单。

本仓库的样例数据仅用于功能演示和测试，不代表官方赛程、真实球队实力或实际预测结论。`assets/official-sources.json` 只记录来源元数据，不包含官方抓取结果、CSV、图片、PDF 或实时 feed。

## 开源与贡献

欢迎提交 Issue 或 Pull Request，尤其是：

- 可复现的赛制或输入校验问题；
- 跨 Agent 安装与使用兼容性；
- 不改变概率口径的文档与测试改进。

涉及概率公式、赛制规则或 3/1/0 口径的修改，必须附带确定性测试，并说明对 `90minResult` 与 `advanceResult` 的影响。

## 免责声明

本工具仅提供基于公开数据和数学模型的赛事分析、模拟结果和清单整理，不构成任何购彩、投资或收益建议。请遵守当地法律法规，理性参与中国体育彩票，未成年人禁止参与。

## License

[MIT](LICENSE)
