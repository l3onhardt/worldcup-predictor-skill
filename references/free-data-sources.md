# Free Market Data Sources

Use this reference when the user asks for automatic or free Asian handicap, total, or 1x2 market capture.

## Source Order

1. **Free API export**: use `scripts/fetch-free-market.mjs --the-odds-api-event ...` when `THE_ODDS_API_KEY` is present, or `--the-odds-api-file` for an exported JSON response. Request `h2h,spreads,totals` and convert them to `1x2`, `ah`, and `ou`.
2. **Public browser capture**: use Browser/Computer Use to read publicly visible odds boards and save observations into the composite schema. Capture source URL/name, timestamp, opening line if visible, current line, and prices. Do not bypass login, paywall, captcha, geofence, or robots-style access limits.
3. **Manual composite**: when no durable API exists, normalize typed or pasted prices with `--composite`. This is still useful if it preserves source, timestamp, market type, line, side, and price.
4. **Polymarket/free prediction market**: use `scripts/fetch-market.mjs` for Gamma/Polymarket 1x2 or outright markets, then compare with the football book market when available.

## Composite Schema

```json
{
  "source": "free-composite",
  "fetchedAt": "2026-06-04T12:00:00.000Z",
  "observations": [
    {
      "provider": "public-board-a",
      "captureMethod": "browser",
      "quality": 0.72,
      "matchId": "sample-group-a-1",
      "marketType": "ah",
      "line": 0,
      "prices": { "home": 1.95, "away": 1.95 }
    }
  ]
}
```

Supported `marketType` values:

| Type | Required Prices | Notes |
|---|---|---|
| `1x2` | `home`, `draw`, `away` | maps to `3/1/0` |
| `ah` | `home`, `away` | `line` is from home side perspective |
| `ou` | `over`, `under` | `line` is total goals |

Normalize and append history:

```bash
node scripts/fetch-free-market.mjs --composite free-capture.json --out market.json --append-history logs/markets
node scripts/value-scan.mjs --data snapshot.json --market market.json
```

## Source Quality

`sourceQuality` is a trading haircut input, not a truth label.

| Score | Use |
|---|---|
| `0.80-0.95` | API export or stable public board with timestamp, bookmaker identity, and multiple markets |
| `0.65-0.79` | public browser capture with current prices but partial opening-line detail |
| `0.45-0.64` | manual/pasted odds with source and timestamp but weak provenance |
| `<0.45` | treat as watchlist only; usually `WAIT` unless edge is extreme and independently confirmed |

Average per-observation `quality` is carried to `marketSourceQuality` in `value-scan`.

## Trading Workflow

1. Run the pure model or blind commit before fetching prices when independence matters.
2. Capture at least `1x2`, `ah`, and `ou` for the same match when possible.
3. Convert to audited market snapshot with `fetch-free-market.mjs`.
4. Run `value-scan.mjs`; rank `report.markets[]` by `bestValue.ev`, not by narrative confidence.
5. Prefer AH/OU when they express the edge with lower draw ambiguity than 1x2.
6. Use `sourceQuality`, age, liquidity, lineup uncertainty, and cross-market disagreement as sizing haircuts.
7. Append history whenever watching line movement; compare later snapshots for line move, water move, or price compression.

## Browser Capture Discipline

Browser/Computer Use can collect visible public data, but the output must still be structured and audited. Record:

- `provider`
- URL or public source name when available
- `captureMethod`
- `fetchedAt`
- opening line and current line when visible
- side labels exactly as displayed
- decimal odds after conversion

If a page requires login, captcha, subscription, or access circumvention, switch to another public/free source or manual composite input.
