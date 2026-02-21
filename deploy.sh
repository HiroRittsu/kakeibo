#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

VITE_API_BASE_URL="https://api.zq1012noza.workers.dev"
PAGES_PROJECT_NAME="${PAGES_PROJECT_NAME:-kakeibo-mobile}"
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

echo "[2/4] Deploy API Worker"
npm run deploy --prefix apps/api

echo "[3/4] Build mobile with VITE_API_BASE_URL=${VITE_API_BASE_URL} VITE_APP_VERSION=${DEPLOY_VERSION}"
VITE_API_BASE_URL="$VITE_API_BASE_URL" VITE_APP_VERSION="$DEPLOY_VERSION" npm run build --prefix apps/mobile

echo "[4/4] Deploy mobile to Cloudflare Pages (${PAGES_PROJECT_NAME})"
"$WRANGLER_BIN" pages deploy apps/mobile/dist --project-name "$PAGES_PROJECT_NAME" --commit-dirty=true

echo "Deploy finished."
