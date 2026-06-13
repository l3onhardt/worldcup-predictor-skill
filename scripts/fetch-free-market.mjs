#!/usr/bin/env node
// Free/public market ingestion: normalize browser/API/manual captures into audited market snapshots.

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { round } from "../core/utils.mjs";
import { fail, parseArgs, readJson } from "./audit-input.mjs";
import { auditMarketSnapshot } from "./market-input.mjs";
import { appendMarketHistory } from "./market-history.mjs";

const THE_ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const DEFAULT_FREE_API_MARKETS = "h2h,spreads,totals";
const usage = [
  "Usage:",
  "  node scripts/fetch-free-market.mjs --composite <free-capture.json> [--out market.json] [--append-history dir]",
  "  node scripts/fetch-free-market.mjs --the-odds-api-file <event.json> --match-id <id> [--bookmaker key] [--out market.json]",
  "  node scripts/fetch-free-market.mjs --the-odds-api-event <event-id> --sport <sport-key> --match-id <id> [--bookmaker key] [--out market.json]",
].join("\n");

function decimalPrice(value, field) {
  if (!Number.isFinite(value) || value <= 1) throw new Error(`${field} must be decimal odds greater than 1.`);
  return round(value, 4);
}

function averageQuality(observations, explicitQuality) {
  if (Number.isFinite(explicitQuality)) return round(explicitQuality, 4);
  const qualities = observations.map((entry) => entry.quality).filter(Number.isFinite);
  if (qualities.length === 0) return null;
  return round(qualities.reduce((sum, quality) => sum + quality, 0) / qualities.length, 4);
}

function outcome(name, label, price) {
  const decimal = decimalPrice(price, `${label || name} price`);
  return { name, label, price: decimal, impliedProb: round(1 / decimal) };
}

function normalizeCompositeObservation(observation, index) {
  if (!observation.matchId) throw new Error(`observations[${index}].matchId is required.`);
  const type = observation.marketType ?? observation.type;
  const prices = observation.prices ?? {};
  if (type === "1x2") {
    return {
      matchId: observation.matchId,
      type: "1x2",
      provider: observation.provider,
      captureMethod: observation.captureMethod,
      outcomes: [
        outcome("3", observation.homeName ?? "Home", prices.home ?? prices["3"]),
        outcome("1", "Draw", prices.draw ?? prices["1"]),
        outcome("0", observation.awayName ?? "Away", prices.away ?? prices["0"]),
      ],
    };
  }
  if (type === "ah") {
    if (!Number.isFinite(observation.line)) throw new Error(`observations[${index}].line is required for AH.`);
    return {
      matchId: observation.matchId,
      type: "ah",
      line: observation.line,
      provider: observation.provider,
      captureMethod: observation.captureMethod,
      outcomes: [
        outcome("home", `${observation.homeName ?? "Home"} ${observation.line}`, prices.home),
        outcome("away", `${observation.awayName ?? "Away"} ${-observation.line}`, prices.away),
      ],
    };
  }
  if (type === "ou") {
    if (!Number.isFinite(observation.line)) throw new Error(`observations[${index}].line is required for OU.`);
    return {
      matchId: observation.matchId,
      type: "ou",
      line: observation.line,
      provider: observation.provider,
      captureMethod: observation.captureMethod,
      outcomes: [
        outcome("over", `Over ${observation.line}`, prices.over),
        outcome("under", `Under ${observation.line}`, prices.under),
      ],
    };
  }
  throw new Error(`observations[${index}].marketType must be 1x2, ah, or ou.`);
}

export function compositeToSnapshot(input, options = {}) {
  const observations = input.observations ?? input.markets ?? [];
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new Error("composite input must contain a non-empty observations array.");
  }
  const markets = observations.map(normalizeCompositeObservation);
  const sourceQuality = averageQuality(observations, options.sourceQuality ?? input.sourceQuality);
  return {
    source: input.source ?? "free-composite",
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    sourceQuality,
    sourceNotes: [
      "free_source_composite",
      "capture must preserve public source, timestamp, opening/current line when available",
    ],
    markets,
  };
}

function chooseBookmaker(event, requestedBookmaker) {
  const bookmakers = Array.isArray(event.bookmakers) ? event.bookmakers : [];
  if (bookmakers.length === 0) throw new Error("The Odds API event contains no bookmakers.");
  if (requestedBookmaker) {
    const bookmaker = bookmakers.find((entry) => entry.key === requestedBookmaker || entry.title === requestedBookmaker);
    if (!bookmaker) throw new Error(`Bookmaker ${requestedBookmaker} was not found in The Odds API event.`);
    return bookmaker;
  }
  return bookmakers[0];
}

function marketByKey(bookmaker, key) {
  return (bookmaker.markets ?? []).find((market) => market.key === key);
}

function latestMarketUpdate(markets) {
  const times = markets
    .map((market) => new Date(market.last_update).getTime())
    .filter((time) => !Number.isNaN(time));
  if (times.length === 0) return null;
  return new Date(Math.max(...times)).toISOString();
}

function outcomeByName(outcomes, name) {
  return outcomes.find((entry) => String(entry.name).toLowerCase() === name.toLowerCase());
}

function participantOutcome(outcomes, participant) {
  return outcomes.find((entry) => String(entry.name).toLowerCase() === String(participant).toLowerCase());
}

