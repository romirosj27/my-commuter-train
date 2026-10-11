# One image recipe for the API and the worker:
#   docker build --build-arg APP=api    -t mct-api .
#   docker build --build-arg APP=worker -t mct-worker .
# TypeScript runs directly via tsx (no separate compile step).

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS build
ARG APP
RUN test -n "$APP" || (echo "Pass --build-arg APP=api|worker" && false)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/email/package.json packages/email/package.json
RUN pnpm install --frozen-lockfile --prod --filter "@mct/${APP}..."
COPY packages packages
COPY apps/${APP} apps/${APP}
# Mock feed fixtures (the worker can run entirely on mock data).
COPY fixtures fixtures

FROM base AS runtime
ARG APP
ENV APP=${APP}
COPY --from=build --chown=node:node /app /app
# Each app runs from its own directory, where its dependencies (incl. tsx) resolve.
WORKDIR /app/apps/${APP}
USER node
# api: 8080 (HTTP); worker: 8081 (health only)
EXPOSE 8080 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.APP==='api'?(process.env.API_PORT||8080):(process.env.WORKER_HEALTH_PORT||8081))+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "if [ \"$APP\" = api ]; then exec node --import tsx src/server.ts; else exec node --import tsx src/main.ts; fi"]
