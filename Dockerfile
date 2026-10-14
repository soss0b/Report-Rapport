FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY views ./views
COPY public ./public
COPY scripts/create-admin.js ./scripts/create-admin.js
VOLUME /app/data
EXPOSE 3000
USER node
CMD ["npm", "start"]
