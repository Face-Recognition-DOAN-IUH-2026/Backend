FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
RUN npm install

COPY src ./src

RUN npm run build
RUN npm prune --omit=dev

EXPOSE 3006

CMD ["node", "dist/index.js"]
