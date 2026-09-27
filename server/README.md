# SNDH radio server

A continuous web radio playing the Opus files produced by
[`convert/`](../convert/). Four containers:

- **scheduler** (Bun/TypeScript): indexes the library, picks the next track,
  serves a JSON API (now playing, history).
- **liquidsoap**: plays what the scheduler picks, crossfades, encodes to Opus.
- **icecast**: streams the result to listeners.
- **web**: the player page, built from [`../web`](../web/). Its nginx also
  proxies the stream and the API, so everything is served from one domain.

See [CLAUDE.md](CLAUDE.md) for the design and its pitfalls.

## Endpoints

All on the `web` service's domain:

| Path | What |
|---|---|
| `/` | The player page |
| `/atari-st.opus` | The audio stream (Ogg Opus, mono), proxied to Icecast |
| `/api/now-playing` | Current track and when it started |
| `/api/history?limit=20` | Last tracks played |
| `/api/health` | Status and library counts |

## Run locally

Prerequisite: Docker, and the Opus library (by default `../data/opus_files`).

```bash
cp .env.example .env
docker compose up --build
```

Then open the player at <http://localhost:8080>, or listen to
<http://localhost:8080/atari-st.opus> with `ffplay`/`mpv`. For debugging, the
override file also publishes Icecast (`:8000`) and the scheduler API
(`:3000`) directly. On the first
start the scheduler indexes the library (~45 s); a random fallback playlist
plays meanwhile.

Scheduler tests (needs [Bun](https://bun.sh)):

```bash
cd scheduler && bun install && bun test
```

## Deploy on Coolify

1. **Put the code in a git repository** Coolify can reach (the `sndh/` folder
   is not one yet).
2. **Copy the library to the server** once, e.g.:

   ```bash
   rsync -av --delete data/opus_files/ user@server:/srv/sndh/opus_files/
   ```

   The files must be readable by the containers (they run as non-root users):
   `chmod -R a+rX /srv/sndh/opus_files`.
3. In Coolify, create a **Docker Compose** resource from the repository, with
   base directory `/server` and compose file `docker-compose.yml`.
4. Set the environment variables (see [`.env.example`](.env.example)), at
   least `ICECAST_SOURCE_PASSWORD`, `ICECAST_ADMIN_PASSWORD` and
   `ICECAST_HOSTNAME`. `MUSIC_HOST_DIR` defaults to `/srv/sndh/opus_files`.
   Generate the passwords with `openssl rand -hex 24`: Coolify may escape
   quotes or `$` in values, so the two containers can end up with different
   passwords (Liquidsoap then gets `401, Authentication Required`).
5. Assign a domain to the `web` service only, e.g.
   `https://radio.example.com:8080` (the `:8080` tells Coolify which container
   port to route to). Leave `icecast`, `scheduler` and `liquidsoap` without a
   domain: they are reached through `web`.
6. Deploy. The page is at `https://radio.example.com`, the stream at
   `https://radio.example.com/atari-st.opus`.

To add new tracks later, rsync the new files, then either restart the
scheduler or trigger a rescan from inside the network:

```bash
docker compose exec scheduler wget -qO- --post-data= http://127.0.0.1:3001/internal/rescan
```

(or set `RESCAN_INTERVAL_S` to rescan periodically).

## Configuration

All settings are environment variables, documented in
[`.env.example`](.env.example): stream bitrate, crossfade duration,
anti-repetition windows, Icecast passwords and listener limit.
