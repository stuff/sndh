# Liquidsoap: the radio engine (scheduling, crossfade, Opus encoding).
# The script is baked into the image rather than bind-mounted, so the
# deployment only needs the git repository.

FROM savonet/liquidsoap:v2.4.5
COPY radio.liq /radio/radio.liq
# Healthy only if Icecast actually serves our mount, i.e. the whole chain
# works. The image has no curl/wget, hence bash's /dev/tcp.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD ["bash", "-c", "exec 3<>/dev/tcp/${ICECAST_HOST:-icecast}/${ICECAST_PORT:-8000} && printf 'GET /status-json.xsl HTTP/1.0\\r\\n\\r\\n' >&3 && grep -q \"/${ICECAST_MOUNT:-atari-st.opus}\\\"\" <&3"]
CMD ["/radio/radio.liq"]
