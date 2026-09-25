# Node 22+ required: better-sqlite3-multiple-ciphers prebuilds segfault on Node 20 (linuxmusl-arm64)
FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (not just production) to ensure TypeScript compilation works
RUN npm install

# Copy source code
COPY src ./src
COPY tsconfig.json .

# Build the application
RUN npm run build

# Expose port
EXPOSE 3000

# Serve the compiled server (production mode — no tsx watch, no dev-process connection leaks)
CMD ["npm", "start"]