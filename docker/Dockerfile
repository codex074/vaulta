FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.22-alpine AS nasapi-build
WORKDIR /nasapi
COPY docker/nasapi/ ./
RUN go build -o /nasapi-bin .

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY --from=nasapi-build /nasapi-bin /usr/local/bin/nasapi
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /var/lib/vaulta && chmod 0750 /var/lib/vaulta
EXPOSE 8090
ENTRYPOINT ["/entrypoint.sh"]
