FROM node:24.18.0-alpine AS builder

RUN npm install --global pnpm@10.15.1

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY apps/web apps/web
COPY packages/contracts packages/contracts

ARG VITE_NAVER_MAP_NCP_KEY_ID=""
ENV VITE_NAVER_MAP_NCP_KEY_ID=${VITE_NAVER_MAP_NCP_KEY_ID}

RUN pnpm --filter @chimap/contracts build \
  && pnpm --filter @chimap/api build \
  && pnpm --filter @chimap/web build \
  && pnpm --filter @chimap/api deploy --prod --legacy /prod/api

FROM node:24.18.0-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    WEB_ORIGIN=https://chimap.madcamp-kaist.org \
    WEB_DIST_PATH=/app/web \
    LOG_LEVEL=info

WORKDIR /app

COPY --from=builder --chown=node:node /prod/api ./
COPY --from=builder --chown=node:node /workspace/apps/web/dist /app/web

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
