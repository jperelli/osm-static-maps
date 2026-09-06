# syntax=docker/dockerfile:1

# Multi-stage build.
#   docker build .                        -> production image (default target)
#   docker build --target dev .           -> development image (nodemon, all deps)
# See README.md ("Docker") for usage.

ARG NODE_VERSION=26.3.1
ARG OXIPNG_VERSION=10.2.0


# ---------------------------------------------------------------------------
# oxipng: fetch the prebuilt static binary for the optional --oxipng flag, so
# the runtime image does not need a Rust toolchain.
# ---------------------------------------------------------------------------
FROM debian:trixie-slim AS oxipng
ARG OXIPNG_VERSION
ARG TARGETARCH
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN case "${TARGETARCH}" in \
        amd64) triple=x86_64-unknown-linux-musl ;; \
        arm64) triple=aarch64-unknown-linux-musl ;; \
        *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/oxipng/oxipng/releases/download/v${OXIPNG_VERSION}/oxipng-${OXIPNG_VERSION}-${triple}.tar.gz" \
        | tar -xz --strip-components=1 -C /usr/local/bin "oxipng-${OXIPNG_VERSION}-${triple}/oxipng" \
    && /usr/local/bin/oxipng --version


# ---------------------------------------------------------------------------
# base: node + a system chromium for puppeteer (no browser download at
# npm install time) + fonts + tini (PID 1, so SIGTERM stops the container
# immediately and defunct chromium processes are reaped).
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS base
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    OXIPNG_PATH=/usr/local/bin/oxipng
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        ca-certificates \
        fonts-liberation \
        fonts-wqy-zenhei \
        tini \
    && rm -rf /var/lib/apt/lists/*
COPY --from=oxipng /usr/local/bin/oxipng /usr/local/bin/oxipng
WORKDIR /app
EXPOSE 3000
ENTRYPOINT [ "tini", "--" ]


# ---------------------------------------------------------------------------
# dev: all dependencies + nodemon. Meant to be used with docker-compose.dev.yml,
# which bind-mounts ./src so code changes reload without rebuilding.
# ---------------------------------------------------------------------------
FROM base AS dev
ENV NODE_ENV=development
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node . .
CMD [ "npm", "run", "dev" ]


# ---------------------------------------------------------------------------
# deps: production node_modules only.
# ---------------------------------------------------------------------------
FROM base AS deps
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev


# ---------------------------------------------------------------------------
# production (default target): runtime sources + production deps, non-root.
# ---------------------------------------------------------------------------
FROM base AS production
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD [ "node", "src/cli.js", "serve" ]
