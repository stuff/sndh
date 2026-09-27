# Icecast: fans the single Opus stream produced by Liquidsoap out to listeners.
# The config is generated at startup from environment variables (see
# entrypoint.sh), so passwords never end up in the image.

FROM alpine:3.22
RUN apk add --no-cache icecast mailcap
COPY --chmod=755 entrypoint.sh /entrypoint.sh
USER icecast
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:8000/status-json.xsl || exit 1
ENTRYPOINT ["/entrypoint.sh"]
