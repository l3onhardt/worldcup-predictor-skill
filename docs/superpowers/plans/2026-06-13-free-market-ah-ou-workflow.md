# Free Market AH/OU Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or work through the steps inline with TDD.

**Goal:** Add a free-source market ingestion path and make value scanning price Asian handicap and over/under markets, not only 1x2.

**Architecture:** Keep the existing audited snapshot and market snapshot boundaries. Add small market utility functions for handicap-style EV/Kelly, extend `value-scan` to route `1x2`, `ah`, and `ou`, and add a free-market CLI that can normalize manual/free-source inputs and optionally append history.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing `core/markets.mjs`, `scripts/market-input.mjs`, and JSON snapshots.

---

### Task 1: AH/OU Value Metrics

**Files:**
- Modify: `core/odds.mjs`
- Test: `tests/odds.test.mjs`

- [x] Write failing tests for five-segment handicap EV and capped fractional Kelly.
- [x] Implement `handicapValueMetrics(outcomes, decimalPrice)`.
- [x] Run `node --test tests/odds.test.mjs`.

### Task 2: Value Scan Routes AH/OU

**Files:**
- Modify: `scripts/value-scan.mjs`
- Test: `tests/skill.test.mjs`

- [x] Write a failing test with a market snapshot containing `1x2`, `ah`, and `ou`.
- [x] Extend `value-scan` to output `markets[]` candidates for all supported match markets while preserving existing `matches[]` compatibility for 1x2.
- [x] Run targeted skill tests.

### Task 3: Free Market Snapshot CLI

**Files:**
- Create: `scripts/fetch-free-market.mjs`
- Create: `scripts/market-history.mjs`
- Test: `tests/free-market.test.mjs`

- [x] Write failing tests for normalizing a free-source fixture into audited market snapshot shape.
- [x] Implement manual/free composite input first, with optional `--append-history`.
- [x] Add provider stubs for future API/browser sources that fail gracefully without keys or URLs.

### Task 4: Skill Workflow Docs

**Files:**
- Modify: `SKILL.md`
- Modify: `README.md`
- Modify: `README.en.md`
- Modify: `docs/QUICK-REFERENCE.md`
- Create: `references/free-data-sources.md`

- [x] Document free-source workflow, quality scores, AH/OU EV scanning, and fallback order.
- [x] Ensure docs still lead with trading decisions and do not regress into research-assistant positioning.

### Task 5: Verification And Sync

- [x] Run `npm test`.
- [x] Run `npm run smoke`.
- [x] Run `quick_validate.py`.
- [x] Sync updated skill into `.codex` and `.claude` installations.
- [ ] Commit and push.
