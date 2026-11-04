# 0018: The elsarticle class (Elsevier)

## Context

Roadmap step 11: documents written for Elsevier journals with
`\documentclass{elsarticle}`, checked against pdflatex. elsarticle.cls
loads article and then changes:

- the front matter (a `frontmatter` environment with labelled authors and
  addresses, title-page notes, an abstract and keywords between rules);
- the headings ("1. Introduction", italic subsections, other skips);
- the first-page footer ("Preprint submitted to …");
- citations (it loads natbib itself);
- its geometry in the journal modes.

It also ships its own BibTeX styles.

## Decision

Phase A (this PR) is the class's default `preprint` mode. Elsevier's
template uses `[preprint,12pt]`.

- **Recognised class.** `elsarticle` joins `SUPPORTED_CLASSES`. Options
  (`src/latex/classes/elsarticle.ts`, pure):
  - `preprint` (the default), `review`, `final`, `1p`, `3p` and `5p` are
    read;
  - `10pt`/`11pt`/`12pt` and the paper size go to article's geometry;
  - natbib comes with `[numbers]`, or `[round,authoryear]` with
    `authoryear`, plus `\biboptions{…}`; `nonatbib` turns it off.

  `\ExecuteOptions{a4paper,…}` does nothing, because elsarticle never
  declares `a4paper`, so the default paper is **letter**, as pdflatex
  shows.
- **Front matter** (`elsFrontmatter`, pure). The model holds:
  - title, authors and their superscripts in the class's order
    (affiliation letters, then `\fnref` numbers, then the `\corref` star),
    with letters from the order of the labelled `\address`/`\affiliation`
    commands (the class's `.aux` round trip);
  - `\affiliation{organization=…, city=…, country=…}` joined by commas, with
    none after the country;
  - `\ead` and `\ead[url]` attached to the author before them;
  - `\cortext` (∗, ∗∗), `\tnotetext` (⋆) and `\fntext` (1, 2…);
  - the abstract, and the keywords split at `\sep`.

  The renderer sets it as `\pprintMaketitle` does. The title-page notes
  (`\printFirstPageNotes`: title notes, corresponding author, "Email
  address:", URLs, then numbered notes) become the first footnotes,
  collected at the end like all footnotes (ADR 0003). `\fntext` numbers
  continue into the body's footnotes.
- **Spacing**, from elsarticle.cls and measured with
  `fixtures/elsarticle-basic`:
  - 18pt after the title, 10pt before the addresses, 36pt and a rule
    before the abstract, 12pt after a rule, 10pt after the abstract and
    the keywords;
  - the unboxed abstract and keywords bring no interline glue, so those
    skips run from a line's depth to the next line's height;
  - sections 18/9pt, subsections 12/3pt, subsubsections 12/1pt, in the
    normal size;
  - the number is followed by "." and `\hskip 0.5em` in the heading font's
    quad (cmbx 1.125/1.15, cmti 1/1.0222);
  - elsarticle's positive heading skips keep the next paragraph's indent
    (`\@startsection` only drops it for negative skips).
- **First-page footer.** `\ps@pprintTitle` puts "Preprint submitted to
  <journal>" (or "Elsevier") at the left and the date at the right, in
  `\footnotesize\itshape`, with no page number. `firstPageFooterCss` makes
  it `@page :first` margin boxes on the page number's baseline. On the
  first page it takes the place of the app's Download Preprint stamp
  (ADR 0006), which stays on the other pages.
- **The 10pt design for small text.** TeX sets `\footnotesize` (10pt in a
  12pt document) in cmr10/cmti10, not the 12pt design. The addresses, the
  footnotes and the footer now use LM Roman 10 whatever the document size;
  LM Roman 12 is about 2% narrower, which moved centred addresses by 2–3pt.
- **Unsnapped glyph advances where it matters.** The addresses use
  `text-rendering: geometricPrecision`. Without it the CI browser rounds
  each glyph advance to a whole pixel and long centred lines move by up to
  1.5pt. With it, the pinned image measures what the host does.
- **Bibliography styles.** `elsarticle-num`, `elsarticle-num-names` and
  `elsarticle-harv` (LPPL, unmodified) are shipped. The BibTeX emulator
  matches real bibtex byte for byte on all three with no emulator changes.

## Consequences

- `elsarticle-basic` passes in the pinned image:
  - every line breaks where pdflatex breaks it;
  - every checked line is within 0.6pt horizontally (centred addresses
    −0.5pt) and 0.9pt vertically, the title block included.

  One fixture sentence was shortened: as first written, its line needed
  TeX's interword shrink (the known Knuth–Plass gap).
- The title-page notes are at the end of the document, not at the foot of
  page 1, until there is on-screen pagination (ADR 0003).
- CI's LaTeX-projects job installs `texlive-publishers`, so the exported
  elsarticle project compiles there.
- Later phases (in `docs/backlog.md`):
  - `review` (1.5 line spacing);
  - `1p`/`3p` geometry (the geometry package values in elsarticle.cls,
    two-sided);
  - elsarticle's own list spacing and `\newtheorem`/`\newproof`/
    `\newdefinition`;
  - captions in `\footnotesize`;
  - `5p` (two columns);
  - `highlights` and `graphicalabstract`;
  - `\tnoteref` on the title.
