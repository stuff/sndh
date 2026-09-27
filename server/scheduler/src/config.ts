// Runtime configuration, read once from the environment.

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return value;
}

export const config = {
  // Root of the Opus library (read-only mount shared with Liquidsoap).
  musicDir: (process.env.MUSIC_DIR ?? "/music").replace(/\/+$/, ""),
  // SQLite database (index + play history), on a persistent volume.
  dbPath: process.env.DB_PATH ?? "/state/scheduler.db",
  // Public API, meant to be exposed (future website).
  publicPort: intEnv("PUBLIC_PORT", 3000),
  // Internal API used by Liquidsoap, must stay on the Docker network.
  internalPort: intEnv("INTERNAL_PORT", 3001),
  // Anti-repetition: no track replayed within the last N plays...
  recentTracks: intEnv("RECENT_TRACKS", 500),
  // ...and no composer replayed within the last K plays.
  recentArtists: intEnv("RECENT_ARTISTS", 3),
  // Periodic library rescan, in seconds (0 = only at startup / on demand).
  rescanIntervalS: intEnv("RESCAN_INTERVAL_S", 0),
};
