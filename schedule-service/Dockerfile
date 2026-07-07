FROM node:20-alpine

WORKDIR /app/schedule-service

COPY schedule-service/package*.json ./
COPY schedule-service/tsconfig.json ./
RUN npm install

COPY schedule-service/src ./src
COPY schedule-service/migrations ./migrations
COPY shared /app/shared
RUN ln -s /app/shared ./shared
RUN cd /app/shared && npm install

RUN npm run build

EXPOSE 3002

CMD ["sh", "-c", "TYPEORM_MIGRATION_RUN=true npx typeorm-ts-node-commonjs migration:run -d src/data-source.ts && node dist/schedule-service/src/index.js"]
