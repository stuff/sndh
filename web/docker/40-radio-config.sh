#!/bin/sh
# Regenerates config.js from the environment at container start (run by the
# nginx image's entrypoint, like every script in /docker-entrypoint.d).
set -eu

# Escapes a value for use inside a double-quoted JavaScript string.
js_string() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

delay="${STREAM_DELAY_S:-8}"
case "$delay" in
  ''|*[!0-9.]*) echo "STREAM_DELAY_S must be a number, got '$delay'" >&2; exit 1 ;;
esac

cat > /usr/share/nginx/html/config.js <<JS
window.RADIO_CONFIG = {
  streamUrl: "$(js_string "${STREAM_URL:-/atari-st.opus}")",
  apiUrl: "$(js_string "${API_URL:-}")",
  streamDelayS: ${delay},
};
JS
echo "radio config: stream ${STREAM_URL:-/atari-st.opus}, api ${API_URL:-<same origin>}"
