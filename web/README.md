# Chiptune Radio web player

A single static page that plays the radio stream from [`server/`](../server/)
and shows the track currently playing. Plain HTML/CSS/JS, no build step,
served by an unprivileged nginx container.

## Configuration

Three environment variables, turned into `config.js` when the container
starts:

| Variable | Default | What |
|---|---|---|
| `STREAM_URL` | `http://localhost:8000/atari-st.opus` | Icecast stream URL |
| `API_URL` | `http://localhost:3000` | Scheduler public API base URL |
| `STREAM_DELAY_S` | `8` | How far listeners are behind the server, in seconds (see below) |

## Run locally

With the `server/` stack running locally (`docker compose up` in `server/`):

```bash
docker build -t sndh-web .
docker run --rm -p 8080:8080 sndh-web
```

Then open <http://localhost:8080>. Since there is no build step, the
`public/` folder can also be served by any static file server while editing
(its `config.js` holds the same local defaults).

## Deploy on Coolify

1. Create a resource from the repository with the **Dockerfile** build pack,
   base directory `/web`, exposed port `8080`.
2. Set `STREAM_URL` (e.g. `https://chiptune-radio.stuffk.me/atari-st.opus`)
   and `API_URL` (e.g. `https://api-chiptune-radio.stuffk.me`).
3. Give it a domain and deploy.
