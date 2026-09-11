# ============================================================================
# Stage 1: Build Frontend
# Purpose: Compile React app with Vite, produce static assets
# ============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app

# Copy package files for dependency installation
COPY ./Frontend/package*.json ./

# Install dependencies (including devDependencies for build)
RUN npm ci --include=dev

# Copy source code
COPY ./Frontend ./

# Build argument for backend URL (can be overridden at build time)
ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

# Build optimized production bundle
RUN npm run build

# Verify build output exists
RUN ls -la /app/dist && \
    test -f /app/dist/index.html || (echo "Build failed: index.html not found" && exit 1)

# ============================================================================
# Stage 2: Build Backend Dependencies
# Purpose: Install production dependencies only, no source code yet
# ============================================================================
FROM node:20-alpine AS backend-deps

WORKDIR /app

# Copy package files
COPY ./Backend/package*.json ./

# Install ONLY production dependencies
# Using npm ci for reproducible builds, --omit=dev excludes devDependencies
RUN npm ci --omit=dev --production && \
    npm cache clean --force

# ============================================================================
# Stage 3: Runtime Image (Final)
# Purpose: Minimal image with only runtime essentials
# ============================================================================
FROM node:20-alpine AS runtime

# Install runtime dependencies
# Python3 is needed for the Python trace execution feature
# curl is needed for HEALTHCHECK
RUN apk add --no-cache \
    python3 \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy production dependencies from deps stage
COPY --from=backend-deps /app/node_modules ./node_modules

# Copy backend source code
COPY ./Backend/package*.json ./
COPY ./Backend/server.js ./
COPY ./Backend/tracer.py ./
COPY ./Backend/config ./config
COPY ./Backend/middleware ./middleware
COPY ./Backend/routes ./routes
COPY ./Backend/services ./services
COPY ./Backend/utils ./utils

# Copy frontend build artifacts from frontend-builder stage
COPY --from=frontend-builder /app/dist ./public

# Create non-root user and group for security
# -S: system user/group (no password, no home directory)
# -D: don't assign a password
# -H: don't create home directory
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S -D -H -G appgroup appuser && \
    chown -R appuser:appgroup /app && \
    chmod -R 550 /app && \
    chmod -R 750 /app/node_modules

# Environment variables with secure defaults
ENV NODE_ENV=production \
    PORT=3000 \
    CORS_ORIGIN=http://localhost:5173 \
    TRACE_MAX_CONCURRENCY=4 \
    TRACE_TIMEOUT_MS=5000

# Expose application port
EXPOSE 3000

# Switch to non-root user
USER appuser

# Health check using the new /healthz endpoint
# --interval: how often to check
# --timeout: max time to wait for response
# --start-period: grace period during startup
# --retries: consecutive failures before marking unhealthy
HEALTHCHECK --interval=30s \
            --timeout=5s \
            --start-period=15s \
            --retries=3 \
    CMD curl -f http://127.0.0.1:3000/healthz || exit 1

# Use dumb-init to handle signals properly (PID 1 problem)
# This ensures graceful shutdown works correctly in containers
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Start the application
CMD ["node", "server.js"]