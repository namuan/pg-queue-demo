FROM docker.io/library/node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

CMD ["npm", "run", "worker"]
