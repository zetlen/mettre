FROM node:16

WORKDIR /usr/src/mettre

COPY package*.json ./

RUN npm ci --omit=dev

COPY lib lib
COPY server.js server.js

# setting a blank namespace means env vars don't have to be prefixed with METTRE
ENV METTRE_NAMESPACE=

CMD [ "npm", "start" ]
