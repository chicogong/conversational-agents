FROM node:18-slim

# Set working directory
WORKDIR /app

# Install necessary system dependencies for the speech SDK
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all project files
COPY . .

# Expose the port the app runs on
EXPOSE 8080

# Set environment variables (these can be overridden at runtime)
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

# Command to run the application
CMD ["node", "server.js"] 