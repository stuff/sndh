# Scheduler: indexes the Opus library and picks the next track for Liquidsoap.

FROM oven/bun:1.3.14-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json ./
COPY src ./src
# /state holds the SQLite database; create it owned by the unprivileged user
# so a fresh named volume inherits the right ownership.
RUN mkdir /state && chown bun:bun /state
USER bun
ENV MUSIC_DIR=/music DB_PATH=/state/scheduler.db PUBLIC_PORT=3000 INTERNAL_PORT=3001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["bun", "src/index.ts"]
