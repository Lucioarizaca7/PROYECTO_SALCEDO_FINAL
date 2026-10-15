# API de SISREC. Se construye desde la raíz del proyecto (usa el package-lock de los workspaces):
#   docker build -f apps/server/Dockerfile .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --workspace apps/server --include-workspace-root=false
COPY apps/server apps/server
RUN npm run build --workspace apps/server

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --omit=dev --workspace apps/server --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY apps/server/migrations apps/server/migrations

WORKDIR /app/apps/server
USER node
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3003) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
