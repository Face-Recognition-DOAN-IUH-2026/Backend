FROM node:20-alpine

WORKDIR /app/borrow-service

COPY borrow-service/package*.json ./
COPY borrow-service/tsconfig.json ./
COPY borrow-service/node_modules ./node_modules

COPY borrow-service/src ./src
COPY shared /app/shared
RUN ln -s /app/shared ./shared

RUN npm run build
RUN rm -rf dist/shared && ln -s /app/shared dist/shared
RUN npm prune --omit=dev

EXPOSE 8000

CMD ["node", "dist/borrow-service/src/index.js"]
