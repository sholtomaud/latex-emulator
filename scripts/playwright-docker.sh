#!/usr/bin/env sh
# Run Playwright inside the same pinned container image CI uses: the same
# Chromium build and fonts (so visual snapshots match CI pixel-for-pixel),
# and the test browser kept off the host machine (ADR 0017).
# node_modules lives in a Docker volume so the host's (e.g. macOS) install is
# never overwritten with Linux binaries.
#   scripts/playwright-docker.sh test --project=visual [--update-snapshots]
# Arguments reach Playwright with their quoting intact (-g "two words").
# PAGES_URL is passed through (the pages suite against a live site), and a
# NODE_EXTRA_CA_CERTS bundle (e.g. behind a TLS-inspecting proxy) is mounted
# for npm ci.
set -eu
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').devDependencies['@playwright/test'].replace(/[\^~]/g, '')")
IMAGE="mcr.microsoft.com/playwright:v${VERSION}-noble"
RUN='npm ci --no-audit --no-fund >/dev/null && exec npx playwright "$@"'

if [ -n "${NODE_EXTRA_CA_CERTS:-}" ] && [ -f "${NODE_EXTRA_CA_CERTS}" ]; then
  exec docker run --rm --ipc=host \
    -v "$PWD":/work -w /work \
    -v latex-emulator-node-modules:/work/node_modules \
    -v "${NODE_EXTRA_CA_CERTS}":/extra-ca.crt:ro \
    -e NODE_EXTRA_CA_CERTS=/extra-ca.crt -e npm_config_cafile=/extra-ca.crt \
    -e CI="${CI:-}" ${PAGES_URL:+-e PAGES_URL="$PAGES_URL"} \
    "$IMAGE" sh -c "$RUN" playwright "$@"
fi
exec docker run --rm --ipc=host \
  -v "$PWD":/work -w /work \
  -v latex-emulator-node-modules:/work/node_modules \
  -e CI="${CI:-}" ${PAGES_URL:+-e PAGES_URL="$PAGES_URL"} \
  "$IMAGE" sh -c "$RUN" playwright "$@"
