#!/bin/bash
set -e
pnpm install --frozen-lockfile
# db push was removed intentionally because lib/db is an unused template and push would drop production tables.
