FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY dist ./dist

EXPOSE 80

CMD ["node", "dist/index.js"]