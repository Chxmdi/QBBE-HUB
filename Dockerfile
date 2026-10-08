# syntax=docker/dockerfile:1.7
#
# QBBE Hub web app as one container (docs/runbooks/hosting.md).
#
# Built once per environment: Next.js writes NEXT_PUBLIC_* values into the
# browser code at build time, so staging and production get separate images
# of the same commit. Only public values are build arguments; server secrets
# (service role key, CRON_JOB_SECRET, provider keys) reach the container at
# run time from the server's app.env file and never enter an image.
#
# Every NEXT_PUBLIC_* variable the code reads must be declared below;
# tests/unit/dockerfile.test.ts fails when one is missing.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_GOOGLE_SIGN_IN=""
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone \
    NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_GOOGLE_SIGN_IN=${NEXT_PUBLIC_GOOGLE_SIGN_IN}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" && test -n "$NEXT_PUBLIC_APP_URL" \
      || { echo "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and NEXT_PUBLIC_APP_URL are required build arguments." >&2; exit 1; }
RUN npm run build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ARG APP_COMMIT=unknown
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_COMMIT=${APP_COMMIT}
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/version').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server.js"]
