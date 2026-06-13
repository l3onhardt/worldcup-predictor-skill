# Trading Report Template / 交易报告输出模板

Use this template for World Cup trading decisions, Asian handicap pricing, totals, 1x2, outrights, and 3/1/0 decision support. All numeric outputs must come from CLI output or explicitly supplied market data.

## Core Principles

- Lead with the **交易决策卡 / Trading Decision Card**. The user asked for a decision; do not bury it.
- Optimize for long-run expected profit and risk-adjusted return, not narrative certainty.
- Always show model, devigged market, and blended probability when market data exists.
- Convert risk into trade structure: sizing, entry, invalidation, exit, hedge, and pass criteria.
- No long disclaimer block. Express uncertainty as trading variables: confidence, variance, liquidity, data freshness, and worst-case loss.
- Do not use guaranteed-profit language or claim inside information.

## 0. 交易决策卡 / Trading Decision Card

Start every actionable report with this block:

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

If there is no edge, the decision card must still be explicit: `PASS`, with the price that would change the decision.

## 1. Data Summary

- **Match**: home vs away, venue, kickoff time.
- **Snapshot**: `modelVersion`, `dataVersion`, `generatedAt`.
- **Market snapshot**: source, `fetchedAt`, `marketAgeHours`, stale warning if above threshold.
- **Blind commit**: confirmed / not applicable.
- **Available markets**: Asian handicap, total, 1x2, outright, 3/1/0.

## 2. Team-State Read

Cover only factors supported by audited data or user-supplied facts:

- Strength baseline: rating/Elo/FIFA and freshness.
- Recent state: attack, defense, finishing, goalkeeper variance, set pieces, transition risk.
- Personnel: injuries/suspensions only if reviewed in the snapshot.
- Motivation: group incentives, draw incentives, rotation, knockout incentives.
- Matchup: tactical mismatch, venue, travel, weather, and referee if present.

End with a trader's summary: which team is mispriced, overtaxed, or under-respected by the market.

## 3. Market And Bookmaker Read

Explain what the price action implies:

- Opening line vs current line.
- Water/odds movement and whether the line moved.
- Favourite/underdog tax, public bias, and sharp-looking movement.
- Cross-market consistency: Asian handicap vs total vs 1x2 vs outright.
- Liquidity and stale-price risk.

Treat the bookmaker line as a clue, not a command. The decision comes from the disagreement between fair price, market price, and team-state evidence.

## 4. Probability And Fair Price

Show the full chain:

```text
Market odds: home 2.10, draw 3.40, away 3.80
Raw implied: 47.6% + 29.4% + 26.3% = 103.3%
Devigged market: from value-scan output
Pure model: from blind-committed model output
Blended view: market-weighted or configured blend
```

For Asian handicap, totals, and BTTS, use `predict-markets.mjs` fair prices. Keep every market on `90minResult` unless it is explicitly an advancement/outright market.

## 5. Edge And EV Table

List candidates by expected value and risk-adjusted expected value:

| Market | Side | Market price | Fair price/prob | EV | Kelly | Haircut | Decision |
|---|---|---:|---:|---:|---:|---:|---|

Rules:

- `EV = p * d - 1`, where `p` is the selected probability basis and `d` is market decimal price.
- Kelly is the upper sizing reference, not the automatic stake.
- Haircut Kelly for stale data, low liquidity, uncertain lineup, high draw probability, and correlated exposure.
- Reject trades where EV exists only because of a fragile assumption.

## 6. Strategy And Execution

For the chosen decision:

- **Entry plan**: current entry, improved trigger, and no-chase limit.
- **Sizing**: bankroll fraction, exposure cap, and why the size is not larger.
- **Add condition**: when to increase.
- **Reduce/hedge condition**: when edge is gone.
- **Pass condition**: exact price/line where trade becomes bad.
- **Portfolio view**: correlation with other positions, same-team exposure, same-day drawdown.

## 7. Scenario Analysis

For each active or near-active trade:

- Best case.
- Base case.
- Worst case.
- What the market may know that the model does not.
- How the trade loses even if the analysis is directionally right.

Do not soften the downside. A good trader names the losing path before entering.

## 8. Final Trading Plan

Close with a direct plan:

- **Primary action**: the one trade to take, wait for, hedge, or pass.
- **Secondary action**: backup line or alternate market if the primary price disappears.
- **No-trade line**: the point where discipline overrides desire.
- **Review trigger**: lineup release, price move, market refresh, injury update, or kickoff proximity.
