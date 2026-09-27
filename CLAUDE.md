# sndh: Atari ST chiptune streaming

Umbrella folder for several independent projects that together stream the
SNDH collection (Atari ST music) online. Each project has its own `CLAUDE.md`
with its details; this file only covers what ties them together.

## Projects

| Folder | Role | Status |
|---|---|---|
| [`convert/`](convert/) | Docker image that fetches the SNDH archive and converts it to normalized Opus files | done |
| [`server/`](server/) | Web radio (scheduler + Liquidsoap + Icecast) fed by `convert`'s output | V1 done (random playlist) |
| [`web/`](web/) | Web player: the stream + current track info | V1 done (minimal player) |

Data flow: SNDH archive → `convert` → Opus files → `server` → `web`.

## Contract between projects

`convert`'s output is what `server` consumes, so changes to it must be
reflected on both sides:

- One `.opus` file (Ogg Opus) per sub-tune, 48 kbps mono by default,
  loudness-normalized to -16 LUFS, so tracks can be chained without volume jumps.
- The SNDH folder tree is mirrored (one folder per composer), with files named
  `name.opus`, or `name_NN.opus` when an SNDH has several sub-tunes.
- Metadata lives in the Vorbis comments: TITLE, ALBUM, ARTIST, DATE,
  TRACKNUMBER, TRACKTOTAL, GENRE, HARDWARE, COMMENT (see `convert/CLAUDE.md`).
- Generated audio lives outside the project folders, which only hold code.

`server` exposes what `web` consumes (see `server/CLAUDE.md`). Both are
deployed together by `server/docker-compose.yml`: `web`'s nginx proxies the
stream and the API, so the page uses same-origin paths.

- The stream: `/atari-st.opus` on Icecast, one continuous Ogg Opus stream
  without in-stream metadata, with `Access-Control-Allow-Origin: *`.
- Now-playing and history: JSON from the scheduler's public API
  (`/api/now-playing`, `/api/history`, `/api/health`). Future votes and
  blacklist endpoints will live there too.

## Conventions

- Code, comments and docs are written in English.
- Each project is self-contained: its own Dockerfile/build and README.
