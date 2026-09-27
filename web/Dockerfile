# Static web player for the SNDH radio, served by an unprivileged nginx.
# The stream and API URLs are injected at startup from the environment.

FROM nginxinc/nginx-unprivileged:1.30-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=nginx:nginx public/ /usr/share/nginx/html/
COPY --chmod=755 docker/40-radio-config.sh /docker-entrypoint.d/
# config.js is rewritten at startup by the (non-root) nginx user.
USER root
RUN chown nginx:nginx /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
