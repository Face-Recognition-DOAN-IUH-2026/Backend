FROM node:20-alpine

WORKDIR /app/automation-service

COPY automation-service/package*.json ./
COPY automation-service/tsconfig.json ./
COPY automation-service/node_modules ./node_modules

COPY automation-service/src ./src
COPY automation-service/migrations ./migrations
COPY shared /app/shared
RUN ln -s /app/shared ./shared

RUN npm run build
RUN cp -r migrations dist/migrations
RUN rm -rf dist/shared && ln -s /app/shared dist/shared

EXPOSE 3007

CMD ["sh", "-c", "TYPEORM_MIGRATION_RUN=true npx typeorm-ts-node-commonjs migration:run -d src/data-source.ts && node dist/automation-service/src/index.js"]
