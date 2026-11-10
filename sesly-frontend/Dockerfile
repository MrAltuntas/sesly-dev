# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Public Firebase web config for /auth/action, baked in by Vite at build time.
# Optional: empty values are fine, the page then takes the web API key from
# the action link itself. Not secrets (the web config ships in every client).
ARG VITE_FIREBASE_API_KEY=
ARG VITE_FIREBASE_AUTH_DOMAIN=
ARG VITE_FIREBASE_PROJECT_ID=

# sesly-dev: API the legal pages fetch from. Default is the value the code
# falls back to, so an image built without the argument is unchanged.
ARG VITE_API_BASE_URL=https://api.sesly.io

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
