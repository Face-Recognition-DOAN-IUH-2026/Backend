FROM node:20-alpine

WORKDIR /app/borrow-service

COPY borrow-service/package*.json ./
COPY borrow-service/tsconfig.json ./
RUN npm install

COPY borrow-service/src ./src
COPY shared /app/shared
RUN ln -s /app/shared ./shared
RUN cd /app/shared && npm install

RUN npm run build
RUN npm prune --omit=dev

EXPOSE 8000

CMD ["node", "dist/borrow-service/src/index.js"]
