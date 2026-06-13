import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_HISTORY_FILE = "market-history.jsonl";

export function historyRowsFromSnapshot(snapshot) {
  return snapshot.markets.map((market) => ({
    recordedAt: new Date().toISOString(),
    source: snapshot.source,
    fetchedAt: snapshot.fetchedAt,
    sourceQuality: snapshot.sourceQuality ?? null,
    sourceNotes: snapshot.sourceNotes ?? [],
    market,
  }));
}

export function appendMarketHistory(snapshot, historyDir, fileName = DEFAULT_HISTORY_FILE) {
  mkdirSync(historyDir, { recursive: true });
  const historyPath = join(historyDir, fileName);
  const rows = historyRowsFromSnapshot(snapshot);
  appendFileSync(historyPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return { historyPath, rowsWritten: rows.length };
}
