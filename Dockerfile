# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production stage
FROM node:22-alpine

LABEL org.opencontainers.image.title="FortiGate MCP Server" \
      org.opencontainers.image.description="Read-only MCP server for FortiGate firewalls and FortiAnalyzer" \
      org.opencontainers.image.source="https://github.com/ivillagomez/fortigate-mcp" \
      org.opencontainers.image.vendor="ivillagomez" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/build/ ./build/

# MCP_TRANSPORT=sse enables HTTP/SSE mode (for OVA/shared deployments)
# MCP_TRANSPORT=stdio (default) for Docker/Claude Desktop usage
ENV MCP_TRANSPORT=stdio
ENV MCP_PORT=3000

EXPOSE 3000
USER node
ENTRYPOINT ["node", "build/index.js"]
