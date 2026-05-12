FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY api ./api
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts
COPY server.js ./

EXPOSE 41739

CMD ["npm", "start"]
