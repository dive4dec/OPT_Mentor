FROM ubuntu:24.04

ARG NODE_MAJOR=22
ENV HOME=/root

# Install minimal system deps and Node.js 22.
RUN apt-get update && \
    apt-get install -y ca-certificates curl gnupg git && \
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - && \
    apt-get update && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Build webllm-components.
WORKDIR /app/webllm-components
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN sed -i 's/\r$//' cleanup-index-js.sh && \
    chmod +x cleanup-index-js.sh && \
    npm run build

# Install website dependencies and run dev server.
WORKDIR /app/webllm-components/website
RUN npm install

# website/package.json uses `parcel ... --port 8888`
EXPOSE 8888
CMD ["npm", "start"]







