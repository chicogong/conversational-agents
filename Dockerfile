FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first (for better layer caching)
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source files
COPY . .

# Production image stage
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install only essential dependencies
RUN apk add --no-cache alsa-lib

# Copy from builder stage
COPY --from=builder /app /app

# Set environment variables
ENV NODE_ENV=production \
    SERVER_HOST=0.0.0.0 \
    SERVER_PORT=8080

# Expose the port
EXPOSE 8080

# Command to run the application
CMD ["node", "server.js"] 