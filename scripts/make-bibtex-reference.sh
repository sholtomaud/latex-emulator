#!/usr/bin/env sh
# Record what real bibtex produces for fixtures/bibtex/test.bib with each
# style, as ground truth for the BibTeX emulator's unit tests:
#   fixtures/bibtex/expected/<style>.bbl
# Needs TeX Live (bibtex, plainnat/plain/unsrt .bst). Commit the outputs.
set -eu
cd "$(dirname "$0")/../fixtures/bibtex"
mkdir -p expected styles
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp test.bib probe.bst "$WORK/"
for style in plainnat plain unsrt probe; do
  sed "s/STYLE/$style/" cite-all.tex > "$WORK/doc.tex"
  # \citation{*} in the .aux is all bibtex needs; no pdflatex required.
  printf '\\citation{*}\n\\bibstyle{%s}\n\\bibdata{test}\n' "$style" > "$WORK/doc.aux"
  (cd "$WORK" && bibtex -terse doc >/dev/null 2>&1 || true)
  cp "$WORK/doc.bbl" "expected/$style.bbl"
  if [ "$style" != probe ]; then cp "$(kpsewhich "$style.bst")" "styles/$style.bst"; fi
done
bibtex --version | head -1 > expected/bibtex.version
echo "Updated fixtures/bibtex/expected"
