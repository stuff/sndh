// Scheduler entrypoint: indexes the library, then serves two HTTP APIs.
//
// - public (PUBLIC_PORT): read-only JSON for the website, CORS enabled.
// - internal (INTERNAL_PORT): used by Liquidsoap to get the next track and to
//   report track starts. Never exposed outside the Docker network.

import { config } from "./config";
import { openDb } from "./db";
import { createListenerCounter } from "./icecast";
import { scanLibrary } from "./indexer";
import { Station, toPublic } from "./station";

const db = openDb(config.dbPath);
const station = new Station(db, config);
const countListeners = createListenerCounter(config.icecastUrl, config.icecastMount);

let scanning: Promise<void> | null = null;
// On a first run (empty index), picks would be biased towards the files
// indexed first (alphabetical order), so the scheduler stays out of the way
// until the initial scan completes; Liquidsoap plays its fallback meanwhile.
let ready = station.stats().tracks > 0;

function rescan(): Promise<void> {
  scanning ??= scanLibrary(db, config.musicDir)
    .then((r) =>
      console.log(
        `indexer: ${r.total} files, ${r.parsed} parsed, ${r.failed} failed, ` +
          `${r.missing} missing, in ${r.durationMs} ms`,
      ),
    )
    .catch((err) => console.error(`indexer: scan failed: ${err}`))
    .finally(() => {
      scanning = null;
      ready = true;
    });
  return scanning;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS });
}

Bun.serve({
  port: config.publicPort,
  routes: {
    "/api/health": () => json({ status: "ok", indexing: scanning !== null, ...station.stats() }),
    "/api/now-playing": () => json(station.nowPlaying()),
    "/api/history": (req) => {
      const raw = Number.parseInt(new URL(req.url).searchParams.get("limit") ?? "20", 10);
      const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 100) : 20;
      return json(station.history(limit));
    },
    // null when Icecast is unreachable or the mount is not live.
    "/api/listeners": async () => json({ listeners: await countListeners() }),
  },
  fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    return json({ error: "not found" }, 404);
  },
});

Bun.serve({
  port: config.internalPort,
  routes: {
    // Plain-text path relative to the music root, so Liquidsoap needs no
    // JSON parsing. 503 lets Liquidsoap fall back to its own random playlist.
    "/internal/next": () => {
      if (!ready) return new Response("initial indexing in progress\n", { status: 503 });
      const track = station.next();
      if (!track) return new Response("no playable track\n", { status: 503 });
      return new Response(track.path);
    },
    "/internal/started": {
      POST: async (req) => {
        const path = (await req.text()).trim();
        const track = station.started(path);
        if (!track) {
          console.warn(`station: started unknown file "${path}"`);
          return new Response("unknown file\n", { status: 404 });
        }
        console.log(`station: now playing ${track.path}`);
        return Response.json(toPublic(track));
      },
    },
    "/internal/rescan": {
      POST: () => {
        void rescan();
        return new Response("rescan started\n", { status: 202 });
      },
    },
  },
  fetch: () => new Response("not found\n", { status: 404 }),
});

console.log(
  `scheduler: music in ${config.musicDir}, public API on :${config.publicPort}, ` +
    `internal API on :${config.internalPort}`,
);

void rescan();
if (config.rescanIntervalS > 0) setInterval(() => void rescan(), config.rescanIntervalS * 1000);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    db.close();
    process.exit(0);
  });
}
