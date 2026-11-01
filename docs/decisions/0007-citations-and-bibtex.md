# 0007: Citations, a BibTeX emulator and the .bib library

## Context

Step 6 of the roadmap: `\cite` and natbib, with a bibliography that looks
exactly like pdflatex + BibTeX output. We do not compile TeX (AGENTS.md §1),
and documents must stay standard LaTeX that compiles with pdflatex and the
named CTAN packages (§14 rule).

## Decision

- **Run real `.bst` styles.** `src/latex/bibtex/` is a BibTeX emulator: a
  `.bib` parser and an interpreter for the `.bst` stack language
  (`bibtex.web` semantics: `format.name$`, `purify$`, `change.case$`, line
  wrapping, crossref, sorting). It runs unmodified TeX Live styles, so any
  style a user knows behaves as it does in TeX Live. Ground truth is real
  bibtex: `scripts/make-bibtex-reference.sh` records its `.bbl` for every
  shipped style, and the unit tests require byte-for-byte equality.
- **Shipped styles** (`src/assets/bst/`, unmodified, licences in its
  README): `plainnat`, `unsrtnat`, `abbrvnat` (LPPL) and `plain`, `unsrt`,
  `abbrv`, `alpha` (free to redistribute unmodified). Each is its own lazy
  chunk; the preview waits for them only when a document has
  `\bibliography`. An unknown style falls back to `plainnat` with a
  warning.
- **natbib is emulated from natbib.sty, measured with pdflatex.** The pure
  formatter (`src/render/natbib.ts`) builds each citation as LaTeX, which
  the renderer then typesets. It follows natbib's rules, several of which
  contradicted first guesses and were measured:
  - default punctuation is round brackets and `;`; `\bibliographystyle{X}`
    applies natbib's `\bibstyle@X` (plainnat: `[ ]` and `,`) unless a
    punctuation option was given;
  - options run in natbib's declaration order, not the order written;
  - one `\bibitem` without an author–year label switches the whole
    document to numerical citations, where `\citet` prints a bold
    `(author?)`.
  Without natbib, `\cite` gives classic numbered `[1, p. 5]`.
- **Pass 1 like `.aux`.** The renderer first collects cited keys
  (`\nocite{*}` included) and the style, runs the emulator, cleans the
  `.bbl` (drops the `\providecommand` preamble and `\penalty0`), and reads
  the `\bibitem` labels. Pass 2 renders citations and, at `\bibliography`,
  the generated `thebibliography`. Undefined keys print a bold `?` and raise
  `ref/undefined-citation` at the citation.
- **The library holds `.bib` files, not records.** `\bibliography{a,b}`
  reads `a.bib` and `b.bib` from an IndexedDB store (`bibFiles`, database
  version 3), exactly as LaTeX resolves file names. Users import, download
  and delete them in the explorer; a missing file raises
  `ref/missing-bib-file`. Keeping the user's own `.bib` text means a project
  export stays a standard LaTeX + BibTeX project. First run seeds a
  `references.bib` (keys in `author_topic_year` form); deleting it is
  remembered.
- **Layout from the class sources.** Author–year entries hang by natbib's
  `\bibhang` (1em); numbered labels sit in a box the width of
  `\@biblabel{#1}`, computed in `ch` (Latin Modern digits are 1ch, brackets
  0.556ch). `\newblock` adds natbib's `.11em` to the interword space. Item
  spacing is `\bibsep`, equal to `\@listi`'s `\itemsep + \parsep`.

## Consequences

- The `natbib-basic` fixture matches pdflatex's positions (within 0.5pt
  horizontally and 1pt vertically). Its **line breaks do not match**:
  pdflatex fits those lines by shrinking interword glue almost to its limit
  and hyphenates with TeX's patterns ("trans-formity"). Greedy CSS line
  breaking can't do either; no single `word-spacing` value fits both
  fixtures. The check runs as an expected failure until Knuth–Plass lands
  (Tier 3, a Rust/WASM candidate).
- A document starting with a heading now has no space above it, because
  TeX discards glue at the top of a page. This applies to every document,
  not only bibliographies.
- Superscript citations (natbib's `super` option, the `nature` style) are
  not emulated yet.
- DOI/URL lookup, reference cleaning, key generation and Zotero build on
  this library in later steps; they add entries to a named `.bib` file
  rather than introducing new LaTeX syntax.
