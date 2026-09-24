# --- Base Stage ---
FROM node:20-alpine AS base
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install

# --- Development Stage ---
# This stage is highly cached and perfect for local docker-compose development
FROM base AS development
COPY . .
CMD ["npm", "run dev"]

# --- Production Stage ---
# This stage builds a secure, lean, and production-ready image
FROM base AS production
COPY . .
# Optional: clean up devDependencies for production
RUN npm prune --production
USER node
CMD ["npm", "start"]
