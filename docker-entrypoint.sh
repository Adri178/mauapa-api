#!/bin/sh
set -e

# Migrations run before the app accepts traffic, not from inside it.
#
# `migrate deploy` only applies migrations that already exist and never
# generates or resets anything, which is what makes it safe to run on every
# boot: a second instance starting concurrently finds nothing left to do.
echo "Applying database migrations…"
npx prisma migrate deploy

echo "Starting API…"
exec "$@"
