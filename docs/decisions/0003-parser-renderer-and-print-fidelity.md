# 0003: Parser, renderer, and measuring print fidelity against pdflatex

## Context

The emulator must turn LaTeX into a page a reader can't tell from `pdflatex`
output, without running TeX, using only browser layout and printing.

## Decision

- **Lossless lexer and error-tolerant parser** (`src/latex/`). Every node has
  a UTF-16 source range. The parser never throws, always returns a tree, and
  reports problems as diagnostics. Argument signatures come from a single
  command registry. Single `$` tokens are paired by the parser, as TeX does.
- **Pure renderer** (`src/render/render-document.ts`) producing a small
  `HNode` tree, not DOM. It runs in Node for unit tests (coverage gate);
  `to-dom.ts` builds elements with `createElement`/`setAttribute`/text nodes
  only, against a tag and attribute allow-list.
- **Class geometry from source.** `article.ts` re-implements the arithmetic in
  `size1x.clo`, and tests check it against the `pdflatex` reference (for
  example, the A4/11pt text block is at 117.83bp).
- **Fonts.** Latin Modern, at the optical sizes LaTeX uses, with pinned
  ascent/descent overrides so the baseline model holds on every platform.
- **Spacing model.** Margins are arranged so that collapsing reproduces TeX's
  baselineskip rule (see the top of `styles/document/base.css`).
- **Fidelity is measured, not eyeballed.** `fixtures/article-basic` holds real
  `pdflatex` output. CI checks line breaks and line positions against it. A
  one-off check of an actual Chromium-printed PDF found the same 25 lines,
  body text within ~0.1pt horizontally and <1pt vertically
  (`docs/fidelity-article-basic.png`).
- **Footnotes** are collected at the end of the document under a
  `\footnoterule`. CSS footnote floats are not reliably supported, and true
  page-bottom placement needs our own paginator.
- Chromium is the reference print engine.

## Consequences

- New constructs need a registry entry, unit tests and, for layout, a fixture
  line in the fidelity spec.
- Line breaking is still the browser's. The `word-spacing` approximation of
  TeX's shrink works for the fixture; more fixtures will show where it doesn't,
  which is the case for Knuth–Plass in Rust/WASM.
- The itemize bullet comes from LM Roman, not cmsy, so it is slightly smaller
  than pdflatex's.
- Printing from the browser menu (rather than the button or Cmd/Ctrl+P)
  prints the app page, not the document.
