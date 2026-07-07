FROM node:20-alpine

WORKDIR /app/user-service

COPY user-service/package*.json ./
COPY user-service/tsconfig.json ./
RUN npm install

COPY user-service/src ./src
COPY user-service/migrations ./migrations
COPY shared /app/shared
RUN ln -s /app/shared ./shared
RUN cd /app/shared && npm install

RUN npm run build

EXPOSE 3001

CMD ["sh", "-c", "npx typeorm-ts-node-commonjs migration:run -d src/data-source.ts && npx ts-node src/index.ts"]
