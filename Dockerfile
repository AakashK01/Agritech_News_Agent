FROM node:20-alpine

# dumb-init: proper PID 1 signal handling
# postgresql-client: pg_isready used in entrypoint health check
RUN apk add --no-cache dumb-init postgresql-client

WORKDIR /app

# Install all dependencies (including devDeps) so TypeScript can compile
COPY package*.json ./
RUN npm ci

# Copy source and compile
COPY . .
RUN npm run build

# Remove devDependencies — only production deps remain in final image
RUN npm prune --production

RUN chmod +x scripts/docker-entrypoint.sh

ENTRYPOINT ["dumb-init", "--"]
CMD ["scripts/docker-entrypoint.sh"]
