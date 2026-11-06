# syntax=docker/dockerfile:1.7

############ base ############
FROM node:24-bookworm-slim AS base
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
# tini = proper PID 1 (signal forwarding, zombie reaping)
RUN apt-get update && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

############ deps (all deps; postinstall runs `prisma generate`, so the schema is needed) ############
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev

############ build ############
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate      # → src/generated/prisma
RUN npm run build            # tsc → dist/ (includes the generated client)
RUN npm prune --omit=dev --ignore-scripts

############ migrate (one-off job: has the Prisma CLI) ############
FROM deps AS migrate
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

############ runtime (api: default CMD; worker: `node dist/worker.js`) ############
FROM base AS runtime
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/server.js"]