export function theOddsApiEventToSnapshot(event, options = {}) {
  const bookmaker = chooseBookmaker(event, options.bookmaker);
  const matchId = options.matchId ?? event.id;
  if (!matchId) throw new Error("--match-id is required when The Odds API event has no id.");
  const homeName = event.home_team ?? options.home;
  const awayName = event.away_team ?? options.away;
  if (!homeName || !awayName) throw new Error("The Odds API event must include home_team and away_team.");

  const markets = [];
  const convertedSourceMarkets = [];
  const h2h = marketByKey(bookmaker, "h2h");
  if (h2h) {
    convertedSourceMarkets.push(h2h);
    markets.push({
      matchId,
      type: "1x2",
      provider: bookmaker.key,
      outcomes: [
        outcome("3", homeName, participantOutcome(h2h.outcomes, homeName)?.price),
        outcome("1", "Draw", outcomeByName(h2h.outcomes, "Draw")?.price),
        outcome("0", awayName, participantOutcome(h2h.outcomes, awayName)?.price),
      ],
    });
  }
  const spreads = marketByKey(bookmaker, "spreads");
  if (spreads) {
    const home = participantOutcome(spreads.outcomes, homeName);
    const away = participantOutcome(spreads.outcomes, awayName);
    if (home && away && Number.isFinite(home.point)) {
      convertedSourceMarkets.push(spreads);
      markets.push({
        matchId,
        type: "ah",
        line: home.point,
        provider: bookmaker.key,
        outcomes: [
          outcome("home", `${homeName} ${home.point}`, home.price),
          outcome("away", `${awayName} ${away.point}`, away.price),
        ],
      });
    }
  }
  const totals = marketByKey(bookmaker, "totals");
  if (totals) {
    const over = outcomeByName(totals.outcomes, "Over");
    const under = outcomeByName(totals.outcomes, "Under");
    if (over && under && Number.isFinite(over.point)) {
      convertedSourceMarkets.push(totals);
      markets.push({
        matchId,
        type: "ou",
        line: over.point,
        provider: bookmaker.key,
        outcomes: [
          outcome("over", `Over ${over.point}`, over.price),
          outcome("under", `Under ${under.point}`, under.price),
        ],
      });
    }
  }
  return {
    source: "the-odds-api-free",
    fetchedAt: latestMarketUpdate(convertedSourceMarkets) ?? event.commence_time ?? new Date().toISOString(),
    sourceQuality: Number.isFinite(options.sourceQuality) ? round(options.sourceQuality, 4) : 0.75,
    sourceNotes: ["free_api_export", `bookmaker=${bookmaker.key ?? bookmaker.title}`],
    markets,
  };
}

async function fetchTheOddsApiEvent({ sport, eventId, markets }) {
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey) {
    return {
      status: "skipped_no_key",
      provider: "the-odds-api",
      reason: "Set THE_ODDS_API_KEY to fetch; use --the-odds-api-file or --composite for offline/free captures.",
    };
  }
  if (!sport || !eventId) throw new Error("--sport and --the-odds-api-event are required.");
  const url = new URL(`${THE_ODDS_API_BASE}/sports/${encodeURIComponent(sport)}/events/${encodeURIComponent(eventId)}/odds`);
  url.searchParams.set("apiKey", apiKey);
  url.searchParams.set("regions", "us,uk,eu,au");
  url.searchParams.set("markets", markets ?? DEFAULT_FREE_API_MARKETS);
  url.searchParams.set("oddsFormat", "decimal");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The Odds API request failed with HTTP ${response.status}.`);
  return response.json();
}

function writeOutput(snapshot, args) {
  const audited = auditMarketSnapshot(snapshot);
  if (args["append-history"]) {
    const history = appendMarketHistory(audited, args["append-history"]);
    audited.history = history;
  }
  const output = JSON.stringify(audited, null, 2);
  if (args.out) {
    writeFileSync(args.out, `${output}\n`);
    console.error(`Free market snapshot written to ${args.out}`);
  } else {
    console.log(output);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) fail("Help requested.", usage);

  let snapshotOrReport;
  if (args.composite) {
    snapshotOrReport = compositeToSnapshot(readJson(args.composite), {
      sourceQuality: args["source-quality"] === undefined ? undefined : Number(args["source-quality"]),
    });
  } else if (args["the-odds-api-file"]) {
    snapshotOrReport = theOddsApiEventToSnapshot(readJson(args["the-odds-api-file"]), {
      matchId: args["match-id"],
      bookmaker: args.bookmaker,
      sourceQuality: args["source-quality"] === undefined ? undefined : Number(args["source-quality"]),
    });
  } else if (args["the-odds-api-event"]) {
    const fetched = await fetchTheOddsApiEvent({
      sport: args.sport,
      eventId: args["the-odds-api-event"],
      markets: args.markets,
    });
    if (fetched.status === "skipped_no_key") {
      console.log(JSON.stringify(fetched, null, 2));
      return;
    }
    snapshotOrReport = theOddsApiEventToSnapshot(fetched, {
      matchId: args["match-id"],
      bookmaker: args.bookmaker,
      sourceQuality: args["source-quality"] === undefined ? undefined : Number(args["source-quality"]),
    });
  } else {
    fail("Provide --composite, --the-odds-api-file, or --the-odds-api-event.", usage);
  }

  writeOutput(snapshotOrReport, args);
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => fail(error instanceof Error ? error.message : String(error), usage));
}
