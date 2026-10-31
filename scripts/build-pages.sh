#!/usr/bin/env sh
# Build the site for GitHub Pages (a project site served from /<repo>/).
#   PAGES_BASE  sub-path the site is served from   (default /latex-emulator/)
#   PAGES_OUT   staging root                         (default .pages)
# The deployable artifact is $PAGES_OUT$PAGES_BASE. A copy of 404.html is also
# placed at the staging root so `serve $PAGES_OUT` behaves like Pages locally.
set -eu
cd "$(dirname "$0")/.."
BASE="${PAGES_BASE:-/latex-emulator/}"
OUT="${PAGES_OUT:-.pages}"
SITE="$OUT$BASE"

rm -rf "$OUT"
npx vite build --base "$BASE" --outDir "$SITE" --emptyOutDir
# SPA fallback: Pages serves 404.html for unknown paths; with an absolute
# base it can be the app itself, and the router shows the right page.
cp "$SITE/index.html" "$SITE/404.html"
touch "$SITE/.nojekyll"
cp "$SITE/404.html" "$OUT/404.html"
echo "Pages site built in $SITE"
