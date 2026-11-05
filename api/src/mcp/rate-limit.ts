// mcp/rate-limit.ts
// A runaway agent must not hammer the database. A small in-memory sliding
// window, counted per token id, is enough for a single container: it is a guard
// rail, not a billing meter.
//
// Multi-replica deployments would move this counter into the registry (a
// `rate`/`window` row) so the limit is shared; a per-process limit only bounds
// one replica's share. Documented as a follow-up in docs/mcp-server-design.md.
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 120;

const hits = new Map<string, number[]>();

/** True when the call is allowed; records the hit when it is. */
export function checkRateLimit(tokenId: string, now = Date.now()): boolean {
  const recent = (hits.get(tokenId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_REQUESTS) {
    hits.set(tokenId, recent);
    return false;
  }
  recent.push(now);
  hits.set(tokenId, recent);
  // Opportunistic sweep so a long-lived process does not accumulate dead ids.
  if (hits.size > 1000) {
    for (const [id, times] of hits) {
      if (times.length === 0 || now - times[times.length - 1]! >= WINDOW_MS) hits.delete(id);
    }
  }
  return true;
}

/** Test hook. */
export function resetRateLimits(): void {
  hits.clear();
}
