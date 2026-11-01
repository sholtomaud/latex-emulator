# 0010: Math as MathML Core, numbered displays and two-pass references

## Context

Roadmap step 8: typeset TeX math. AGENTS.md §4 rules out MathJax and KaTeX:
math is translated by our own code to MathML Core and rendered by the
browser with a self-hosted OpenType math font. Equation numbers, `\ref` and
`\eqref` need what LaTeX's `.aux` file provides.

## Decision

- **Translator** (`src/latex/math/mathml.ts`, pure). It works on the
  parser's AST, never on re-parsed source. Its output is a plain element tree
  that `to-dom.ts` creates with `createElementNS` and an allow-list of
  elements and attributes. `symbols.ts` is the math part of the registry:
  Greek, operators, relations, arrows, delimiters, big operators, functions,
  spacing, accents and the Unicode mathematical alphabets (`\mathbb` …).
  Unknown math commands become `<merror>` with a `math/unsupported-command`
  warning at their source range.
- **TeX semantics where MathML differs:**
  - Plain brackets are TeX Open/Close atoms: `form="prefix"`/`"postfix"`
    and `stretchy="false"`. Otherwise MathML infers "infix" mid-row and puts
    thick spaces around them.
  - Only `\left`/`\right` and matrix fences stretch.
  - Big operators and `\lim`-style functions take limits in displays.
  - Their `munder`/`mover` get TeX's `\bigopspacing5` kern (0.1em,
    TeXbook Appendix G rule 13a), which the OpenType MATH table lacks. This
    is done in CSS, class `limits`.
- **Parser fix:** in math, unknown commands no longer take a `[…]` optional
  argument. Before, `\left[ a \right]` swallowed the closing `$` and
  produced three syntax errors. `\sqrt` is registered with its real
  signature.
- **Displays** are CSS grids:
  - one column per `&` cell, so `align` columns line up across rows;
  - two flexible side columns, so the display is centred on the full line,
    as in LaTeX;
  - the number at the right margin on its row's baseline;
  - rows separated by `\jot` (3pt), with `\abovedisplayskip` and
    `\belowdisplayskip` from `size1x.clo`.

  `multline` numbers its last line; `\nonumber`/`\notag` skip a number and
  `\tag` replaces it.
- **Font:** Latin Modern Math, converted to WOFF2 (GUST Font License, like
  the text fonts). It has the same 806/−194 vertical metrics as LM Roman, so
  the ascent/descent overrides keep baselines aligned. The browser loads it
  only when a page shows math.
- **Two passes**, like `.aux`:
  - Pass 1 renders to learn where every `\label` points (LaTeX's
    `\@currentlabel`: section, equation row, enumerate item, footnote) and
    which TOC entries exist.
  - Pass 2 renders with them, so forward references work, and only its
    diagnostics are reported.
  - Undefined references print a bold `??` with a warning; the first of
    duplicate labels wins.
  - `\pageref` and TOC page numbers print `??` with an info note.
- **Standards mode.** The preview iframe was a bare `about:blank`, which is
  in quirks mode. That drops the line-height strut around inline math (and
  differs from real pages elsewhere). It now gets a `srcdoc` document with a
  doctype. The existing fidelity fixtures did not move.

## Consequences

- `math-basic` (pdflatex reference) is checked in the pinned CI image:
  - line breaks match;
  - equation numbers are within 0.5pt horizontally and 1pt vertically;
  - text around plain, `\sum` and `align` displays is within tolerance.
- **Known gap:** text after a display containing `\sqrt` sits a few points
  low. Chromium sets radicals and their scripts higher than TeX, and a CSS
  line box grows both ways for tall content where TeX's interline glue
  absorbs depth. It is a `knownPositionGaps` expected failure.
- Chromium builds differ in MathML layout. The host build used in
  development puts the `\sum` display about 2pt off in the other direction.
  The pinned image is the reference (CLAUDE.md).
- Every render runs twice. Typical documents stay well inside the 300ms
  preview budget, and moving rendering into the language worker (step 13)
  would remove the cost from the main thread.
- Not yet: `\intertext`, `alignat`, `split` numbering, equation numbering
  within sections (`\numberwithin`), `\eqref` hyperlinks, and `\boldsymbol`
  for non-Latin letters.
