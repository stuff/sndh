// Next-track selection: weighted random with anti-repetition rules.
// Pure (no I/O) so it can be unit-tested; the caller supplies the library
// and the recent history.

export interface Candidate {
  id: number;
  artist: string | null;
  weight: number;
  blacklisted: boolean;
}

export interface RecentEntry {
  trackId: number;
  artist: string | null;
}

export interface PickOptions {
  // Tracks played within this many last plays are excluded.
  recentTracks: number;
  // Composers heard within this many last plays are excluded.
  recentArtists: number;
  // Injectable for tests; returns a float in [0, 1).
  random?: () => number;
}

function weightedPick<T extends Candidate>(pool: T[], random: () => number): T {
  const total = pool.reduce((sum, c) => sum + c.weight, 0);
  let r = random() * total;
  for (const c of pool) {
    r -= c.weight;
    if (r < 0) return c;
  }
  return pool[pool.length - 1]!;
}

/**
 * Picks the next track, or null when nothing is playable.
 * `recent` is ordered most recent first. The rules are relaxed step by step
 * when they leave no candidate (small library): first the composer rule is
 * dropped, then the track window is shrunk, then everything goes.
 */
export function pickTrack<T extends Candidate>(
  candidates: T[],
  recent: RecentEntry[],
  opts: PickOptions,
): T | null {
  const random = opts.random ?? Math.random;
  const playable = candidates.filter((c) => !c.blacklisted && c.weight > 0);
  if (playable.length === 0) return null;

  // Never exclude more than half the playable tracks, so there is always
  // some variety left to pick from.
  const trackWindow = Math.min(opts.recentTracks, Math.floor(playable.length / 2));
  const excludedTracks = new Set(recent.slice(0, trackWindow).map((e) => e.trackId));
  const excludedArtists = new Set(
    recent
      .slice(0, opts.recentArtists)
      .map((e) => e.artist)
      .filter((a): a is string => a !== null),
  );

  const attempts: ((c: T) => boolean)[] = [
    (c) => !excludedTracks.has(c.id) && (c.artist === null || !excludedArtists.has(c.artist)),
    (c) => !excludedTracks.has(c.id),
    // Last resort: only avoid replaying the very last track.
    (c) => c.id !== recent[0]?.trackId,
  ];
  for (const keep of attempts) {
    const pool = playable.filter(keep);
    if (pool.length > 0) return weightedPick(pool, random);
  }
  return weightedPick(playable, random);
}
