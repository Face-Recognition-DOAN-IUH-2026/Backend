FROM node:20-alpine

WORKDIR /app

COPY access-service/package*.json ./
COPY access-service/tsconfig.json ./
RUN npm install

COPY access-service/src ./src
COPY access-service/migrations ./migrations
COPY shared ./shared
RUN ln -s /app/shared /shared

RUN npm run build

EXPOSE 3003

CMD ["sh", "-c", "TYPEORM_MIGRATION_RUN=true npx typeorm-ts-node-commonjs migration:run -d src/data-source.ts && node dist/src/index.js"]
