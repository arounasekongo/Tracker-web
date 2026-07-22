#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 20 ou plus recent et npm sont requis." >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Configurez .env, puis relancez ce script." >&2
  exit 1
fi

npm ci
npm run init-db
npm test
npm start
