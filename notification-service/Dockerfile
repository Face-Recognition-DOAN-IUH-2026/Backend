FROM node:20-alpine

WORKDIR /app/notification-service

COPY notification-service/package*.json ./
COPY notification-service/tsconfig.json ./
COPY notification-service/node_modules ./node_modules

COPY notification-service/src ./src
COPY notification-service/migrations ./migrations
COPY shared /app/shared
RUN ln -s /app/shared ./shared

RUN npm run build
RUN cp -r migrations dist/migrations
RUN rm -rf dist/shared && ln -s /app/shared dist/shared
RUN npm prune --omit=dev

EXPOSE 3006

CMD ["node", "dist/notification-service/src/index.js"]
