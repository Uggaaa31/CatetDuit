FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git tzdata

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

EXPOSE 3001

CMD ["node", "src/index.js"]
