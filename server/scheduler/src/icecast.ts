// Listener count, read from Icecast's status-json.xsl.

/**
 * Extracts the listener count of `mount` from a status-json.xsl payload, or
 * null if that mount is not live. Icecast returns `icestats.source` as an
 * object when a single mount is live, as an array when there are several,
 * and omits it when there are none.
 */
export function parseListeners(status: unknown, mount: string): number | null {
  const source = (status as { icestats?: { source?: unknown } })?.icestats?.source;
  const sources = Array.isArray(source) ? source : source ? [source] : [];
  for (const s of sources as { listenurl?: unknown; listeners?: unknown }[]) {
    if (typeof s.listenurl === "string" && s.listenurl.endsWith(`/${mount}`)) {
      return typeof s.listeners === "number" ? s.listeners : null;
    }
  }
  return null;
}

/**
 * Returns a function giving the current listener count. Results are cached
 * for `ttlMs`, so page polls from many visitors cost Icecast one request.
 */
export function createListenerCounter(
  icecastUrl: string,
  mount: string,
  ttlMs = 5_000,
): () => Promise<number | null> {
  let cached: { at: number; value: Promise<number | null> } | null = null;
  return () => {
    const now = Date.now();
    if (!cached || now - cached.at > ttlMs) {
      const value = fetch(`${icecastUrl}/status-json.xsl`, { signal: AbortSignal.timeout(3_000) })
        .then((res) => (res.ok ? res.json() : null))
        .then((status) => parseListeners(status, mount))
        .catch(() => null);
      cached = { at: now, value };
    }
    return cached.value;
  };
}
