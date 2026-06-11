// 基本面管道适配器：FIFA 男足排名（inside.fifa.com 非官方 JSON 端点）。
// 端点不稳定（可能返回空 rankings），质量门负责兜底；失败时调用方保留旧快照值。

const FIFA_URL = "https://inside.fifa.com/api/ranking-overview?locale=en";
const MIN_RECORDS = 50;

export const fifaSourceMeta = {
  id: "fifa-ranking",
  kind: "fundamental",
  url: FIFA_URL,
  ttlHours: 168,
};

export async function fetchRaw() {
  const response = await fetch(FIFA_URL, { headers: { "User-Agent": "Mozilla/5.0 (worldcup-predictor-skill)" } });
  if (!response.ok) throw new Error(`fifa-ranking fetch failed: HTTP ${response.status}`);
  return response.text();
}

export function parseFifaRanking(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const rankings = Array.isArray(data?.rankings) ? data.rankings : [];
  const records = [];
  for (const entry of rankings) {
    const item = entry?.rankingItem ?? entry;
    const name = item?.name;
    const countryCode = item?.countryCode;
    const rank = Number(item?.rank);
    const points = Number(item?.totalPoints);
    if (!name || !Number.isFinite(rank)) continue;
    records.push({ name, countryCode, rank, points: Number.isFinite(points) ? points : null });
  }
  return records;
}

export function fifaQualityGate(records) {
  if (!Array.isArray(records) || records.length < MIN_RECORDS) {
    throw new Error(`fifa-ranking quality gate: expected at least ${MIN_RECORDS} records, got ${records?.length ?? 0}.`);
  }
  for (const record of records) {
    if (record.rank < 1 || record.rank > 250) {
      throw new Error(`fifa-ranking quality gate: rank ${record.rank} for ${record.name} out of range.`);
    }
  }
  return records;
}
