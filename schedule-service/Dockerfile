FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
RUN npm install

COPY src ./src
COPY migrations ./migrations

RUN npm run build

EXPOSE 3002

CMD ["sh", "-c", "npx typeorm-ts-node-commonjs migration:run -d src/data-source.ts && node dist/index.js"]
