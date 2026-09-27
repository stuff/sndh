# Chiptune Radio web player

A single static page that plays the radio stream from [`server/`](../server/)
and shows the track currently playing. Plain HTML/CSS/JS, no build step,
served by an unprivileged nginx container. That nginx also proxies the stream
(`/*.opus` → Icecast) and the API (`/api/` → scheduler), so the page only uses
same-origin paths. It is deployed as the `web` service of
`server/docker-compose.yml`.

## Configuration

All optional; the defaults fit the `server/` compose stack.

| Variable | Default | What |
|---|---|---|
| `STREAM_URL` | `/atari-st.opus` | Stream URL used by the page |
| `API_URL` | *(same origin)* | Base URL of the scheduler API used by the page |
| `STREAM_DELAY_S` | `8` | How far listeners are behind the server, in seconds (see [CLAUDE.md](CLAUDE.md)) |
| `ICECAST_UPSTREAM` | `icecast:8000` | Where nginx proxies `/*.opus` |
| `API_UPSTREAM` | `scheduler:3000` | Where nginx proxies `/api/` |

The first three end up in `config.js` when the container starts; the last two
in the nginx config.

## Run locally

It is part of the `server/` stack: `docker compose up --build` in `server/`,
then open <http://localhost:8080>.

To run it alone against another server, point the page to absolute URLs:

```bash
docker build -t sndh-web .
docker run --rm -p 8080:8080 -e STREAM_URL=https://radio.example.com/atari-st.opus -e API_URL=https://radio.example.com sndh-web
```

## Deploy

With the rest of the radio, see [`server/README.md`](../server/README.md):
the `web` service is the one that gets the public domain.
