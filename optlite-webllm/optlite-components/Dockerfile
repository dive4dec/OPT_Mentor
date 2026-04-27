FROM ubuntu:24.04

ARG NODE_MAJOR=22

# Install system dependencies
RUN apt-get update && \
    apt-get install -y \
    build-essential \
    ca-certificates \
    gnupg \
    curl \
    git \
    wget && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js (keep current major or higher as required)
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - && \
    apt-get update && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Python 3.12 from Ubuntu 24.04 repository
RUN apt-get update && \
    apt-get install -y python3.12 python3.12-venv && \
    rm -rf /var/lib/apt/lists/*

# Create isolated Python virtual environment inside image
RUN python3.12 -m venv /opt/pyenv && \
    /opt/pyenv/bin/python -m ensurepip --upgrade

# Set environment variables
ENV HOME=/root
ENV PATH="/opt/pyenv/bin:${PATH}"

# Create working directory
WORKDIR /app

# Copy lockfiles first for better dependency-layer caching.
COPY webllm-components/package.json webllm-components/package-lock.json /app/webllm-components/
COPY optlite-components/package.json optlite-components/package-lock.json /app/optlite-components/

# Install Node dependencies before copying full source.
RUN cd webllm-components && \
    export HUSKY=0 && \
    export HUSKY_SKIP_HOOKS=1 && \
    npm ci --ignore-scripts
RUN cd optlite-components && npm ci

# Copy full source code.
COPY . .

# Build webllm-components first (required by optlite-components imports)
RUN cd webllm-components && \
    sed -i 's/\r$//' cleanup-index-js.sh && \
    chmod +x cleanup-index-js.sh && \
    npm run build

# Install Python dependencies for wheel build
RUN cd optlite-components && pip3 install -r optlite/requirements.txt && \
    pip3 install setuptools


# Build Python package
RUN cd optlite-components && python3 setup.py bdist_wheel -d dist

# Build frontend production assets
RUN cd optlite-components && npm run build:prod


# Expose static server port
EXPOSE 8000

# Serve compiled build directory
CMD ["python3", "-m", "http.server", "-d", "/app/optlite-components/build", "8000"]

