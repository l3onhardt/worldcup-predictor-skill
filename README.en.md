# World Cup Prediction Market Research Assistant: Probability Analysis & Risk Management Skill

[中文说明](README.md) | [Quick Reference](docs/QUICK-REFERENCE.md) | [Optimization Notes](docs/SKILL-OPTIMIZATION-SUMMARY.md)

## ⚠️ Important Notice

**What this is**: an educational probability-analysis tool, a risk-management research framework, and a prediction-market methodology demo.

**What this is NOT**: investment advice, betting instructions, a guaranteed-return algorithm, or a gambling agent.

All outputs are educational examples and research references. Users must make their own decisions, bear their own risk, and comply with local laws and regulations.

## Positioning

World Cup Prediction Market Research Assistant is an Agent Skill for Codex, Claude Code, and compatible environments. It uses audited offline snapshots and a bundled deterministic core to produce structured research reports: implied-probability calculations, model-vs-market value divergence, risk-factor breakdowns, scenario analysis, and educational capital-allocation examples (conservative / neutral / aggressive).

**In one sentence**: give an agent audited match data (and optionally market odds), and it returns a transparent research report — probabilities, expected value, risk exposure, worst cases, and uncertainty — never a betting instruction.

**Best for**: learning probability analysis and risk-management methodology, understanding how prediction markets price outcomes, systematically evaluating uncertainty, or adding structured win/draw/loss research to Codex / Claude Code.

**Not for**: anyone looking for "sure wins" (they do not exist), anyone who wants the AI to decide for them (the decision is yours), anyone using borrowed money or money they cannot afford to lose, or anyone in a jurisdiction where such activities are restricted.

**Core principles**:
- 🔬 **Probability first**: everything rests on probability theory and statistics, not intuition
- 🛡️ **Risk first**: conservative defaults, hard exposure caps, mandatory warnings
- 📖 **Education first**: every output is a teaching example, not an action instruction
- 🔍 **Transparency first**: all formulas, assumptions, and limitations are disclosed
- 👤 **Autonomy first**: the user's independent judgment is respected; the skill never decides

**Chinese display name**: 世界杯预测市场研究助手 (formerly 世界杯预测机). The internal skill name remains `worldcup-predictor`.

The 2026 World Cup uses the expanded 48-team, 12-group, 104-match format. This repository only works with audited offline data and does not depend on Next.js, databases, live scraping, or LLM-generated probabilities. LLMs may explain outputs and present the research framework, but they must not replace deterministic rules or calculations — and they must never promise returns.

## Start In 30 Seconds

With an Agent Skills-compatible installer:

```bash
npx skills add https://github.com/qqyule/worldcup-predictor-skill --skill worldcup-predictor
```

Or install it manually:

```bash
git clone https://github.com/qqyule/worldcup-predictor-skill.git ~/.codex/skills/worldcup-predictor
```

Claude Code users can clone the repository into `~/.claude/skills/worldcup-predictor`.

Natural example requests after installation:

```text
# Basic probability analysis
Use worldcup-predictor to analyze France vs Brazil probabilities.
Use worldcup-predictor to analyze this match's 90-minute win/draw/loss chances.
Use worldcup-predictor to show the most likely scorelines.
Use worldcup-predictor to explain why the model favors this team.

# Market value research
Use worldcup-predictor to compare the model's probabilities with Polymarket.
Use worldcup-predictor to scan these odds for divergence against the model.
Use worldcup-predictor to compute implied probabilities and devigged fair probabilities.
Use worldcup-predictor: what is the fair probability for the -0.5 Asian handicap?

# Risk assessment and scenario analysis
Use worldcup-predictor for a full risk-analysis research report.
Use worldcup-predictor: compare conservative/neutral/aggressive allocation examples for a 2000-unit budget.
Use worldcup-predictor: what are the main risk factors in this match?
Use worldcup-predictor: what is the worst-case loss in each scenario?

# Tournament simulation
Use worldcup-predictor to simulate 2026 World Cup champion probabilities.
Use worldcup-predictor: which teams are most likely to reach the quarter-finals?
Use worldcup-predictor to continue the knockout bracket from current results.

# Lottery reference analysis (educational)
Use worldcup-predictor with my 14-match JSON to analyze the 3/1/0 probability distribution.
Use worldcup-predictor to make a conservative reference analysis — not betting advice.
Use worldcup-predictor to rank these matches by risk level.
```

