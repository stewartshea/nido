FROM node:22-alpine

WORKDIR /app

# One lockfile covers both workspaces; `npm ci --workspace web` installs
# exactly the tree CI tests — resolved by the lockfile, not freshly from
# every range on each build (which is how the rollup 4.65.1 outage shipped:
# CI green on one tree, the image built from another). The api workspace's
# native builds are not pulled in. `scripts/` is copied because `npm ci`
# runs the root `prepare` script, which no-ops outside a git checkout.
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
COPY scripts ./scripts
RUN npm ci --workspace web

WORKDIR /app/web

# Copy source code
COPY web/src ./src
COPY web/static ./static
COPY web/vite.config.js web/svelte.config.js web/postcss.config.js web/tailwind.config.js web/tsconfig.json ./

# Build the application
RUN npm run build

ENV PORT=3001
ENV HOST=0.0.0.0
ENV PROTOCOL_HEADER=x-forwarded-proto
ENV HOST_HEADER=x-forwarded-host

EXPOSE 3001

# /api/* is proxied to API_PROXY_TARGET by src/hooks.server.ts.
CMD ["node", "build"]