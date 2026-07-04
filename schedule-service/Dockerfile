FROM node:20-alpine

WORKDIR /app/schedule-service

COPY schedule-service/package*.json ./
COPY schedule-service/tsconfig.json ./
COPY schedule-service/node_modules ./node_modules

COPY schedule-service/src ./src
COPY schedule-service/migrations ./migrations
COPY shared /app/shared
RUN ln -s /app/shared ./shared

RUN npm run build
RUN rm -rf dist/shared && ln -s /app/schedule-service/dist/schedule-service/shared dist/shared

EXPOSE 3002

CMD ["sh", "-c", "TYPEORM_MIGRATION_RUN=true npx typeorm-ts-node-commonjs migration:run -d src/data-source.ts && node dist/schedule-service/src/index.js"]
