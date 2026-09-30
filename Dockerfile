FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY . .

RUN corepack enable && corepack prepare pnpm@10.17.1 --activate
RUN pnpm install --frozen-lockfile

ARG SITE_URL=https://sait-madmuaziel-niks-final.pages.dev
ENV SITE_URL=${SITE_URL}
RUN pnpm run build:production

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ARG SITE_URL=https://sait-madmuaziel-niks-final.pages.dev
ENV NODE_ENV=production
ENV PORT=8080
ENV SITE_URL=${SITE_URL}
ENV STATIC_DIR=/app/artifacts/nyx-dnd-site/dist/public
ENV SERVE_FRONTEND=true

COPY --from=build /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=build /app/artifacts/nyx-dnd-site/dist/public ./artifacts/nyx-dnd-site/dist/public

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
