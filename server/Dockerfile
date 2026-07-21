FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=3333
ENV HOST=0.0.0.0

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

USER node
EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:3333/health || exit 1

CMD ["node", "src/index.cjs"]
