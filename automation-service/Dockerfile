FROM node:20-alpine

WORKDIR /app

COPY automation-service/package*.json ./
COPY automation-service/tsconfig.json ./
RUN npm install

COPY automation-service/src ./src
COPY shared ./shared

RUN npm run build
RUN npm prune --omit=dev

EXPOSE 3007

CMD ["node", "dist/src/index.js"]
