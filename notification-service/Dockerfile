FROM node:20-alpine

WORKDIR /app

COPY notification-service/package*.json ./
COPY notification-service/tsconfig.json ./
RUN npm install

COPY notification-service/src ./src
COPY shared ./shared

RUN npm run build
RUN npm prune --omit=dev

EXPOSE 3006

CMD ["node", "dist/src/index.js"]
