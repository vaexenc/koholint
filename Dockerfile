# syntax=docker/dockerfile:1.26.0

# base images are pinned to exact patch versions so a rebuild months from now
# builds the same stack instead of silently moving to a new node/caddy release.
FROM node:24.18.1-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./

FROM base AS deps
RUN --mount=type=cache,target=/root/.npm npm ci

# dev: full deps and a source snapshot; `docker compose watch` syncs edits on
# top of it. the command (vite / nodemon) is set per service in compose.yaml.
FROM deps AS dev
ENV NODE_ENV=development
COPY . .

FROM deps AS build
COPY . .
RUN npm run build

# prod game server. it runs from source through tsx (no bundle step exists), so
# the sources ship with it — including src/server/store/db/migrations, which the
# db layer resolves next to its own file.
FROM base AS server
ENV NODE_ENV=production
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY tsconfig.json tsconfig.server.json ./
COPY public/maps ./public/maps
COPY src ./src
# owned by node so an unmounted _data/db still works; a bind mount brings its
# own host ownership instead, which is why it has to be uid 1000
# (compose.prod.yaml).
RUN mkdir -p _data/db && chown -R node:node _data
USER node
EXPOSE 3000
# exec form, no npm wrapper: SIGTERM has to reach tsx for the drain in
# src/server/index.ts to run.
CMD ["node_modules/.bin/tsx", "--tsconfig", "tsconfig.server.json", "src/server/index.ts"]

# prod edge: serves the built client and proxies /api and /ws to the server.
FROM caddy:2.11.4-alpine AS caddy
COPY caddy/Caddyfile.prod /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