**Note**: the agent will first state that this is a research tool (not investment advice), then confirm data sources, budget range, and risk preference before producing a structured report.

## Capabilities

### Probability Analysis
- Audit structured offline inputs and reject incomplete or mixed-version data.
- Calculate 90-minute win, draw, and loss probabilities, expected goals, and likely scorelines.
- Keep `90minResult` and `advanceResult` strictly separate.
- Price Asian handicaps (with quarter-line splits), all over/under lines, and BTTS from the same score matrix.

### Market Research
- Build market snapshots from Polymarket or manual bookmaker odds.
- Devig with the power method to remove bookmaker margin and recover fair implied probabilities.
- Blend model and market probabilities (market weight 0.7 by default), always reporting both columns.
- Report model-vs-market divergence with |Δ| ≥ 5pp flags.
- Compute EV and fractional Kelly as **analysis references only — never betting advice**.

### Risk Management
- 8-section structured research report: data summary, implied probabilities, subjective assessment, value divergence, risk factors, scenario analysis, allocation examples, and research conclusions.
- Conservative / neutral / aggressive scenario comparison with best case, worst case, and drawdown.
- Hard exposure caps: single position ≤ 10%, total exposure ≤ 30% (stricter defaults available).
- Mandatory warnings on over-limit requests, loss-chasing, borrowed funds, and stale data.

### Data Independence
- Blind commits: hash model probabilities to disk before touching market prices, with verifiable time order proving independence.
- Audit firewall: market-like sources (polymarket/odds/betting) are rejected from fundamental snapshots.
- Market snapshots never modify `dataVersion`; blended and pure-model probabilities are always reported together.
- Refresh fundamental snapshots on TTL (World Elo / FIFA ranking / football-data results) with quality gates that keep previous values on failure.

### Tournament Simulation
- Continue a 2026 World Cup simulation from completed results without overwriting them.
- Report qualification, knockout-path, and World Cup champion probabilities.
- Deterministic seeded Monte Carlo (default 10000 runs), fully reproducible.

### Educational Reference
- Analyze China football lottery 3/1/0 probability distributions from `90minResult`, clearly labelled as educational reference, never purchasing advice.
- Ignore unreviewed LLM-extracted context adjustments.

## Not For

### Technical boundaries
- Live scores, news, odds, or official-data scraping.
- Asking an LLM to invent missing facts or calculate probabilities.
- Treating knockout advancement probability as 90-minute win probability.
- Shipping unauthorized FIFA marks, team crests, or commercial data assets.

### Positioning boundaries
- Investment advice, purchasing advice, or return promises of any kind.
- Deciding for the user, or claiming "sure win" / "guaranteed profit".
- Encouraging over-budget stakes, borrowed funds, loss-chasing, or all-in behaviour.
- Claiming official endorsement, insider information, or exclusive algorithms.
- Hiding model limitations, missing data, or uncertainty.

### Compliance boundaries
- Real purchasing, proxy buying, payments, or rebates.
- Circumventing local laws or encouraging illegal activity.
- Serving minors with prediction-market content.
- Continuing analysis when problem-gambling signals appear (the skill suggests professional help instead).

## CLI Examples

Node.js 20 or newer is required. No dependency installation is needed.

