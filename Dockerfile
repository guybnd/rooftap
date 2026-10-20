# syntax=docker/dockerfile:1

# --- deps: install exact locked dependencies (whole workspace) -------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/ui/package.json ./packages/ui/package.json
COPY packages/config/package.json ./packages/config/package.json
RUN npm ci

# --- builder: produce the standalone Next.js build --------------------------
FROM node:22-alpine AS builder
WORKDIR /app
# This monorepo intentionally carries two Tailwind majors — packages/ui and
# apps/mobile need v3 for NativeWind, apps/web needs v4 for its CSS-first
# setup. `npm ci` resolves that by hoisting v3 to the root node_modules and
# nesting web's own v4 copy at apps/web/node_modules/tailwindcss (plus a
# nested typescript there and under packages/core). Copying only the top-level
# node_modules silently dropped all three, so apps/web's build fell back to
# the root v3 and could not resolve its own `@import "tailwindcss";`.
# Scoped to these two paths rather than a blanket `COPY --from=deps /app ./`,
# which would also drag in apps/mobile's react-native binaries for a build
# that never touches apps/mobile.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/core/node_modules ./packages/core/node_modules
COPY . .
# Build-time-only public config (FLUX-1561 Grounding: NEXT_PUBLIC_* vars inline
# at `next build`). Values are supplied via --build-arg from docker-compose's
# `app` build.args so the image is rebuilt whenever they change.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_MAPBOX_TOKEN
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_MAPBOX_TOKEN=$NEXT_PUBLIC_MAPBOX_TOKEN \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    NODE_ENV=production
RUN npm run build -w apps/web

# --- runner: minimal standalone runtime image --------------------------------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# `output: "standalone"` traces only the deps each route actually needs into
# .next/standalone/node_modules; static assets and PWA files (incl. sw.js,
# the Serwist service worker) live under public/ and .next/static and must be
# copied separately — standalone does not bundle either.
# HOUP-66: `outputFileTracingRoot` in apps/web/next.config.ts points tracing
# at the monorepo root (so hoisted root-level deps aren't dropped), which
# means the standalone entrypoint and hoisted node_modules land nested at
# apps/web/.next/standalone/apps/web/... and apps/web/.next/standalone/node_modules
# rather than at the build's own root.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
