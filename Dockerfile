FROM node:22-slim

# Install system dependencies needed for compiling better-sqlite3 and other native modules
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Create directory for the application
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if it exists)
COPY package*.json ./

# Install application dependencies (including better-sqlite3 which will compile)
RUN npm install --omit=dev

# Copy the rest of the application files
COPY . .

# Expose the admin UI port
EXPOSE 6245

# Set the default environment variable
ENV NODE_ENV=docker

# Healthcheck to verify the app is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:6245/health || exit 1

# Command to run the application
CMD [ "npm", "run", "server" ]
