FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (not just production) for development
RUN npm install

# Copy source code
COPY src ./src
COPY vite.config.js .
COPY svelte.config.js .
COPY postcss.config.js .
COPY tailwind.config.js .
COPY tsconfig.json .

# Build the application
RUN npm run build

# Expose port
EXPOSE 3001

# Run the vite dev server so the mounted source directory executes directly (dev workflow)
CMD ["npm", "run", "dev", "--", "--host"]