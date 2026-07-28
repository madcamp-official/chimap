FROM node:24.18.0-alpine AS builder

RUN npm install --global pnpm@10.15.1

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/alert-relay/package.json apps/alert-relay/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY bus_icon.webp bus_icon.webp

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY apps/alert-relay apps/alert-relay
COPY apps/web apps/web
COPY packages/contracts packages/contracts
COPY data/subway_geometry_sources.json data/subway_geometry_sources.json
COPY data/subway_segment_shapes.geojson data/subway_segment_shapes.geojson
COPY data/subway_segment_shapes.report.json data/subway_segment_shapes.report.json
COPY data/subway_segment_shapes.LICENSE.md data/subway_segment_shapes.LICENSE.md

ARG NAVER_MAP_BROWSER_CLIENT_ID=""

RUN pnpm --filter @chimap/contracts build \
  && pnpm --filter @chimap/api build \
  && pnpm --filter @chimap/alert-relay build \
  && VITE_NAVER_MAP_NCP_KEY_ID="${NAVER_MAP_BROWSER_CLIENT_ID}" \
    pnpm --filter @chimap/web build \
  && pnpm --filter @chimap/api deploy --prod --legacy /prod/api

FROM node:24.18.0-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    WEB_ORIGIN=https://chimap.madcamp-kaist.org \
    WEB_DIST_PATH=/app/web \
    LOG_LEVEL=info

WORKDIR /app

COPY --from=builder --chown=node:node /prod/api ./
COPY --from=builder --chown=node:node /workspace/apps/alert-relay/dist /app/alert-relay
COPY --from=builder --chown=node:node /workspace/apps/web/dist /app/web

USER node

EXPOSE 3000 9091

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
