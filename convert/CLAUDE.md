# sndh2opus: SNDH → Opus conversion for streaming

## Goal

Batch-convert a large collection of SNDH files (Atari ST music, YM2149) into
normalized Opus files intended for streaming. The project ships as a single
Docker image; nothing is expected to be installed on the host. Usage is in
[README.md](README.md).

## Layout

- `Dockerfile`: multi-stage build (see its comments for the image-size tricks).
- `sndh2opus.sh`: user-facing wrapper; builds the image if missing, then runs it
  with `--user` and the current directory mounted at `/data`.
- `src/entrypoint.py`: container entrypoint, dispatches `fetch` / `convert`.
- `src/fetch_sndh_archive.py`: downloads a yearly SNDH zip and extracts it into `sndh_files/`.
- `src/sndh2opus.py`: the conversion pipeline.

All scripts are Python, stdlib only. They are copied into `/app` in the image
and run with `/data` (the host's mounted directory) as working directory.

## Pipeline (per sub-tune)

1. **Tags and durations** are always read with `psgplay --info` (TITL, COMM,
   YEAR, RIPP, FLAG, TIME/FRMS, sub-tune names), whichever renderer is used.
2. **Rendering** to a 48 kHz WAV:
   - `sc68` by default (better listening quality, ~2x faster). It ignores FRMS
     and can't write WAV to a pipe, so it loops forever as raw PCM on stdout
     and ffmpeg cuts it to the right duration.
   - `psgplay` is the automatic fallback if sc68 fails (and vice versa with
     `--renderer psgplay`). `--sc68-list` / `--psgplay-list` force a renderer
     for specific files.
3. **Normalization**: ffmpeg `ebur128` measurement, then a single linear gain
   toward -16 LUFS, capped so the sample peak stays ≤ -1.5 dBFS. Equivalent to
   `loudnorm` in linear mode but ~10x faster (no 192 kHz upsampling). A 5 Hz
   highpass removes the YM2149 DC offset. Silent tracks are left as is.
4. **Encoding**: `ffmpeg -c:a libopus`, VBR, Ogg container, `.opus` extension.
   48 kbps mono by default (most SNDH files are mono); `--stereo` switches to
   80 kbps with PSG channel spatialization.
5. **Tagging**: TITLE (TITL + sub-tune name or number), ALBUM, ARTIST (COMM),
   DATE, TRACKNUMBER/TRACKTOTAL, GENRE, HARDWARE (decoded from FLAG), COMMENT
   (source path, ripper, renderer).

## Behavior

- The source tree is reproduced in the output; one file per sub-tune
  (`name.opus`, or `name_NN.opus` when there are several).
- Missing duration: 180 s fallback with a 10 s fade-out (or `--skip-unknown`).
  Sub-tunes outside 90–240 s are skipped by default (`--min/--max-duration`).
- Idempotent: existing outputs are skipped unless `--force`. Files are written
  as `.part` then renamed, so an interrupted run never leaves a truncated file.
- Parallel conversions via a thread pool (`--jobs`, default: CPU count).
- Failures are logged (`<dest>/sndh2opus.log`) without stopping the batch.

## Container gotchas

- psgplay has no nixpkgs package: it is compiled in the `builder` stage.
- sc68 opens an audio device even when writing to stdout: `SDL_AUDIODRIVER=dummy`.
- The image runs as UID/GID 1000 by default, but `sndh2opus.sh` passes
  `--user "$(id -u):$(id -g)"` so outputs belong to the host user; any UID works.

## Useful psgplay options (double-check with `psgplay --help`)

- `-i, --info`: shows the SNDH tags (TITL, COMM, TIME…) then exits
- `-o, --output=<file>`: writes the output as WAVE
- `-t, --track=<num>`: selects the sub-tune
- `--length=<[mm:]ss.ss>`: forced playback duration
- `--psg-balance=<A:B:C>`: stereo spatialization, e.g. `-0.4:0:+0.4`
