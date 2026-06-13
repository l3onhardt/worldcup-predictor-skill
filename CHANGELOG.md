# Changelog

All notable changes to the worldcup-predictor skill are documented here.

## [0.5.1] - 2026-06-13

### Repositioned

- Repositioned the skill as a World Cup Asian handicap trading-decision skill.
- The primary output is now a Trading Decision Card: `TRADE`, `SMALL TRADE`, `WAIT`, `PASS`, or `HEDGE/REDUCE`.
- The skill now optimizes for long-run expected profit with bankroll survival constraints.
- Risk is expressed as trade structure: entry, size, Kelly haircut, invalidation, exit, hedge, liquidity, and worst-case path.

### Changed

- Rewrote `SKILL.md`, `references/research-report.md`, and `references/communication-guidelines.md` around trading execution.
- Rewrote `README.md`, `README.en.md`, and `docs/QUICK-REFERENCE.md` to remove stale research-assistant positioning.
- Updated `agents/openai.yaml` to present the skill as `World Cup Asian Handicap Trader`.
- Replaced CLI output `disclaimer` fields with `tradingNote` in market pricing, value scan, and 3/1/0 decision output.
- Rewrote `references/lottery-rules.md` as a 3/1/0 decision-board guide: banker, cover, cut, and no-play.

### Validation

- Added tests preventing the primary skill surfaces from drifting back to stale positioning.
- Added tests requiring trading-facing CLIs to expose `tradingNote` instead of `disclaimer`.
- Refreshed `core/manifest.json` after core output-field changes.

## [0.5.0] - 2026-06-12

### Added

- Market snapshot flow for manual odds and Polymarket Gamma API.
- Blind-commit workflow for model independence before reading market prices.
- Model/market/devig/blended probability reporting.
- EV and fractional Kelly value metrics.
- Asian handicap, totals, and BTTS fair-line pricing from the score distribution.

## [0.4.0] - 2026-06-11

### Added

- Dual-pipeline data architecture separating fundamental snapshots from market snapshots.
- Audit firewall rejecting market-like sources in fundamental `sourceVersions`.
- TTL-based data refresh adapters for Elo, FIFA, and football-data sources.

## [0.3.0] - 2026-06-10

### Added

- Deterministic World Cup match prediction, score distribution, and tournament simulation core.
- 90-minute result scope and advancement result scope separation.
- 3/1/0 list generation from 90-minute probabilities.
