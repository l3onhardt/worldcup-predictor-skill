#!/usr/bin/env node
// 市场数据唯一的网络入口：拉取 Polymarket Gamma API 或转换手填赔率，落盘为市场快照。
// 核心计算永远不直接联网；下游脚本只消费本脚本产出的快照文件。

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { decimalFromAmerican, decimalFromHongKong } from "../core/odds.mjs";
import { round } from "../core/utils.mjs";
import { fail, parseArgs, readJson } from "./audit-input.mjs";
import { auditMarketSnapshot } from "./market-input.mjs";

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const usage = [
  "Usage:",
  "  node scripts/fetch-market.mjs --manual <odds.json> [--out <snapshot.json>]",
  "  node scripts/fetch-market.mjs --gamma-slug <event-slug> [--match-id id --home Name --away Name] [--out <snapshot.json>]",
].join("\n");

function toDecimal(value, format = "decimal") {
  if (format === "decimal") return value;
  if (format === "american") return decimalFromAmerican(value);
  if (format === "hongkong") return decimalFromHongKong(value);
  throw new Error(`Unsupported odds format: ${format}`);
}

export function manualToSnapshot(manual) {
  if (!manual || !Array.isArray(manual.matches) || manual.matches.length === 0) {
    throw new Error("manual input must contain a non-empty matches array.");
  }
  const labels = { "3": "homeName", "1": null, "0": "awayName" };
  const markets = manual.matches.map((match, index) => {
    if (!match.matchId) throw new Error(`matches[${index}].matchId is required.`);
    if (!match.odds || !["3", "1", "0"].every((key) => Number.isFinite(match.odds[key]))) {
      throw new Error(`matches[${index}].odds must contain numeric 3/1/0 entries.`);
    }
    const outcomes = ["3", "1", "0"].map((name) => {
      const price = toDecimal(match.odds[name], match.format ?? "decimal");
      return {
        name,
        label: labels[name] ? match[labels[name]] ?? name : "Draw",
        price: round(price, 4),
        impliedProb: round(1 / price),
      };
    });
    return { matchId: match.matchId, type: "1x2", outcomes };
  });
  return {
    source: manual.source ?? "manual",
    fetchedAt: manual.fetchedAt ?? new Date().toISOString(),
    markets,
  };
}

function parseJsonArray(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return Array.isArray(parsed) ? parsed : [];
}

export function gammaEventToMarkets(event, options = {}) {
  const rawMarkets = Array.isArray(event?.markets) ? event.markets : [];
  if (rawMarkets.length === 0) throw new Error("Gamma event contains no markets.");

  const threeWay = rawMarkets.find((market) => {
    const outcomes = parseJsonArray(market.outcomes);
    return outcomes.length === 3 && outcomes.some((name) => /draw/i.test(name));
  });
  if (threeWay && options.matchId) {
    const outcomes = parseJsonArray(threeWay.outcomes);
    const prices = parseJsonArray(threeWay.outcomePrices).map(Number);
    const mapped = outcomes.map((name, index) => {
      const price = prices[index];
      const label310 = /draw/i.test(name)
        ? "1"
        : options.home && name.toLowerCase().includes(options.home.toLowerCase())
          ? "3"
          : "0";
      return { name: label310, label: name, price: round(1 / price, 4), impliedProb: round(price) };
    });
    return [{ matchId: options.matchId, type: "1x2", outcomes: mapped }];
  }

  const binaries = rawMarkets.filter((market) => parseJsonArray(market.outcomes).length === 2);
  if (binaries.length === 0) throw new Error("Gamma event has no convertible markets.");
  const outcomes = binaries.map((market) => {
    const prices = parseJsonArray(market.outcomePrices).map(Number);
    const yesPrice = prices[0];
    return {
      name: market.groupItemTitle || market.question || market.id,
      label: market.groupItemTitle || market.question || market.id,
      price: round(1 / yesPrice, 4),
      impliedProb: round(yesPrice),
    };
  });
  return [{ marketId: event.slug ?? event.id, type: "outright", outcomes }];
}

async function fetchGammaEvent(slug) {
  const response = await fetch(`${GAMMA_BASE}/events?slug=${encodeURIComponent(slug)}`);
  if (!response.ok) throw new Error(`Gamma API request failed: ${response.status}`);
  const events = await response.json();
  if (!Array.isArray(events) || events.length === 0) throw new Error(`No Gamma event found for slug: ${slug}`);
  return events[0];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.manual && !args["gamma-slug"])) fail("Provide --manual or --gamma-slug.", usage);
  let snapshot;
  if (args.manual) {
    snapshot = manualToSnapshot(readJson(args.manual));
  } else {
    const event = await fetchGammaEvent(args["gamma-slug"]);
    snapshot = {
      source: "polymarket",
      fetchedAt: new Date().toISOString(),
      markets: gammaEventToMarkets(event, { matchId: args["match-id"], home: args.home, away: args.away }),
    };
  }
  const audited = auditMarketSnapshot(snapshot);
  const output = JSON.stringify(audited, null, 2);
  if (args.out) {
    writeFileSync(args.out, `${output}\n`);
    console.error(`Market snapshot written to ${args.out}`);
  } else {
    console.log(output);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error), usage));
}
