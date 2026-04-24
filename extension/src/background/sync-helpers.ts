export function getBatchSlice<T>(
  items: T[],
  cursor: number,
  batchSize: number
): { batch: T[]; nextCursor: number } {
  const nextCursor = Math.min(cursor + batchSize, items.length);
  return {
    batch: items.slice(cursor, nextCursor),
    nextCursor,
  };
}

export function getServerUrlCandidates(
  preferredUrl: string | null,
  defaults: string[]
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const url of [preferredUrl, ...defaults]) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    candidates.push(url);
  }

  return candidates;
}
