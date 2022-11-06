#!/bin/bash

PUID=${PUID:-911}
PGID=${PGID:-911}

groupadd -o -g "$PGID" mettre
useradd -o -u "$PUID" -g mettre mettre

echo "
-------------------------------------
GID/UID
-------------------------------------
User uid:    $(id -u mettre)
User gid:    $(id -g mettre)
-------------------------------------
"

chown mettre:mettre /usr/src/mettre
su-exec "$PUID":"$PGID" node lib/server.js
