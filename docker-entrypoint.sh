#!/bin/sh
# Migrate, then listen. A failed migration stops the container before the Hub serves anything.
set -e
embertrail migrate
exec node /app/server.js
