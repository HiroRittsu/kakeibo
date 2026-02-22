#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

WORKER_ORIGIN="${WORKER_ORIGIN:-https://kakeibo.zq1012noza.workers.dev}"
VITE_API_BASE_URL="${VITE_API_BASE_URL:-$WORKER_ORIGIN}"
WRANGLER_BIN="${WRANGLER_BIN:-apps/api/node_modules/.bin/wrangler}"
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo local)"
DEPLOY_VERSION="$(date -u +%Y%m%d.%H%M%S)-${GIT_SHA}"

if [[ ! -x "$WRANGLER_BIN" ]]; then
  echo "ERROR: wrangler binary not found at $WRANGLER_BIN"
  echo "Run: npm install"
  exit 1
fi

echo "[1/4] Apply remote D1 migrations"
npm run migrate:remote --prefix apps/api

echo "[2/4] Build mobile with VITE_API_BASE_URL=${VITE_API_BASE_URL} VITE_APP_VERSION=${DEPLOY_VERSION}"
VITE_API_BASE_URL="$VITE_API_BASE_URL" VITE_APP_VERSION="$DEPLOY_VERSION" npm run build --prefix apps/mobile

echo "[3/4] Deploy unified Worker (API + mobile assets)"
npm run deploy --prefix apps/api

echo "[4/4] Check endpoint"
echo "Open: ${WORKER_ORIGIN}/health"

echo "Deploy finished."