```bash
# Single-match prediction
node scripts/predict-match.mjs \
  --data assets/sample-data/worldcup-2026.json \
  --home MEX \
  --away KOR

# Tournament simulation
node scripts/simulate-tournament.mjs \
  --data assets/sample-data/synthetic-48-team.json \
  --simulations 10000 \
  --seed 2026

# 3/1/0 entertainment reference list
node scripts/generate-lottery-slip.mjs \
  --issue assets/sample-data/lottery-issue.json \
  --strategy balanced \
  --budget 288

# Full market book (Asian handicap / over-under / BTTS)
node scripts/predict-markets.mjs \
  --data assets/sample-data/worldcup-2026.json \
  --home MEX --away KOR

# Market snapshot (manual odds or Polymarket)
node scripts/fetch-market.mjs --manual my-odds.json --out market.json

# Value scan: devig, blend, divergence, EV/Kelly
node scripts/value-scan.mjs \
  --data assets/sample-data/worldcup-2026.json \
  --market assets/sample-data/market-snapshot.json

# Refresh fundamental snapshot (Elo/FIFA/results, TTL-driven)
node scripts/refresh-snapshot.mjs \
  --base assets/sample-data/worldcup-2026.json \
  --out fresh-snapshot.json

# Blind commit (lock model probabilities before touching market prices)
node scripts/blind-commit.mjs --data fresh-snapshot.json --all
```

Every command writes JSON to standard output for further processing by agents, scripts, or applications.

## Input And Model Boundaries

The CLI only accepts audited offline JSON snapshots. Inputs must contain consistent data versions, one complete team-strength version, and verifiable completed results.

Important scopes:

- `90minResult`: the result after 90 minutes including stoppage time; used for match probabilities, group points, and 3/1/0 lists.
- `advanceResult`: the team that advances after extra time or penalties; used only for knockout paths and champion probabilities.
- `officialFacts`, weather, news, and squads are audit and explanation context by default.
- Only `manual_review` or versioned `deterministic_rule` adjustments may affect calculations.

Detailed references:

- [`references/data-schema.md`](references/data-schema.md)
- [`references/official-data-sources.md`](references/official-data-sources.md)
- [`references/model-methodology.md`](references/model-methodology.md)
- [`references/market-methodology.md`](references/market-methodology.md)
- [`references/data-pipeline.md`](references/data-pipeline.md)
- [`references/tournament-rules.md`](references/tournament-rules.md)
- [`references/lottery-rules.md`](references/lottery-rules.md)

## Repository Structure

```text
.
├── SKILL.md                 # Agent workflow entry point
├── agents/openai.yaml       # Codex UI metadata
├── core/                    # Deterministic prediction-core ESM snapshot
├── scripts/                 # Audit, prediction, simulation, and list CLIs
├── references/              # Data, model, tournament, and compliance rules
├── assets/official-sources.json # Lightweight source index, not official data
├── assets/sample-data/      # Synthetic smoke-test data, not official feeds
├── tests/                   # Standalone tests
├── README.md                # Chinese documentation
├── README.en.md             # English documentation
└── LICENSE                  # MIT
```

## Development And Verification

```bash
npm test
npm run smoke
```

- `npm test` verifies input auditing, result scopes, completed-result locking, bundled-core hashes, market math, and standalone CLIs.
- `npm run smoke` executes all bundled CLIs with sample data.
- `core/` is the source of truth for prediction-core and is iterated in this repository; run `npm run update-core-manifest` after changing it.

Bundled samples exist only for demonstrations and tests. They are not official schedules, real team-strength data, or actual prediction conclusions. `assets/official-sources.json` contains only source metadata; it does not include official scrape results, CSV files, images, PDFs, or live feeds.

## Open Source And Contributions

Issues and pull requests are welcome, especially for:

- Reproducible tournament-rule or input-audit problems;
- Cross-agent installation and compatibility improvements;
- Documentation and test improvements that preserve probability scopes.

Changes to probability formulas, tournament rules, or 3/1/0 scopes must include deterministic tests and explain their impact on `90minResult` and `advanceResult`.

## Disclaimer

This tool only provides public-data analysis, mathematical simulations, risk-management education, and reference organization. All allocation figures are educational examples demonstrating probability-based decision frameworks. It is not purchasing, investment, or return advice; prediction markets and sports outcomes are highly uncertain, and historical data cannot guarantee future results. Follow applicable laws and regulations. Minors must not participate in China sports lottery activities. If gambling stops being entertainment, seek professional help.

## License

[MIT](LICENSE)
