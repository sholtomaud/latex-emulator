#!/usr/bin/env sh
# Run Playwright inside the same pinned container image CI uses, so visual
# snapshots match CI pixel-for-pixel (same Chromium build, same fonts).
# node_modules lives in a Docker volume so the host's (e.g. macOS) install is
# never overwritten with Linux binaries.
#   scripts/playwright-docker.sh test --project=visual [--update-snapshots]
set -eu
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').devDependencies['@playwright/test'].replace(/[\^~]/g, '')")
exec docker run --rm --ipc=host \
  -v "$PWD":/work -w /work \
  -v latex-emulator-node-modules:/work/node_modules \
  -e CI="${CI:-}" \
  "mcr.microsoft.com/playwright:v${VERSION}-noble" \
  sh -c "npm ci --no-audit --no-fund >/dev/null && npx playwright $*"
