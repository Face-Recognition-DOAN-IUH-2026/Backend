FROM node:20-alpine

WORKDIR /app/access-service

COPY access-service/package*.json ./
COPY access-service/tsconfig.json ./
COPY access-service/node_modules ./node_modules

COPY access-service/src ./src
COPY access-service/migrations ./migrations
COPY shared /app/shared
RUN ln -s /app/shared ./shared

RUN npm run build
RUN if [ ! -e dist/shared ]; then ln -s /app/access-service/dist/access-service/shared dist/shared; fi

EXPOSE 3003

CMD ["sh", "-c", "TYPEORM_MIGRATION_RUN=true npx typeorm-ts-node-commonjs migration:run -d src/data-source.ts && node dist/access-service/src/index.js"]
