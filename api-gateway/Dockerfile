FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npx tsc

RUN npm prune --production

EXPOSE 80

CMD ["node", "dist/index.js"]