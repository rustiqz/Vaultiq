# Built in two stages so the shipped image carries no compiler, no test
# harness and no source — only what it needs to run.

FROM node:24-alpine AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm run build

# Prune to runtime dependencies before copying them across.
RUN pnpm prune --prod

FROM node:24-alpine AS runtime
WORKDIR /app

# Never as root: a process that holds other people's ciphertext should not be
# able to rewrite the filesystem it runs on.
USER node

ENV NODE_ENV=production

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node package.json ./

EXPOSE 3000

# The container reports its own health, so compose can wait for readiness
# rather than assuming it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.json()).then(b=>process.exit(b.status==='ok'?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
