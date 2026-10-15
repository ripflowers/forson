FROM node:22-bookworm-slim AS node

FROM python:3.12-slim-bookworm AS api
ARG APP_REVISION=development
LABEL org.opencontainers.image.source="https://github.com/ripflowers/forson" \
      org.opencontainers.image.revision=$APP_REVISION
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates ffmpeg libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 10001 forson
WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY web/package.json web/package-lock.json web/
WORKDIR /app/web
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=forson:forson server /app/server
COPY --chown=forson:forson scripts /app/scripts
COPY --chown=forson:forson resources /app/resources
COPY --chown=forson:forson web/src /app/web/src
COPY --chown=forson:forson web/public /app/web/public
RUN mkdir -p /app/data /app/web/node_modules/.remotion && chown -R forson:forson /app/data /app/web/node_modules/.remotion
USER forson
RUN npx remotion browser ensure
ENV PYTHONPATH=/app/server PYTHONUNBUFFERED=1
WORKDIR /app
EXPOSE 8787
CMD ["python", "-m", "uvicorn", "zhijian.app:app", "--host", "0.0.0.0", "--port", "8787", "--proxy-headers", "--forwarded-allow-ips", "*"]

FROM nginx:1.28-alpine AS web
ARG APP_REVISION=development
LABEL org.opencontainers.image.revision=$APP_REVISION
COPY deploy/web.conf /etc/nginx/conf.d/default.conf
COPY web/dist /usr/share/nginx/html
EXPOSE 8080
