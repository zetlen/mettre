FROM node:16

WORKDIR /usr/src/mettre

COPY package*.json ./

RUN npm ci --omit=dev

COPY lib lib
COPY server.js server.js

CMD [ "npm", "start" ]
