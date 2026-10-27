# The Hub on the Docker Platform (apps/server) with the `embertrail` CLI beside it.
# Build from the repository root: `docker build -t embertrail .` (docs/self-hosting.md).

FROM node:24-slim AS build
ENV CI=true LEFTHOOK=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
      --filter @mitcsutt/embertrail-server... --filter @mitcsutt/embertrail-cli... \
 && pnpm --filter @mitcsutt/embertrail-server build \
 && pnpm --filter @mitcsutt/embertrail-cli build \
 && mkdir /out \
 && cp apps/server/dist/server.js /out/server.js \
 && cp packages/cli/dist/bin.js /out/embertrail.js \
 && cp docker-entrypoint.sh /out/docker-entrypoint.sh \
 && printf '{"type":"module","private":true,"dependencies":{"pg":"%s"}}' \
      "$(cd apps/server && node -p "require('pg/package.json').version")" > /out/package.json

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/ ./
RUN npm install --omit=dev --no-audit --no-fund \
 && chmod +x docker-entrypoint.sh embertrail.js \
 && ln -s /app/embertrail.js /usr/local/bin/embertrail
USER node
EXPOSE 8787
# bash is in the image and curl isn't: a /dev/tcp GET costs a shell, where `node -e` cost a Node boot.
# Probes every 2 s while the Hub starts (start-interval), then every 30 s.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --start-interval=2s --retries=3 \
  CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/${PORT:-8787} && printf 'GET /api/v1/health HTTP/1.0\\r\\n\\r\\n' >&3 && read -r status <&3 && [[ $status == *' 200 '* ]]"]
ENTRYPOINT ["/app/docker-entrypoint.sh"]
