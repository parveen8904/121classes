# Universal container for the always-on Discord discussion worker.
# Works on Railway, Render, Fly.io, or any Docker host.
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
CMD ["npm", "start"]
