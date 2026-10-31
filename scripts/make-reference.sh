#!/usr/bin/env sh
# Regenerate a fixture's pdflatex reference outputs:
#   scripts/make-reference.sh fixtures/<name>
# Produces reference.pdf, reference-page-N.png (96 dpi) and reference-lines.json
# (every text line's bounding box in PDF points, from `pdftotext -bbox-layout`).
# Requires TeX Live (pdflatex) and poppler-utils. Commit the outputs.
set -eu
DIR="$1"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp "$DIR/input.tex" "$WORK/"
(cd "$WORK" && pdflatex -interaction=nonstopmode -halt-on-error input.tex >/dev/null \
  && pdflatex -interaction=nonstopmode -halt-on-error input.tex >/dev/null)
cp "$WORK/input.pdf" "$DIR/reference.pdf"
rm -f "$DIR"/reference-page-*.png
pdftoppm -r 96 -png "$DIR/reference.pdf" "$DIR/reference-page"
pdftotext -bbox-layout "$DIR/reference.pdf" "$WORK/bbox.html"
node "$(dirname "$0")/bbox-to-json.mjs" "$WORK/bbox.html" > "$DIR/reference-lines.json"
pdflatex --version | head -1 > "$DIR/reference.version"
echo "Updated references in $DIR"
