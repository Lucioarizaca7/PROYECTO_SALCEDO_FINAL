# Web de SISREC: compila el cliente con Vite y lo sirve con Caddy (HTTPS automático + proxy a la API).
# Se construye desde la raíz del proyecto:
#   docker build -f apps/client/Dockerfile --build-arg VITE_API_URL=https://sisrec.example.pe .

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --workspace apps/client --include-workspace-root=false
COPY apps/client apps/client
# Origen público del sistema, sin /api (la web y la API comparten dominio detrás de Caddy).
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build --workspace apps/client

FROM caddy:2.10-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/client/dist /srv
