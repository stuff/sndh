# web: the radio's web player

## Goal

A minimal public page: one play/stop button, a volume slider and the current
track's info. Deliberately no framework and no build step. Usage and
deployment are in [README.md](README.md).

## Layout

- `public/`: the site (`index.html`, `style.css`, `app.js`, `favicon.svg`,
  and `config.js` with local defaults).
- `docker/40-radio-config.sh`: run by the nginx image's entrypoint (every
  script in `/docker-entrypoint.d` is); rewrites `config.js` from
  `STREAM_URL`, `API_URL`, `STREAM_DELAY_S`, escaping the strings.
- `templates/default.conf.template`: nginx config, rendered by the image's
  envsubst step. Static serving on 8080 (`no-cache` revalidation), `/healthz`,
  and the reverse proxy: `/*.opus` → `ICECAST_UPSTREAM` (unbuffered, it's an
  endless stream), `/api/` → `API_UPSTREAM`. Upstreams go through variables +
  `resolver` (Docker DNS, exported by the image as `NGINX_LOCAL_RESOLVERS`),
  so nginx starts even if they don't resolve yet; requests then get a 502.
- `Dockerfile`: `nginxinc/nginx-unprivileged`; the html folder is owned by
  the nginx user so the startup script can write `config.js`.

## How the page works

- Play sets the `<audio>` source to the stream with a cache-busting query, so
  every start joins the live edge. Stop removes the source (a paused live
  stream would otherwise resume behind live). If the stream ends (server
  restart), it reconnects after 2 s.
- Track info comes from `GET {API_URL}/api/history?limit=2` every 10 s; the
  progress bar is computed locally from `started_at` and `duration_s`.
- **Listener lag**: listeners hear the stream several seconds after the
  server plays it (Icecast's 64 KB burst-on-connect is ~8 s at 64 kbps). While
  playing, the page applies `STREAM_DELAY_S` to `started_at`, which is why it
  fetches the previous play too: the old track stays displayed until the new
  one is actually audible. When stopped, it shows the server's real time.
- Media Session metadata is set so the track shows on lock screens and in
  OS media controls.
- Browsers that cannot play Ogg Opus get a notice
  (`canPlayType('audio/ogg; codecs="opus"')`).

## Contract with server/

The container is the `web` service of `server/docker-compose.yml` and the
radio's only public entry point. The page depends only on the endpoints
documented in the root `CLAUDE.md` (the stream and `/api/history`), through
same-origin paths by default. Both also send `Access-Control-Allow-Origin: *`,
so the page could be hosted elsewhere with absolute `STREAM_URL`/`API_URL`.
