FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY dist ./dist
COPY tsconfig.json ./

EXPOSE 3001

CMD ["node", "dist/index.js"]