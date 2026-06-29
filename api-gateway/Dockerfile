FROM node:20-alpine

WORKDIR /app

COPY api-gateway/package*.json ./
RUN npm install

COPY api-gateway/src ./src
COPY api-gateway/tsconfig.json ./
COPY shared ./shared
RUN ln -s /app/shared /shared
RUN npx tsc

RUN npm prune --production

EXPOSE 80

CMD ["node", "dist/src/index.js"]