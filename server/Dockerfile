FROM node:20-alpine

WORKDIR /app
# Copy server package and install deps
COPY server/package.json ./package.json
RUN npm install --production
# Copy server source
COPY server/src ./src
COPY server/.env.example ./.env.example
COPY server/README.md ./README.md
# Copy web static to serve
# Copy static assets (new UI at repo root)
COPY index.html ./public/index.html
COPY css ./public/css
COPY js ./public/js
COPY web ./web

ENV PORT=5055
EXPOSE 5055
CMD ["node", "src/index.js"]
