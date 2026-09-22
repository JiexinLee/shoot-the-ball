#!/bin/sh
set -e

echo "Applying Prisma migrations..."
pnpm db:migrate:prod
echo "Starting API server..."
exec node dist/main.js
