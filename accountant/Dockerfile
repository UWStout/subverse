# --- Base Stage ---
FROM node:22-alpine AS base
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install

# --- Build Stage ---
# Build the React frontend into public/
FROM base AS build
COPY . .
RUN npm run build

# --- Development Stage ---
# This stage is highly cached and perfect for local docker-compose development
FROM base AS development
COPY . .
CMD ["npm", "run", "dev"]

# --- Production Stage ---
# This stage builds a secure, lean, and production-ready image
FROM node:22-alpine AS production
WORKDIR /usr/src/app

# Copy package files and install production deps only.
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Copy server source, shared files, config files, and built frontend from build stage
COPY server/ ./server/
COPY prod.env ./.env
COPY --from=build /usr/src/app/shared/ ./shared/
COPY --from=build /usr/src/app/config/ ./config/
COPY --from=build /usr/src/app/public/ ./public/

# Generate the Prisma client
COPY prisma/ ./prisma/
COPY prisma.config.js ./prisma.config.js
RUN npx prisma generate

# gosu lets the entrypoint fix data-volume ownership as root; socat proxies
# the mounted docker socket when it is not accessible to the 'node' user
# (see docker-entrypoint.sh).
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN apk add --no-cache gosu socat && chmod +x ./docker-entrypoint.sh

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["npm", "start"]
