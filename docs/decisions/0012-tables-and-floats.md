# 0012: Tables, floats and captions

## Context

Roadmap step 9a: `tabular` (with `booktabs`), the `table` float and
`\caption`. The output has to match pdflatex closely enough to pass the
print-fidelity check (`fixtures/table-basic`). Work on that fixture also
showed that our ties (`~`) were too wide, which affects every document.

## Decision

- **Pure parsing, HTML tables.** `src/render/tabular.ts` reads the column
  spec: `l c r`, `p/m/b{width}`, `|`, `||`, `@{…}`, `!{…}` and `*{n}{…}`.
  It also splits the body into rows of cells and rule rows: `\hline`,
  `\cline`, `\toprule`, `\midrule`, `\bottomrule` and `\cmidrule(lr){a-b}`,
  with `\multicolumn` spans. `src/render/lengths.ts` converts TeX lengths,
  including fractions of `\textwidth`, to CSS points. The renderer emits an
  ordinary `<table>`, with one physical column for each spec column
  (`|` rules and `@{}` separators included). Rules are therefore cells or
  rows of exact width or height, not CSS borders, which Chromium rounds up
  to a device pixel. `>{…}`, `<{…}` and unknown column letters raise a
  `syntax/unsupported-column` warning, and their cells still render.
- **TeX's numbers, cited in `base.css`.** They come from article.cls,
  size1x.clo, latex.ltx and booktabs.sty:
  - `\tabcolsep`, `\arrayrulewidth`, `\doublerulesep`, `\intextsep`,
    `\abovecaptionskip`;
  - the `\@arstrut` row strut (0.7/0.3 `\baselineskip`);
  - the booktabs rule widths and separations.
- **Floats stay where they are written.** We don't move floats to the top of
  the page or to their own page. That would need our own paginator (step 13).
  A float is set as `[h]` places it, with the output routine's spacing
  (latex.ltx `\@addtocurcol`):
  - there is no interline glue above it: its top is the previous line's
    depth plus `\intextsep`;
  - the paragraph after it keeps the `\prevdepth` from before the float.
  `\caption` numbers `Table n`/`Figure n` (counted separately), sets the
  `\label` target, and is centred when it fits on one line. A longer caption
  becomes a justified paragraph, as `\@makecaption` does. The space after
  the colon includes TeX's extra space (a colon's `\sfcode` is 2000).
  `\caption` outside a float is an error, and the caption is still shown.
- **Ties are interword spaces.** Latin Modern's U+00A0 is 0.5em wide, but
  TeX's `~` is the font's interword space (0.333em in LM Roman 10). We ship
  our own tiny fonts (`tie-<width>.ttf`, 768 bytes each, made by
  `scripts/make-tie-fonts.ts`; a unit test checks the committed files
  against the generator). Each has one blank U+00A0 glyph with the advance
  of a Latin Modern face's space. They are declared after each face with
  `unicode-range: U+00A0`, so the browser takes the no-break space from
  them. This keeps the no-break behaviour and gives the tie TeX's width.
  These fonts are not modified Latin Modern files.
  - Vite would inline files this small as `data:` URLs, and the CSP's
    `font-src 'self'` blocks those. Font URLs are imported with
    `?url&no-inline`, which keeps the CSP unchanged.
  - Chromium's font sanitiser (OTS) rejects a zero-length `glyf` table, so
    the fonts carry four unused bytes there.

## Consequences

- `table-basic` matches pdflatex on the host and in the pinned image: line
  breaks, and line starts within 0.5pt (1pt for centred captions and for
  centred or right-aligned cells). The CI browser rounds text-run widths to
  whole device pixels, which moves those starts by up to about 0.7pt. The
  fixture's first paragraph was reworded: as first written, it needed close
  to TeX's maximum interword shrink, which CSS can't reproduce (the
  Knuth–Plass gap in AGENTS §7).
- A float with no blank line before it stays inside its paragraph in
  LaTeX: the float is set after the current line, and the paragraph goes
  on after it. We end the paragraph at the float instead. Documents written
  with blank lines around floats, the usual style, are unaffected.
- The math and bibliography visual baselines changed, intentionally: their
  ties are now TeX's width.
- Still to do in step 9: `figure` with `\includegraphics`, an image store,
  and booktabs `\addlinespace` and `\specialrule`.
