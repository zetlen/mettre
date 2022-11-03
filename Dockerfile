FROM node:16-alpine

# setting a blank namespace means env vars don't have to be prefixed with METTRE
ENV METTRE_NAMESPACE=

RUN apk add --no-cache su-exec bash

WORKDIR /usr/src/mettre

COPY package*.json ./
RUN npm ci --omit=dev

COPY lib lib

COPY docker-entrypoint.sh docker-entrypoint.sh

CMD [ "./docker-entrypoint.sh" ]
