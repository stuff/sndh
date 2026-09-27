# server: the SNDH radio

## Goal

Stream the Opus library produced by [`convert/`](../convert/) as a single,
continuous web radio that every listener hears in sync. V1 picks tracks at
random; later, the website will let users vote and blacklist tracks, which
will feed the same picking logic. Deployed on Coolify as one docker-compose
resource. Usage and deployment steps are in [README.md](README.md).

## Layout

- `docker-compose.yml`: the services below, plus `web`, built from
  [`../web`](../web/): the player page, whose nginx is also the only public
  entry point (it proxies `/*.opus` to Icecast and `/api/` to the scheduler's
  public port). `docker-compose.override.yml` publishes ports for local use
  only (Coolify does not read it).
- `scheduler/`: Bun + TypeScript service, stdlib + `music-metadata` only.
  - `src/indexer.ts`: scans `/music`, reads the Vorbis comments and the
    duration into SQLite. Incremental (mtime + size), and flags vanished files
    as `missing` instead of deleting them, so their history survives.
  - `src/picker.ts`: pure next-track choice (weighted random, anti-repeat).
  - `src/station.ts`: glues DB + picker; tracks pending picks vs actual plays.
  - `src/index.ts`: the two HTTP servers (see API below).
- `liquidsoap/radio.liq`: the radio engine script, baked into the image.
- `icecast/`: Alpine + Icecast, config generated from env at startup. It
  adds `Access-Control-Allow-Origin: *` so web pages on other domains can
  also read the stream with `fetch`/Web Audio, not just an `<audio>` tag.

## Data flow

1. Liquidsoap's `request.dynamic` calls `GET scheduler:3001/internal/next`,
   which returns a path relative to `/music` as plain text.
2. When a track actually starts (with crossfade, at the start of the
   transition), Liquidsoap `POST`s its absolute path to `/internal/started`.
   This, not `/next`, is what feeds now-playing and history: Liquidsoap
   prefetches, so a pick is not a play yet. Picks not started yet stay in an
   in-memory "pending" list that counts for anti-repetition.
3. Liquidsoap crossfades, encodes to Ogg Opus and sends it to Icecast, which
   fans it out to listeners at `/atari-st.opus` (through the `web` proxy).

If the scheduler is down, returns 503 (first run, initial indexing in
progress) or has no playable track, Liquidsoap falls back to a random
playlist of `/music`, and returns to the scheduler at the next track. If
everything fails, `mksafe` streams silence rather than stopping.

## API

- Public (`:3000`, reached through the `web` proxy, CORS `*`): `GET /api/health`,
  `GET /api/now-playing`, `GET /api/history?limit=N` (max 100),
  `GET /api/listeners` (`{listeners: n}`, `null` if Icecast is down or the
  mount is not live). The count comes from Icecast's `status-json.xsl`
  (`src/icecast.ts`), cached 5 s so visitors' polls cost Icecast little. Tracks are
  serialized by `toPublic()` in `station.ts`.
- Internal (`:3001`, Docker network only, never give it a domain):
  `GET /internal/next`, `POST /internal/started` (body: file path),
  `POST /internal/rescan`.

## Picking rules

Weighted random over tracks that are neither `missing` nor `blacklisted`,
excluding the last `RECENT_TRACKS` plays (capped at half the library) and the
composers (ARTIST tag) of the last `RECENT_ARTISTS` plays. Rules are relaxed
step by step if they leave nothing. `weight` (default 1) and `blacklisted`
already exist in the schema for the upcoming votes/blacklist features: they
only need to be written, the picker already honors them.

## Audio choices

- Stream: Ogg Opus, mono, 64 kbps by default (`OPUS_BITRATE`), 3 s crossfade
  (`CROSSFADE_S`). No normalization in Liquidsoap: `convert` already
  normalized everything to -16 LUFS.
- Re-encoding is unavoidable (joining separate Ogg files into one continuous
  stream, crossfades). The sources are 48 kbps Opus, so this is a second lossy
  generation; the stream bitrate is a bit higher to limit the loss. Switching
  `convert` to FLAC output would remove it, at ~5x the disk space. That was
  considered and deliberately not done for now.
- Decoding + encoding happens once, whatever the listener count: Liquidsoap
  uses ~2% of a core.

## Gotchas

- **Metadata is dropped before the encoder** (`source.drop.metadata`). The
  Ogg encoder starts a new chained logical stream on every metadata change,
  and Chrome stops playing at such a boundary. The stream therefore has a
  single Ogg serial from start to end; now-playing comes from the API.
- **`settings.frame.audio.channels := 1` is required.** Without it, the
  crossfade transition builds a stereo source that does not match the mono
  stream, and Liquidsoap crashes at runtime on the first track change (not at
  `--check` time).
- `on_track` is attached before `crossfade`, so it fires when the transition
  starts, i.e. when the new track becomes audible.
- The host folder variable is `MUSIC_HOST_DIR`, not `MUSIC_DIR`: the latter
  is the in-container path (`/music`) read by the scheduler and the script.
- Liquidsoap's `http.get` does not raise when the scheduler is down: it
  returns status 523 ("no track (HTTP 523)" in the logs).
- Tracks played by the fallback while the scheduler is down are not in the
  history (nobody to report them to).
- Coolify only accepts `${VAR}`, `${VAR}/path` or `${VAR:-default}` as a
  volume source (anything else, e.g. `${VAR:?message}`, is rejected as a
  possible shell injection). Hence the `/srv/sndh/opus_files` default for
  `MUSIC_HOST_DIR` instead of making it required.
- Icecast 2.4 answers `400` to `HEAD` requests on mounts; use `GET`.
- On the very first run the index is empty, so the scheduler answers 503 until
  the initial scan finishes (~45 s for ~3,900 files); later restarts only
  re-parse changed files.
