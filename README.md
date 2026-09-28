# SNDH radio

A web radio that plays the [SNDH collection](https://sndh.atari.org/) of
Atari ST music (YM2149 chiptunes) nonstop. Everyone listening hears the same
stream, and a small web page shows what's playing.

**Listen: <https://chiptune-radio.stuffk.me/>**

## How it works

```
SNDH archive ──> convert ──> Opus library ──> server ──> web
 (.sndh files)   (Docker)    (one file per     (radio)    (player page)
                              sub-tune)
```

1. **[`convert/`](convert/)** downloads the SNDH archive and renders each
   sub-tune to an Ogg Opus file (48 kbps mono, normalized to -16 LUFS so the
   volume stays level between tracks). The composer folders from the archive
   are kept, and the metadata is stored in Vorbis comments.
2. **[`server/`](server/)** turns that library into a continuous radio. A
   scheduler picks the next track (random, with no quick repeats of a track or
   composer), Liquidsoap crossfades and encodes it, and Icecast sends it out
   as `/atari-st.opus`. The scheduler also has a JSON API for now-playing,
   history and listener count.
3. **[`web/`](web/)** is the player page: the stream, the current track, the
   recently played tracks and the listener count. Its nginx also proxies the
   stream and the API, so the whole radio runs on one domain.

Each folder is its own project with its own README (usage) and `CLAUDE.md`
(design notes).

## Quick start

You need [Docker](https://docs.docker.com/get-docker/).

```bash
# 1. Build the Opus library in data/ (the full archive takes a while)
mkdir -p data && cd data
../convert/sndh2opus.sh fetch https://sndh.atari.org/files/sndh2026_lf.zip
../convert/sndh2opus.sh convert sndh_files opus_files

# 2. Start the radio (it reads ../data/opus_files by default)
cd ../server
cp .env.example .env
docker compose up --build
```

Then open <http://localhost:8080>.

To deploy on a server (Coolify), see
[`server/README.md`](server/README.md#deploy-on-coolify).

## Repository layout

| Folder | What |
|---|---|
| [`convert/`](convert/) | SNDH → Opus conversion (Docker image + `sndh2opus.sh` wrapper) |
| [`server/`](server/) | Scheduler (Bun/TypeScript), Liquidsoap, Icecast, and the `docker-compose.yml` for the whole radio |
| [`web/`](web/) | Static player page (plain HTML/CSS/JS) served by nginx |
| `data/` | Generated audio (archive, Opus files). Not versioned |

## Credits

The music comes from the [SNDH archive](https://sndh.atari.org/), maintained
by the Atari ST community. All tunes belong to their composers.
