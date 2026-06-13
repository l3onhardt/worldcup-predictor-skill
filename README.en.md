# World Cup Asian Handicap Trader Skill

**Positioning**: a World Cup Asian handicap and prediction-market trading decision skill for Codex, Claude Code, and compatible agent environments. It turns audited team snapshots, market odds, bookmaker line movement, and model probabilities into explicit decisions: `TRADE`, `SMALL TRADE`, `WAIT`, `PASS`, or `HEDGE/REDUCE`.

[中文](README.md) | [Quick Reference](docs/QUICK-REFERENCE.md)

## Trading Objective

The objective is long-run profit maximization. The skill works like a trading desk:

- Give the trading decision first.
- Compare model fair price, devigged market price, and blended probability.
- Read line movement, water movement, favourite tax, underdog crowding, and cross-market disagreement.
- Analyze team state, incentives, schedule, matchup, and reviewed personnel adjustments.
- Provide entry, trigger, sizing, Kelly haircut, invalidation, exit, and hedge rules.
- Say `PASS` when edge is weak and `WAIT` when the side is right but the price is wrong.

It does not claim sure wins, fixed results, inside information, breakeven certainty, or no-risk trades. Those claims are bad trading inputs.

## Quick Start

```bash
npx skills add https://github.com/l3onhardt/worldcup-predictor-skill --skill worldcup-predictor
```

Manual install:

```bash
git clone https://github.com/l3onhardt/worldcup-predictor-skill.git ~/.codex/skills/worldcup-predictor
```

Example prompts:

```text
Use worldcup-predictor as an Asian handicap trader for France vs Brazil. Give the Trading Decision Card first.
Use worldcup-predictor: how should I trade this -0.5 line? Include entry, size, and invalidation.
Use worldcup-predictor to compare model vs Polymarket and rank the best EV trades.
Use worldcup-predictor to decide whether the current line is TRADE, WAIT, or PASS.
Use worldcup-predictor for a 3-1-0 card: bankers, covers, cuts, and no-play matches.
Use worldcup-predictor for an outright market: EV, capital lockup, and hedge plan.
```

## Standard Output

Every actionable report begins with:

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

The report then expands team state, bookmaker read, probability chain, EV/Kelly, execution, and losing path.

## Capabilities

### Line Trading

- 90-minute win/draw/loss probabilities, expected goals, and scoreline distribution.
- Asian handicap, totals, and BTTS fair prices.
- Opening/current line and water interpretation.
- `TRADE / WAIT / PASS / HEDGE` decisions.

### Market Pricing

- Free/public market capture through API exports, browser observations, or manual composite snapshots.
- Polymarket or manual odds snapshots as cross-market confirmation.
- Power-method devigging.
- Model, devigged market, and blended probability columns for 1x2.
- Asian handicap and over/under fair odds from five-segment outcomes: full win, half win, push, half lose, full lose.
- EV and fractional Kelly across `1x2`, `ah`, and `ou`.
- Entry triggers, sizing haircuts, and correlated exposure control.

### Team-State Analysis

- Elo/FIFA/rating version and freshness.
- Reviewed form, personnel, host, schedule, and incentive adjustments.
- Group incentives, acceptable draw, rotation, and knockout-path incentives.
- Data-supported matchup risks: press, transition, aerials, set pieces, keeper variance.

### Tournament And 3-1-0

- 48-team World Cup simulation.
- Locked completed results.
- Qualification, advancement, and champion paths.
- 3-1-0 banker, cover, cut, optional 9-match subset, and budget trimming.

## CLI Examples

Requires Node.js 20 or newer.

```bash
node scripts/predict-match.mjs --data assets/sample-data/worldcup-2026.json --home MEX --away KOR
node scripts/predict-markets.mjs --data assets/sample-data/worldcup-2026.json --home MEX --away KOR
node scripts/fetch-free-market.mjs --composite assets/sample-data/free-market-composite.json --out market.json --append-history logs/markets
node scripts/fetch-free-market.mjs --the-odds-api-file odds-api-event.json --match-id sample-group-a-1 --bookmaker pinnacle --out market.json
node scripts/fetch-free-market.mjs --the-odds-api-event <event-id> --sport soccer_fifa_world_cup --match-id <match-id> --out market.json
node scripts/fetch-market.mjs --manual my-odds.json --out market.json
node scripts/value-scan.mjs --data assets/sample-data/worldcup-2026.json --market assets/sample-data/market-snapshot.json
node scripts/blind-commit.mjs --data assets/sample-data/worldcup-2026.json --all
node scripts/simulate-tournament.mjs --data assets/sample-data/synthetic-48-team.json --simulations 10000 --seed 2026
node scripts/generate-lottery-slip.mjs --issue assets/sample-data/lottery-issue.json --strategy balanced --budget 288
```

## Technical Scopes

- `90minResult`: 90 minutes plus stoppage time. Use for 1x2, Asian handicap, totals, BTTS, 3-1-0, and group points.
- `advanceResult`: advancement after extra time or penalties. Use for knockout progression, champion paths, and outright markets.
- Market data never enters fundamental `sourceVersions`.
- Free market snapshots carry `sourceQuality`; use it as a sizing haircut and history audit input.
- Only `manual_review` or versioned `deterministic_rule` adjustments can affect calculations.
- The LLM explains CLI output; it does not invent live facts or hand-calculate probabilities.

## Development

```bash
npm test
npm run smoke
npm run update-core-manifest
```

## License

[MIT](LICENSE)
