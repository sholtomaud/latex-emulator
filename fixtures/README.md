# Fixtures

Each folder is one LaTeX document plus what real `pdflatex` makes of it:

| File | What |
|---|---|
| `input.tex` | The source |
| `reference.pdf` | `pdflatex` output (two runs) |
| `reference-page-N.png` | Each page rasterised at 96 dpi (`pdftoppm -r 96`) |
| `reference-lines.json` | Every text line's bounding box in PDF points (`pdftotext -bbox-layout`), from the page's top-left |
| `reference.version` | The `pdflatex` version that produced them |
| `images/` | Optional: figures the document includes (`\graphicspath{{images/}}`); the fidelity spec adds them to the document's Images first |

Regenerate with (needs TeX Live and poppler-utils):

```bash
scripts/make-reference.sh fixtures/<name>
```

Never hand-edit the reference files. If a reference changes, say why in the
commit message. The print-fidelity specs (`e2e/specs/print-fidelity.spec.ts`)
compare our rendering of each `input.tex` against `reference-lines.json`.
