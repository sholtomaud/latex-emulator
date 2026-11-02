# 0014: Code listings (`listings`)

## Context

Roadmap step 10a: program code with the `listings` package, which is what
most LaTeX documents use. Its output looks quite unlike a code block in a
browser. It uses roman type in fixed 0.6em columns, italic comments, bold
keywords, OT1 glyphs (`"` prints as ”) and its own spacing rules. Matching
pdflatex means emulating listings, not styling a `<pre>`.

## Decision

- **Parsing.** The lexer captures `lstlisting` raw, like `verbatim`, with
  its `[options]`. The rest of the `\begin` line is dropped, as listings
  does. `\lstinline[opts]<d>…<d>` and `\lstinline{…}` become `verb` nodes
  named `lstinline`. The AST gains two optional fields, `options` and
  `name`.
- **Languages are generated, not hand-written.**
  `scripts/make-lst-languages.ts` reads TeX Live's `lstlang1–3.sty` (LPPL),
  resolves dialect inheritance (`[ISO]C++` → `[ANSI]C`, default dialects
  from `listings.cfg`) and writes `src/latex/listings/languages.ts`. That
  file holds keyword classes, case sensitivity, comments, strings, C
  directives and TeX control sequences for 18 languages: Python, C, C++,
  Java, R, Matlab, Octave, bash, sh, SQL, TeX, LaTeX, Haskell, Ruby, Perl,
  PHP, Go and Fortran. It is about 27 KB gzipped and is its own chunk. The
  preview loads it only when a document uses listings. Another language,
  or HTML/XML (listings' tag mode), is shown unhighlighted with a warning.
- **The lexer follows listings.** `src/latex/listings/lexer.ts` forms output
  units the way listings does:
  - a run of letters (digits join it), or a run of other characters, is one
    unit (`\lst@AppendLetter`, `\lst@AppendOther`, `\lst@ProcessDigit`);
  - comments and strings: the longest delimiter wins; `[b]`/`[d]`/`[m]`
    escapes; block comments may span lines;
  - tabs move to the next tab stop;
  - spaces in strings become visible spaces.
- **Options** (`options.ts`) start from listings' defaults:
  - `basewidth={0.6em,0.45em}`, `columns=[c]fixed`;
  - `keywordstyle=\bfseries`, and `commentstyle=\itshape` (the `EmptyStyle`
    hook);
  - `showstringspaces`, tabsize 8.

  `\lstset`, `\lstdefinestyle`/`style=` and a listing's own options then
  apply in order. Style values become font switches. Keys we don't emulate
  raise `syntax/unsupported-listings-option`, pointing at the `\begin` line,
  and are ignored: `breaklines`, `escapeinside`, `aboveskip`, `upquote`,
  `\color`, and others.
- **Layout** (`src/render/listings.ts`):
  - **Fixed columns.** Each unit is a box n × basewidth wide. Each
    character's left margin comes from the Computer Modern widths, as
    `\lst@FillFixed`'s `\hss` share it. That includes negative shares when
    a bold or italic character overflows its column. The widths come from
    `scripts/make-cm-metrics.ts`, which reads the TFMs; Latin Modern has
    the same metrics.
  - **basewidth's em is the font's quad** (`\fontdimen6`): 1.05em for cmtt
    and 1.15em for cmbx.
  - **Flexible columns** (`flexible`, `fullflexible`, and `\lstinline`,
    which sets `flexiblecolumns`) use listings' lost-space bookkeeping
    with natural widths from the same metrics. On `\lstinline|x = f(y)|`
    this places `=` at 157.36pt, against pdflatex's 157.34pt.
  - **OT1 glyphs.** In roman type, `"` prints as ”, `-` as − and `*` as ∗.
    cmtt has no bold, so pdflatex prints bold keywords in `\ttfamily` at
    medium weight; we do the same.
- **Spacing**, measured with `fixtures/listings-basic`:
  - `\medskipamount` above and below a listing;
  - `\smallskipamount` caption skips, with "Listing n:" numbered and
    `\@makecaption`-centred;
  - framed listings: the first baseline is `\lineskip` + framerule +
    framesep + 0.7 `\baselineskip` below the above-skip, and the next text
    follows the last line's 0.3 `\baselineskip` depth.
  - Frames are drawn as rules of exact thickness: the side rules on every
    line (as listings draws them), the top and bottom on the first and
    last lines.
  - Line numbers are zero-width boxes, `numbersep` from the line.

## Consequences

- `listings-basic` passes in the pinned image. All lines break where
  pdflatex breaks them. Prose is within 0.6pt; code lines start within
  0.02pt horizontally and 0.4pt (roman) or 0.8pt (framed typewriter)
  vertically.
- The fidelity spec's new code-line check measures baselines with a probe
  element. Glyph rects are rounded to whole pixels, which biases the older
  "top + 0.806em" measure by 0.6–1pt depending on font size. Moving the
  prose checks to the probe is in `docs/backlog.md`.
- Flexible columns in roman type depend on the metric tables. Kerns inside
  a unit are not counted (TeX counts them), so long units drift by a kern
  or two.
- The Monaco grammar still highlights the inside of `lstlisting` (and
  `verbatim`) as LaTeX.
