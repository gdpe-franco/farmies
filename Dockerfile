FROM node:24-slim

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/client/package.json apps/client/package.json
COPY apps/client/src-capacitor/package.json apps/client/src-capacitor/package.json
COPY apps/api/package.json apps/api/package.json
RUN npm ci

COPY . .

USER node
