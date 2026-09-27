# Liquidsoap: the radio engine (scheduling, crossfade, Opus encoding).
# The script is baked into the image rather than bind-mounted, so the
# deployment only needs the git repository.

FROM savonet/liquidsoap:v2.4.5
COPY radio.liq /radio/radio.liq
CMD ["/radio/radio.liq"]
