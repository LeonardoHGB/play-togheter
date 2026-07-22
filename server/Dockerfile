FROM node:22-slim

ENV NODE_ENV=production
ENV PORT=3333
ENV HOST=0.0.0.0
ENV DB_FILE=/app/data/listen-together.db

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

# Diretório do banco (persistido via volume no deploy). O container roda como
# root para conseguir gravar no volume do Railway, que é montado como root.
RUN mkdir -p /app/data

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3333/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/index.cjs"]
