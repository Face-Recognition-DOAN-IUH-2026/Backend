FROM node:20-alpine

WORKDIR /app/notification-service

COPY notification-service/package*.json ./
COPY notification-service/tsconfig.json ./
RUN npm install

COPY notification-service/src ./src
COPY notification-service/migrations ./migrations
COPY shared /app/shared
RUN ln -s /app/shared ./shared
RUN cd /app/shared && npm install

RUN npm run build
RUN npm prune --omit=dev

EXPOSE 3006

CMD ["node", "dist/notification-service/src/index.js"]
