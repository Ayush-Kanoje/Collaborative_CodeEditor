# Build frontend

FROM node:20-alpine as frontend-builder

COPY ./Frontend /app
WORKDIR /app

RUN npm install
RUN npm run build


# Build backed

FROM node:20-alpine as backend-builder

COPY ./Backend /app

WORKDIR /app

RUN npm install

COPY --from=frontend-builder /app/dist /app/public

CMD ["npm", "start"]