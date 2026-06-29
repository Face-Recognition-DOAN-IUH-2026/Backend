FROM node:20-alpine

WORKDIR /app

COPY borrow-service/package*.json ./
COPY borrow-service/tsconfig.json ./
RUN npm install

COPY borrow-service/src ./src
COPY shared ./shared
RUN ln -s /app/shared /shared

RUN npm run build
RUN npm prune --omit=dev

EXPOSE 8000

CMD ["node", "dist/src/index.js"]
