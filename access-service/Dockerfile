FROM node:20-alpine

WORKDIR /app/access-service

COPY access-service/package*.json ./
COPY access-service/tsconfig.json ./
RUN npm install

COPY access-service/src ./src
COPY access-service/migrations ./migrations
COPY shared /app/shared
RUN ln -s /app/shared ./shared
RUN cd /app/shared && npm install

RUN npm run build
RUN rm -rf dist/shared && ln -s /app/access-service/dist/access-service/shared dist/shared

EXPOSE 3003

CMD ["sh", "-c", "TYPEORM_MIGRATION_RUN=true npx typeorm-ts-node-commonjs migration:run -d src/data-source.ts && node dist/access-service/src/index.js"]
