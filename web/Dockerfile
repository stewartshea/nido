FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (not just production) for development
RUN npm install

# Copy source code
COPY src ./src
COPY static ./static
COPY vite.config.js .
COPY svelte.config.js .
COPY postcss.config.js .
COPY tailwind.config.js .
COPY tsconfig.json .

# Build the application
RUN npm run build

ENV PORT=3001
ENV HOST=0.0.0.0
ENV PROTOCOL_HEADER=x-forwarded-proto
ENV HOST_HEADER=x-forwarded-host

EXPOSE 3001

# /api/* is proxied to API_PROXY_TARGET by src/hooks.server.ts.
CMD ["node", "build"]
