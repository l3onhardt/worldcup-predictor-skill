// 基本面管道适配器：football-data.org v4 世界杯赛程与赛果。
// 需要免费 API key（环境变量 FOOTBALL_DATA_API_KEY）；无 key 时调用方应跳过本源并标注。

const FD_URL = "https://api.football-data.org/v4/competitions/WC/matches";

export const footballDataSourceMeta = {
  id: "football-data",
  kind: "fundamental",
  url: FD_URL,
  ttlHours: 1,
  requiresKey: "FOOTBALL_DATA_API_KEY",
};

const STAGE_MAP = {
  GROUP_STAGE: "group",
  LAST_32: "round_of_32",
  LAST_16: "round_of_16",
  QUARTER_FINALS: "quarter_final",
  SEMI_FINALS: "semi_final",
  THIRD_PLACE: "third_place",
  FINAL: "final",
};

export async function fetchRaw(apiKey = process.env.FOOTBALL_DATA_API_KEY) {
  if (!apiKey) throw new Error("football-data requires FOOTBALL_DATA_API_KEY.");
  const response = await fetch(FD_URL, { headers: { "X-Auth-Token": apiKey } });
  if (!response.ok) throw new Error(`football-data fetch failed: HTTP ${response.status}`);
  return response.text();
}

export function parseFootballData(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const finished = [];
  for (const match of Array.isArray(data?.matches) ? data.matches : []) {
    if (match.status !== "FINISHED") continue;
    const score = match.score?.fullTime;
    if (!Number.isInteger(score?.home) || !Number.isInteger(score?.away)) continue;
    finished.push({
      externalId: match.id,
      stage: STAGE_MAP[match.stage] ?? match.stage,
      homeName: match.homeTeam?.name,
      awayName: match.awayTeam?.name,
      score: { home: score.home, away: score.away },
    });
  }
  return { competitionCode: data?.competition?.code ?? null, finished };
}

export function footballDataQualityGate(records) {
  if (records.competitionCode !== "WC") {
    throw new Error(`football-data quality gate: expected competition WC, got ${records.competitionCode}.`);
  }
  for (const match of records.finished) {
    if (!match.homeName || !match.awayName) {
      throw new Error("football-data quality gate: finished match missing team names.");
    }
  }
  return records;
}
