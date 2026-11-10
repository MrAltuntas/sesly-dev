# Use Node.js 22 Alpine base image
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

RUN apk add --no-cache openssl

# Install dependencies
RUN npm ci && npm cache clean --force

# Copy application code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build application
RUN npm run build

# Expose port
EXPOSE 3000

# Run migrations and start app
CMD ["npm", "run", "start:migrate:prod"]
