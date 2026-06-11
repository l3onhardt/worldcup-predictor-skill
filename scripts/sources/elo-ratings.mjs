// 基本面管道适配器：World Football Elo Ratings (eloratings.net)。
// fetchRaw 是唯一联网函数；parse 与 qualityGate 为纯函数，可用 fixture 离线测试。

const ELO_URL = "https://www.eloratings.net/World.tsv";
const MIN_RECORDS = 100;
const RATING_RANGE = { min: 200, max: 2500 };

export const eloSourceMeta = {
  id: "elo-ratings",
  kind: "fundamental",
  url: ELO_URL,
  ttlHours: 24,
};

export async function fetchRaw() {
  const response = await fetch(ELO_URL, { headers: { "User-Agent": "worldcup-predictor-skill/0.4" } });
  if (!response.ok) throw new Error(`elo-ratings fetch failed: HTTP ${response.status}`);
  return response.text();
}

// World.tsv 格式：rank \t prevRank \t code \t rating \t ...（无表头）
export function parseEloTsv(raw) {
  const records = [];
  for (const line of String(raw).split("\n")) {
    const cells = line.split("\t");
    if (cells.length < 4) continue;
    const code = cells[2]?.trim();
    const rating = Number(cells[3]);
    if (!code || !Number.isFinite(rating)) continue;
    records.push({ code, rating });
  }
  return records;
}

export function eloQualityGate(records) {
  if (!Array.isArray(records) || records.length < MIN_RECORDS) {
    throw new Error(`elo-ratings quality gate: expected at least ${MIN_RECORDS} records, got ${records?.length ?? 0}.`);
  }
  for (const record of records) {
    if (record.rating < RATING_RANGE.min || record.rating > RATING_RANGE.max) {
      throw new Error(`elo-ratings quality gate: rating ${record.rating} for ${record.code} outside [${RATING_RANGE.min}, ${RATING_RANGE.max}].`);
    }
  }
  const codes = new Set(records.map((record) => record.code));
  if (codes.size !== records.length) {
    throw new Error("elo-ratings quality gate: duplicate country codes detected.");
  }
  return records;
}
