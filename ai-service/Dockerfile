FROM node:20-alpine

WORKDIR /app/ai-service

COPY ai-service/package*.json ./
COPY ai-service/tsconfig.json ./
COPY ai-service/node_modules ./node_modules

COPY ai-service/src ./src
COPY ai-service/migrations ./migrations
COPY shared /app/shared
RUN ln -s /app/shared ./shared

RUN npm run build
RUN rm -rf dist/shared && ln -s /app/ai-service/dist/ai-service/shared dist/shared

EXPOSE 3004

CMD ["sh", "-c", "TYPEORM_MIGRATION_RUN=true npx typeorm-ts-node-commonjs migration:run -d src/data-source.ts && node dist/ai-service/src/index.js"]
