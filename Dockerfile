# Imagen de producción (ADR 0017). Targets: api (por defecto), migrate (con node-pg-migrate) y web (nginx + frontend compilado).
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev

FROM base AS frontend
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_STRIPE_PUBLISHABLE_KEY
COPY frontend/package*.json frontend/
RUN npm --prefix frontend ci
COPY frontend frontend
RUN npm --prefix frontend run build

# migrate: con las dependencias de desarrollo (node-pg-migrate); no sirve nada
FROM base AS migrate
COPY package*.json ./
RUN npm ci
COPY migrations migrations
USER node
CMD ["npx", "node-pg-migrate", "up"]

FROM nginx:1.27-alpine AS web
# La config de producción habla con la API en 127.0.0.1:3000; en Compose la API es el servicio «api».
COPY deploy/nginx.conf /tmp/prod.conf
RUN sed 's/127.0.0.1:3000/api:3000/' /tmp/prod.conf > /etc/nginx/conf.d/default.conf
COPY --from=frontend /app/frontend/dist /srv/kaizen/frontend/dist

FROM base AS api
ENV NODE_ENV=production
COPY --from=deps /app/node_modules node_modules
COPY package*.json ./
COPY src src
COPY scripts scripts
# Los volúmenes con nombre heredan este dueño: la API (no root) tiene que poder escribir en storage/.
RUN mkdir -p storage && chown node:node storage
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
