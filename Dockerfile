# syntax=docker/dockerfile:1

# ---- deps ----------------------------------------------------------------
# Installs the full dependency tree (incl. devDependencies) once, shared by
# the build stage and copied into the runtime stage. devDependencies are kept
# at runtime because `drizzle-kit migrate` (a devDependency) runs explicitly
# on container start — see the entrypoint below.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# ---- build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Compile only. Database migration remains an explicit runtime operation in
# docker-entrypoint.sh; no image-build or install hook mutates a database.
RUN yarn build

# ---- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Non-root user
RUN addgroup -S nodejs && adduser -S nuxt -G nodejs

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.output ./.output
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/server/database/migrations ./server/database/migrations
COPY --from=build /app/server/database/schema ./server/database/schema
COPY --from=build /app/package.json ./package.json
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R nuxt:nodejs /app

USER nuxt

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- --spider http://127.0.0.1:3000/ || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
