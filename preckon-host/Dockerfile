# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────────────────────
# Preckon Host — multi-stage build for a small standalone Next.js 15 runtime.
# ─────────────────────────────────────────────────────────────────────────────

# 1) deps — install production + dev deps against the lockfile only (cache-friendly)
FROM node:20-alpine AS deps
WORKDIR /app
# libc compat for some native deps under alpine.
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# 2) builder — compile the app into .next/standalone
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build must not require a live DB / real secrets. mysql2 pools connect lazily
# and Better Auth reads env at runtime, so a placeholder secret is enough here.
# The secret is passed inline to the build process only (never baked into a layer).
ENV NEXT_TELEMETRY_DISABLED=1
# Where "Open workspace" sends an operator. NEXT_PUBLIC_* is inlined into the
# client bundle at build time, so this has to be a build arg — setting it in
# compose `environment:` at runtime has no effect.
ARG NEXT_PUBLIC_TENANT_PLANE_URL=http://localhost:3100
ENV NEXT_PUBLIC_TENANT_PLANE_URL=$NEXT_PUBLIC_TENANT_PLANE_URL
RUN BETTER_AUTH_SECRET=build-time-placeholder-secret-32-characters npm run build

# 3) runner — minimal image: Node + the traced standalone server
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as an unprivileged user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Standalone server + static assets + public files.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# DB schema/seed + import scripts so `npm run db:import` can run inside the image.
COPY --from=builder /app/db ./db
COPY --from=builder /app/scripts ./scripts

USER nextjs
EXPOSE 3000

# The standalone output writes its entrypoint to server.js.
CMD ["node", "server.js"]
