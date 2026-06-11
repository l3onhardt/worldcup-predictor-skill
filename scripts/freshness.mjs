// 新鲜度清单纯函数：TTL 判定与更新。清单文件本身由 refresh-snapshot.mjs 读写。

export function staleSources(manifest, nowIso) {
  const now = new Date(nowIso).getTime();
  const stale = [];
  for (const [id, entry] of Object.entries(manifest?.sources ?? {})) {
    if (!entry.lastFetchedAt) {
      stale.push(id);
      continue;
    }
    const fetched = new Date(entry.lastFetchedAt).getTime();
    const ttlMs = (entry.ttlHours ?? 24) * 3600000;
    if (Number.isNaN(fetched) || now - fetched > ttlMs) stale.push(id);
  }
  return stale;
}

export function touchSource(manifest, sourceId, nowIso, contentHash) {
  return {
    ...manifest,
    sources: {
      ...manifest.sources,
      [sourceId]: {
        ...manifest.sources?.[sourceId],
        lastFetchedAt: nowIso,
        contentHash,
      },
    },
  };
}
