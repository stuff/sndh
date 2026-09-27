# SNDH radio server

A continuous web radio playing the Opus files produced by
[`convert/`](../convert/). Three containers:

- **scheduler** (Bun/TypeScript): indexes the library, picks the next track,
  serves a JSON API (now playing, history).
- **liquidsoap**: plays what the scheduler picks, crossfades, encodes to Opus.
- **icecast**: streams the result to listeners.

See [CLAUDE.md](CLAUDE.md) for the design and its pitfalls.

## Endpoints

| URL | What |
|---|---|
| `http://<icecast>:8000/radio.opus` | The audio stream (Ogg Opus, mono) |
| `http://<scheduler>:3000/api/now-playing` | Current track and when it started |
| `http://<scheduler>:3000/api/history?limit=20` | Last tracks played |
| `http://<scheduler>:3000/api/health` | Status and library counts |

## Run locally

Prerequisite: Docker, and the Opus library (by default `../data/opus_files`).

```bash
cp .env.example .env
docker compose up --build
```

Then listen to <http://localhost:8000/radio.opus> in a browser or with
`ffplay`/`mpv`, and check <http://localhost:3000/api/now-playing>. On the first
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
5. Assign domains: `icecast` → e.g. `https://radio.example.com:8000`
   (the `:8000` tells Coolify which container port to route to), and
   `scheduler` → e.g. `https://api.radio.example.com:3000`. Do not expose
   `liquidsoap` or the scheduler's port 3001.
6. Deploy. The stream is at `https://radio.example.com/radio.opus`.

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
