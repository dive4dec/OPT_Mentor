# ── Stage 1: Build webllm-components (rollup → lib/index.js) ──
FROM node:22-slim AS webllm-builder
WORKDIR /app/opt-mentor/webllm-components
COPY webllm-components/package.json webllm-components/package-lock.json ./
RUN npm ci --ignore-scripts
COPY webllm-components/ .
ENV HUSKY=0
ENV HUSKY_SKIP_HOOKS=1
RUN chmod +x cleanup-index-js.sh \
    && npx rollup -c rollup.config.cjs \
    && ./cleanup-index-js.sh \
    && test -f lib/index.js

# ── Stage 2: Build optlite-components (webpack → build/) ──
FROM node:22-slim AS optlite-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/opt-mentor/optlite-components
COPY optlite-components/package.json optlite-components/package-lock.json ./
RUN npm ci
COPY optlite-components/ .
COPY --from=webllm-builder /app/opt-mentor/webllm-components/lib ../webllm-components/lib
COPY webllm-components/package.json ../webllm-components/
ARG PUBLIC_PATH=""
ENV PUBLIC_PATH=${PUBLIC_PATH}
ENV INJECT_API_CONFIG=true
ENV API_INJECT_TARGET=define
ARG API_BASE_URL=""
ARG API_KEY=""
ARG API_MODEL=""
ARG SINGLE_MODE=""
ENV API_BASE_URL=${API_BASE_URL}
ENV API_KEY=${API_KEY}
ENV API_MODEL=${API_MODEL}
ENV SINGLE_MODE=${SINGLE_MODE}
RUN pip3 install --break-system-packages -r optlite/requirements.txt \
    && python3 setup.py bdist_wheel -d dist \
    && npm run build:prod \
    && test -f build/index.html \
    && test -f build/live.html

# ── Stage 3: nginx serving static files ──
FROM nginx:1.29-alpine3.23
COPY --from=optlite-builder /app/opt-mentor/optlite-components/build/ /usr/share/nginx/html/
EXPOSE 8000
COPY optlite-components/nginx.conf /etc/nginx/templates/default.conf.template
# envsubst processes ${VAR} in the template at container start.
# API_PROXY_TARGET = upstream API base URL (without trailing slash)
# API_PROXY_KEY   = API key injected server-side (never sent to browser)
# Default to a dead-end port so unset proxy just returns 502.
ENV API_PROXY_TARGET="http://127.0.0.1:1"
ENV API_PROXY_KEY=""
