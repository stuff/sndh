# sndh2opus

Batch-converts a collection of SNDH files (Atari ST music, YM2149) into
normalized Opus (`.ogg`/`.opus`) files suitable for streaming. See
[CLAUDE.md](CLAUDE.md) for the design decisions behind the pipeline.

## Prerequisites

Only [Docker](https://docs.docker.com/get-docker/) — the image bundles
Python, psgplay, sc68 and ffmpeg, so nothing else needs to be installed on the
host.

## Usage

Everything goes through the [`sndh2opus.sh`](sndh2opus.sh) wrapper script
(bash, so Linux, macOS or WSL). It builds the Docker image on first use, then
runs it on the **current directory**: paths given to it are relative to where
you run it from, and files it writes belong to your user.

The script can be called from anywhere, e.g. `~/repos/sndh/convert/sndh2opus.sh`,
or symlinked into your `PATH`:

```bash
ln -s "$PWD/sndh2opus.sh" ~/.local/bin/sndh2opus
```

After modifying the code, rebuild the image with:

```bash
./sndh2opus.sh build
```

## 1. Fetch the SNDH files

The [SNDH archive](https://sndh.atari.org/) publishes a yearly zip of its full
collection at a URL like:

```
https://sndh.atari.org/files/sndh<YEAR>_lf.zip
```

for example `https://sndh.atari.org/files/sndh2026_lf.zip`. Download and
extract it into the current directory with:

```bash
sndh2opus.sh fetch https://sndh.atari.org/files/sndh2026_lf.zip
```

This downloads the zip into the current directory (skipped on a later run if
it's already present) and extracts its contents into a `sndh_files/` folder,
with one subfolder per composer (`sndh_files/Mad_Max/...`, etc.).

## 2. Convert SNDH files to Opus

Pass the source folder (`sndh_files`) and the destination folder
(`opus_file`), both relative to the current directory:

```bash
sndh2opus.sh convert sndh_files opus_file
```

This recursively converts every SNDH file under `sndh_files/` into one Opus
file per sub-tune under `opus_file/`, reproducing the source folder structure.
The conversion is idempotent: rerunning the same command skips files already
present in `opus_file/`, so you can safely re-run it after fetching a newer
SNDH archive.

### Useful options

Anything after `convert <src> <dest>` is forwarded to [`src/sndh2opus.py`](src/sndh2opus.py), so any of
its flags can be added, for example:

```bash
# Stereo output, 8 parallel jobs, see what would be converted first
sndh2opus.sh convert sndh_files opus_file --stereo --jobs 8 --dry-run
```

See the full list of options with:

```bash
sndh2opus.sh convert --help
```

## Running Docker directly

Without the script (e.g. on Windows outside WSL), the equivalent commands are:

```bash
docker build -t sndh2opus .
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/data sndh2opus convert sndh_files opus_file
```

`--user` makes the files the container writes belong to your user. Without
it, the container runs as UID/GID 1000:1000, which is only right if that's
your user's UID/GID (the first user on most Linux distros). On macOS and
Windows with Docker Desktop, file ownership in the mounted folder is mapped to
your user either way.
