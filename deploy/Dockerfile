FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY server ./server
COPY public ./public

# تشغيل كحساب غير جذري لأمان الحاويات
USER node
EXPOSE 3000

CMD ["node", "server/server.js"]
