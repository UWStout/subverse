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

# Copy package files and install production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server source and built frontend from build stage
COPY server/ ./server/
COPY --from=build /usr/src/app/public/ ./public/

USER node
CMD ["npm", "start"]
