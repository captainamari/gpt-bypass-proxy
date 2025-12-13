# GPT Bypass Proxy Server Docker Image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    curl \
    tzdata \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S proxy -u 1001 -G nodejs

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev && \
    npm cache clean --force

# Copy source code
COPY src/ ./src/

# Create logs directory
RUN mkdir -p logs && \
    chown -R proxy:nodejs logs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=10800
ENV HOST=0.0.0.0

# Expose port
EXPOSE 10800

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:10800/health || exit 1

# Switch to non-root user
USER proxy

# Start the application
CMD ["node", "src/index.js"]
