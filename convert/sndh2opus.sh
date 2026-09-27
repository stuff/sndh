#!/usr/bin/env bash
# Wrapper around the sndh2opus Docker image: builds it if needed, then runs it
# as the current user with the current directory mounted at /data.
#
# Usage:
#   sndh2opus.sh build                   (re)build the image
#   sndh2opus.sh fetch <url>             download and extract a yearly SNDH archive
#   sndh2opus.sh convert <src> <dest>    convert SNDH files to Opus (see 'convert --help')
#
# Paths are relative to the current directory: only that directory is visible
# to the container. The script can be called from anywhere (or symlinked into
# your PATH).

set -euo pipefail

IMAGE=sndh2opus
PROJECT_DIR=$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")

build() {
    docker build -t "$IMAGE" "$PROJECT_DIR"
}

case "${1:-}" in
    build)
        build
        exit
        ;;
    fetch | convert) ;;
    *)
        sed -n '5,8s/^# \{0,1\}//p' "${BASH_SOURCE[0]}" >&2
        exit 1
        ;;
esac

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "Image '$IMAGE' not found, building it (only needed once)..." >&2
    build
fi

# -it only when attached to a terminal, so the script also works in pipes/cron.
tty_flags=()
if [ -t 0 ] && [ -t 1 ]; then
    tty_flags=(-it)
fi

# The ${a[@]+...} form keeps bash 3.2 (macOS default) happy with an empty array under set -u.
exec docker run --rm ${tty_flags[@]+"${tty_flags[@]}"} \
    --user "$(id -u):$(id -g)" \
    -v "$PWD":/data \
    "$IMAGE" "$@"
