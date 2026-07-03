FROM node:20-alpine

WORKDIR /app/api-gateway

COPY api-gateway/package*.json ./
COPY api-gateway/node_modules ./node_modules

COPY api-gateway/src ./src
COPY api-gateway/tsconfig.json ./
COPY shared /app/shared
RUN ln -s /app/shared ./shared
RUN npx tsc
RUN if [ ! -e dist/shared ]; then ln -s /app/api-gateway/dist/api-gateway/shared dist/shared; fi

RUN npm prune --production

EXPOSE 80

CMD ["node", "dist/api-gateway/src/index.js"]