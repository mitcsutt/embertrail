# The Dashboard on nginx, built from the repository root (compose.yaml's `dashboard` service):
#   docker build -f apps/dashboard/Dockerfile -t embertrail-dashboard .
# docs/self-hosting.md#the-dashboard says how it reaches the Hub.

FROM node:24-slim AS build
ENV CI=true LEFTHOOK=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @mitcsutt/embertrail-dashboard... \
 && pnpm --filter @mitcsutt/embertrail-dashboard build

FROM nginxinc/nginx-unprivileged:alpine
# The envsubst step fills the template in from these; compose.yaml passes its own values.
ENV EMBERTRAIL_HUB_UPSTREAM=http://hub:8787 \
    EMBERTRAIL_DASHBOARD_TOKEN= \
    EMBERTRAIL_DASHBOARD_HOSTS= \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY --from=build /repo/apps/dashboard/dist /usr/share/nginx/html
COPY apps/dashboard/docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 apps/dashboard/docker/15-dashboard-hosts.envsh /docker-entrypoint.d/15-dashboard-hosts.envsh
EXPOSE 8080
# Probes every 2 s while nginx starts (start-interval), then every 30 s.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --start-interval=2s --retries=3 \
  CMD ["wget", "--quiet", "--spider", "http://127.0.0.1:8080/config.json"]
