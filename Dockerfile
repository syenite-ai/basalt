FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production=false

COPY tsconfig.json ./
COPY src/ src/

RUN npx tsc

FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY --from=build /app/dist/ dist/

VOLUME ["/app/data"]
ENV DATABASE_URL=/app/data/basalt.db

EXPOSE 3100

CMD ["node", "dist/cli.js", "start"]
