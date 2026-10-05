FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl git

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

RUN npx prisma generate

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push && node src/index.js"]
