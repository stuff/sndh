#!/usr/bin/env python3
"""Dispatches the container's entrypoint to the fetch or convert script.

Usage:
    fetch <url>            download and extract a yearly SNDH archive
    convert <src> <dest>   convert SNDH files to Opus (see 'convert --help')
"""

import runpy
import sys

COMMANDS = {
    "fetch": "/app/fetch_sndh_archive.py",
    "convert": "/app/sndh2opus.py",
}


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit(
            "Usage: docker run ... sndh2opus <command> [args...]\n"
            "\n"
            "Commands:\n"
            "  fetch <url>            download and extract a yearly SNDH archive\n"
            "  convert <src> <dest>   convert SNDH files to Opus (see 'convert --help')"
        )
    script = COMMANDS[sys.argv[1]]
    sys.argv = [script, *sys.argv[2:]]
    runpy.run_path(script, run_name="__main__")


if __name__ == "__main__":
    main()
