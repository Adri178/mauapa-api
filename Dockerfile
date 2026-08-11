# syntax=docker/dockerfile:1

# Debian slim rather than Alpine: argon2 is a native module, and glibc prebuilds
# are the ones that reliably exist. Alpine would mean compiling it at build time
# for no benefit that matters here.
ARG NODE_VERSION=22-bookworm-slim

# ─── build ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

# OpenSSL must be present here as well as in the runtime image. Prisma picks its
# query-engine build from the OpenSSL it detects *at generate time*; generating
# without it produced an openssl-1.1.x engine that the runtime — which does have
# OpenSSL 3 — then could not find. Both stages have to agree.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Dependencies are copied and installed before the source, so editing a file
# does not invalidate the (slow) install layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies from the tree that will be copied into the runtime.
RUN npm prune --omit=dev

# ─── run ──────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
ENV NODE_ENV=production
WORKDIR /app

# Prisma's query engine links against OpenSSL. Without it the engine still
# starts but warns that it is guessing the version, which is a footgun waiting
# for the day the guess is wrong.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Runs as the unprivileged `node` user that the base image already provides.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node public ./public
COPY --chown=node:node package.json ./
COPY --chown=node:node docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

USER node
EXPOSE 3000

# The app reports its own database connectivity, so the check is meaningful
# rather than just "the process is alive".
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main"]
