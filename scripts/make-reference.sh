#!/usr/bin/env sh
# Regenerate a fixture's pdflatex reference outputs:
#   scripts/make-reference.sh fixtures/<name>
# Runs BibTeX too when the fixture has .bib files; copies an images/ folder. Produces reference.pdf,
# reference-page-N.png (96 dpi) and reference-lines.json
# (every text line's bounding box in PDF points, from `pdftotext -bbox-layout`).
# Requires TeX Live (pdflatex) and poppler-utils. Commit the outputs.
set -eu
DIR="$1"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp "$DIR/input.tex" "$WORK/"
# A fixture with .bib files gets the full BibTeX cycle.
cp "$DIR"/*.bib "$WORK/" 2>/dev/null || true
# Figures live in the fixture's images/ folder (\graphicspath{{images/}}).
if [ -d "$DIR/images" ]; then cp -r "$DIR/images" "$WORK/"; fi
run() { (cd "$WORK" && pdflatex -interaction=nonstopmode -halt-on-error input.tex >/dev/null); }
run
if ls "$WORK"/*.bib >/dev/null 2>&1; then
  (cd "$WORK" && bibtex input >/dev/null)
  run
fi
run
cp "$WORK/input.pdf" "$DIR/reference.pdf"
rm -f "$DIR"/reference-page-*.png
pdftoppm -r 96 -png "$DIR/reference.pdf" "$DIR/reference-page"
pdftotext -bbox-layout "$DIR/reference.pdf" "$WORK/bbox.html"
node "$(dirname "$0")/bbox-to-json.mjs" "$WORK/bbox.html" > "$DIR/reference-lines.json"
pdflatex --version | head -1 > "$DIR/reference.version"
echo "Updated references in $DIR"
