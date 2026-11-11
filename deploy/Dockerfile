# syntax=docker/dockerfile:1

# One image, several roles. The role is the container command: api | worker | migrate.
# Build from the repository root:
#   docker build -f deploy/Dockerfile -t skillcdn-console .
#
# Never pass secrets through ARG or ENV: they end up in image history.
# If a build ever needs a credential, use a BuildKit secret mount.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    DO_NOT_TRACK=1 \
    TURBO_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

# Dependency layer: invalidated only when the lockfile or workspace settings change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter=@skillcdn/console-app...

# Self-contained production tree: built output, the migrations, and production dependencies only.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm --filter=@skillcdn/console-app --prod deploy /out

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="SkillCDN Console" \
      org.opencontainers.image.source="https://github.com/skillcdn/console" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# The default UI is static files next to the server. Unset WEB_ROOT to run without it.
COPY --from=build --chown=node:node /repo/apps/console/web/dist ./web
# The console's own skills as a pack served from this machine (ADR-0031): what an agent reads
# with `console skill` where no deployment is reachable. An organization's packs mount beside it.
COPY --from=build --chown=node:node /repo/SKILLCDN.md ./packs/skillcdn/console/
COPY --from=build --chown=node:node /repo/skills ./packs/skillcdn/console/skills
COPY --from=build --chown=node:node /repo/docs ./packs/skillcdn/console/docs
# The files of the repository those link to, and the ones these link to in turn, each at its
# own path, so that no link of the pack leads nowhere in a deployed console; `pnpm check:skills`
# holds the list to the links.
COPY --from=build --chown=node:node /repo/AGENTS.md /repo/README.md /repo/CONTRIBUTING.md /repo/SECURITY.md /repo/LICENSE.md /repo/.env.example ./packs/skillcdn/console/
COPY --from=build --chown=node:node /repo/.github/dependabot.yml ./packs/skillcdn/console/.github/
COPY --from=build --chown=node:node /repo/.github/workflows/ci.yml /repo/.github/workflows/release.yml ./packs/skillcdn/console/.github/workflows/
COPY --from=build --chown=node:node /repo/apps/console/README.md ./packs/skillcdn/console/apps/console/
COPY --from=build --chown=node:node /repo/deploy/README.md /repo/deploy/Dockerfile /repo/deploy/compose.yaml /repo/deploy/compose.dev.yaml ./packs/skillcdn/console/deploy/
COPY --from=build --chown=node:node /repo/examples/agent-desk/AGENTS.md ./packs/skillcdn/console/examples/agent-desk/
COPY --from=build --chown=node:node /repo/packages/console/README.md ./packs/skillcdn/console/packages/console/
# What the image is distributed under travels with it.
COPY --from=build --chown=node:node /repo/LICENSE.md ./
ENV WEB_ROOT=/app/web \
    SKILLS_DIR=/app/packs
USER node
EXPOSE 11199
ENTRYPOINT ["node", "--enable-source-maps", "dist/main.js"]
CMD ["api"]
