FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy source and assets
COPY src ./src
COPY public ./public
COPY atp-registry ./atp-registry

# Set registry path
ENV ATP_REGISTRY_PATH=/app/atp-registry

# Expose port
EXPOSE 3847

# Run
CMD ["node", "src/index.js"]
