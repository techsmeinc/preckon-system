# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Preckon Tenant plane — multi-stage build for a standalone Next.js 15 runtime.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Build must not require a live DB / real secrets (mysql2 connects lazily).
RUN BETTER_AUTH_SECRET=build-time-placeholder-secret-32-characters npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Uploads dir (dev/self-hosted object storage).
RUN mkdir -p /app/.uploads && chown -R nextjs:nodejs /app/.uploads
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
