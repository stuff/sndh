#!/usr/bin/env python3
"""Download a yearly SNDH archive and extract it into sndh_files/.

Both the archive and sndh_files/ are created in the current directory, so run
this from wherever you want them (the project root on a plain host checkout,
or /data inside the Docker image).

Usage: fetch_sndh_archive.py <url>
Example: fetch_sndh_archive.py https://sndh.atari.org/files/sndh2026_lf.zip
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

WORK_DIR = Path.cwd()
DEST_DIR = WORK_DIR / "sndh_files"
URL_PATTERN = re.compile(r"^https://sndh\.atari\.org/files/sndh\d{4}_lf\.zip$")
CHUNK_SIZE = 1 << 20  # 1 MiB


def download(url: str, dest: Path) -> None:
    if dest.exists():
        print(f"Archive already downloaded: {dest}")
        return

    part = dest.with_name(dest.name + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "sndh2opus/1.0"})
    try:
        with urllib.request.urlopen(req) as resp, open(part, "wb") as f:
            total = int(resp.headers.get("Content-Length", 0))
            written = 0
            while chunk := resp.read(CHUNK_SIZE):
                f.write(chunk)
                written += len(chunk)
                if total:
                    print(f"\rDownloading {url} ... {written * 100 // total}%",
                          end="", flush=True)
    except (urllib.error.URLError, TimeoutError) as e:
        part.unlink(missing_ok=True)
        sys.exit(f"Download failed: {e}")
    print()
    part.replace(dest)  # atomic: no truncated archive left on failure
    print(f"Saved to {dest}")


def extract(archive: Path, dest_dir: Path) -> None:
    if not zipfile.is_zipfile(archive):
        sys.exit(f"Not a valid zip file: {archive}")
    dest_dir.mkdir(parents=True, exist_ok=True)
    print(f"Extracting {archive.name} into {dest_dir} ...")
    with zipfile.ZipFile(archive) as zf:
        names = zf.namelist()
        # The archive wraps everything in a single top-level folder (e.g. "sndh_lf/"):
        # strip it so dest_dir directly holds the composer folders, not one level deeper.
        tops = {n.split("/", 1)[0] for n in names}
        prefix = f"{tops.pop()}/" if len(tops) == 1 else ""
        for name in names:
            rel = name[len(prefix):] if prefix else name
            if not rel or name.endswith("/"):
                continue
            target = dest_dir / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(name) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)
    print("Done.")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    p.add_argument("url", help="SNDH archive URL, e.g. "
                               "https://sndh.atari.org/files/sndh2026_lf.zip")
    args = p.parse_args(argv)

    if not URL_PATTERN.match(args.url):
        print(f"Warning: URL doesn't match the expected "
              f"sndh.atari.org/files/sndh<year>_lf.zip pattern, continuing anyway.",
              file=sys.stderr)

    archive_path = WORK_DIR / args.url.rsplit("/", 1)[-1]
    download(args.url, archive_path)
    extract(archive_path, DEST_DIR)
    return 0


if __name__ == "__main__":
    sys.exit(main())
