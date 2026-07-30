# The AI worker: a tiny, dependency-free Node service. No DB driver is installed
# here at all — the trust boundary (§5.1) is enforced by construction.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000
USER node
CMD ["node", "src/server.mjs"]
