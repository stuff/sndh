# Web player for the SNDH radio, served by an unprivileged nginx that also
# proxies the stream and the API from the other containers, so the whole
# radio lives on a single domain.

FROM nginxinc/nginx-unprivileged:1.30-alpine
# Proxy targets (Docker service names), and have the entrypoint export the
# container's DNS resolver as NGINX_LOCAL_RESOLVERS for the template.
ENV ICECAST_UPSTREAM=icecast:8000 \
    API_UPSTREAM=scheduler:3000 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY templates/ /etc/nginx/templates/
COPY --chown=nginx:nginx public/ /usr/share/nginx/html/
COPY --chmod=755 docker/40-radio-config.sh /docker-entrypoint.d/
# config.js is rewritten at startup by the (non-root) nginx user.
USER root
RUN chown nginx:nginx /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
