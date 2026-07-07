FROM node:20-alpine

WORKDIR /app/ai-service

COPY ai-service/package*.json ./
COPY ai-service/tsconfig.json ./
RUN npm install

COPY ai-service/src ./src
COPY ai-service/migrations ./migrations
COPY shared /app/shared
RUN ln -s /app/shared ./shared
RUN cd /app/shared && npm install

RUN npm run build

EXPOSE 3004

CMD ["sh", "-c", "TYPEORM_MIGRATION_RUN=true npx typeorm-ts-node-commonjs migration:run -d src/data-source.ts && node dist/ai-service/src/index.js"]
