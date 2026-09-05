# syntax=docker/dockerfile:1

FROM node:24-alpine AS build

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ARG VITE_NYA_API_URL=
ARG VITE_NYA_API_KEY=
ARG VITE_NYA_EDIT_KEY=
ENV VITE_NYA_API_URL=$VITE_NYA_API_URL \
    VITE_NYA_API_KEY=$VITE_NYA_API_KEY \
    VITE_NYA_EDIT_KEY=$VITE_NYA_EDIT_KEY

RUN pnpm build

FROM nginx:1.28-alpine AS runtime

ENV NYA_API_TARGET=http://host.docker.internal:5270 \
    NGINX_ENVSUBST_FILTER=NYA_API_TARGET

COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1
