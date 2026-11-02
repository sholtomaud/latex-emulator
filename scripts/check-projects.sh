#!/usr/bin/env sh
# Compile every project folder in <dir> (from scripts/export-projects.ts) the
# way a LaTeX user would, and fail if any of them doesn't build cleanly:
#   scripts/check-projects.sh <dir>
# pdflatex, then bibtex when the document has a \bibliography, then pdflatex
# twice. A folder fails on a LaTeX or BibTeX error, a missing file, or an
# undefined citation or reference. Needs TeX Live (ADR 0015, phase A).
set -eu
DIR="$1"
failed=0
for project in "$DIR"/*/; do
  name=$(basename "$project")
  tex="$name.tex"
  log="$project/$name.log"
  latex() {
    (cd "$project" && pdflatex -interaction=nonstopmode -halt-on-error "$tex" >/dev/null)
  }
  if ! latex; then
    echo "✗ $name: pdflatex failed"
    grep -A3 '^!' "$log" | head -20 || true
    failed=1
    continue
  fi
  if grep -q '\\bibdata' "$project/$name.aux"; then
    if ! (cd "$project" && bibtex "$name" >/dev/null); then
      echo "✗ $name: bibtex failed"
      cat "$project/$name.blg"
      failed=1
      continue
    fi
  fi
  if ! latex || ! latex; then
    echo "✗ $name: pdflatex failed"
    grep -A3 '^!' "$log" | head -20 || true
    failed=1
    continue
  fi
  if grep -E "(Citation|Reference) .* undefined|There were undefined|File .* not found" "$log"; then
    echo "✗ $name: undefined citations or references, or a missing file"
    failed=1
    continue
  fi
  echo "✓ $name"
done
exit $failed
