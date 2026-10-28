# Node 22+ required: better-sqlite3-multiple-ciphers prebuilds segfault on Node 20 (linuxmusl-arm64)
FROM node:22-alpine

# The sqlite binding's prebuilds cover the common platforms (CI's linuxmusl
# x64 among them), but not every arch/ABI pair — on those, node-gyp compiles
# from source, which needs python3/make/g++. Without these the image build
# works on some runners and not others depending on what prebuilds exist
# that day.
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Same reason as the web image: the lockfile decides every version, not the
# registry-of-the-day. `npm ci --workspace api` pulls root plus api deps;
# the web workspace is skipped. `scripts/` is copied because `npm ci` runs
# the root `prepare` script, which no-ops outside a git checkout.
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
COPY scripts ./scripts
RUN npm ci --workspace api

WORKDIR /app/api

# Copy source code
COPY api/src ./src
COPY api/tsconfig.json ./

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Reported in every log line, and keeps runtime behaviour off dev defaults.
ENV NODE_ENV=production

# Serve the compiled server (production mode — no tsx watch, no dev-process connection leaks)
CMD ["npm", "start"]