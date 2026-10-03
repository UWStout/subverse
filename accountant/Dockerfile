# --- Base Stage ---
FROM node:20-alpine AS base
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
FROM node:20-alpine AS production
WORKDIR /usr/src/app

# Copy package files and install production deps only.
# --legacy-peer-deps: @prisma/client declares the prisma CLI as an *optional*
# peer dependency, and npm 7+ auto-installs peers by default - which would pull
# the entire CLI (mysql2, @prisma/config, deepmerge-ts, ...) into this image
# even though nothing at runtime imports it. All REQUIRED peers in this project
# are explicit dependencies, so skipping peer auto-install is safe here.
COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

# Copy server source and built frontend from build stage
COPY server/ ./server/
COPY --from=build /usr/src/app/public/ ./public/

USER node
CMD ["npm", "start"]
