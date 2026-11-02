# Backlog

The working list of what is open, so any session (human or agent) can pick
the work up. AGENTS.md §14 is the roadmap; ADRs in `docs/decisions/` record
why things are the way they are. This file tracks what is **not done yet**.
Update it in the same PR that starts, finishes or defers an item.

## In progress

### Roadmap step 10a: `listings` (branch `claude/funny-faraday-ybhxy9`, ADR 0014 to write)

Done so far (unit-tested, `npm test` green):

- Lexer/parser: `lstlisting` captured raw with its `[options]` (rest of the
  `\begin` line dropped); `\lstinline[opts]|…|` and `\lstinline{…}` as `verb`
  nodes with `name: 'lstinline'` (`src/latex/lexer/lexer.ts`, AST fields
  `options`, `name`).
- `src/latex/listings/`: generated language data (`languages.ts`, from
  `scripts/make-lst-languages.ts`: 18 languages), the listings lexer
  (`lexer.ts`: listings' letter/other runs, comments, strings, directives,
  texcs, tabs, visible spaces), options (`options.ts`: `\lstset`,
  `\lstdefinestyle`, `style=`, fonts, numbers, frame, columns, caption…),
  CM metrics (`cm-metrics.ts`, from `scripts/make-cm-metrics.ts`).
- `src/render/listings.ts`: fixed columns (units n × basewidth, characters
  spread like `\lst@FillFixed`), flexible/fullflexible lost-space model,
  OT1 roman glyphs, numbers; wired into `render-document.ts` (captions
  "Listing n:", labels, `\lstinline`, diagnostics); preview lazy-loads the
  language chunk (`src/render/lst-languages.ts`); `to-dom.ts` style
  allow-list per declaration.
- Fixture `fixtures/listings-basic` with pdflatex references.

Still to do, in order:

1. Findings from the fixture to apply:
   - default `commentstyle` is `\itshape` (lstmisc.sty `EmptyStyle` hook);
   - basewidth's em is the basic font's **quad** (cmtt 1.05, cmbx 1.15),
     use `CM_METRICS[...].quad`;
   - `\lstinline` adds `flexiblecolumns` (listings.sty `\lstinline`);
   - flexible columns in roman need natural widths from `CM_METRICS`
     (verified: inline `x = f(y)` puts `=` at 157.36pt vs 157.34pt).
2. CSS in `base.css`: `.lstlisting`/`.lst-code` containers, `.lst-line`
   (no indent, `white-space: pre`, `word-spacing: normal`), `.lst-u`
   (inline-flex, `justify-content: space-evenly`; `.l`/`.r` variants),
   `.lst-sp`, `.lst-vs` (cmtt ␣ / cmr "suppress" stroke drawn in CSS),
   `.lst-num` (normalfont, right edge at `--lst-numbersep` left of the
   line), frames (`--lst-framesep`, `--lst-framerule`), captions
   (`\abovecaptionskip`/`\belowcaptionskip` = `\smallskipamount` 3pt),
   `aboveskip`/`belowskip` = `\medskipamount` 6pt. Measure every value with
   the fixture.
3. `print-fidelity.spec.ts`: a `codeLines` check (first glyph of each
   `.lst-line` vs the reference line), skip `.lst-line` in the line-break
   walk; add the `listings-basic` entry.
4. e2e (lazy language load, `\lstinline`, diagnostics), visual baseline
   `preview-listings.png` in the pinned image, Monarch grammar: no LaTeX
   highlighting inside `lstlisting`.
5. ADR 0014, AGENTS §6/§14, PR.

## Next

- **Step 10b: `algorithm` + `algpseudocode`** (`algorithmic`, `\State`,
  `\If`/`\ElsIf`/`\Else`, `\For`, `\While`, `\Procedure`, `\Function`,
  `\Require`/`\Ensure`, `\Comment`, line numbers), the `algorithm` float
  (float.sty `ruled` style), measured against pdflatex.
- Steps 11–13 of AGENTS §14 (elsarticle, the starter-document tour, the
  language worker and the rest).

## Deferred follow-ups (from ADRs and PRs)

- Listings: HTML/XML (tag mode), `breaklines`, `escapeinside`,
  `\lstinputlisting`, `aboveskip`/`belowskip` keys, `upquote`, `\color`
  styles (no xcolor yet), `\lstlistoflistings`.
- Figures (ADR 0013): `\includegraphics{` typeahead; an "Add image…" quick
  fix for a missing image (needs command-style fixes beyond ADR 0011's text
  edits); Exif resolution; Zotero attachments; project zip export with each
  document's Images folder.
- Tables (ADR 0012): floats without a blank line before them (LaTeX keeps
  the paragraph going); booktabs `\addlinespace`, `\specialrule`; floats
  only ever placed where written.
- Fidelity gaps declared in `print-fidelity.spec.ts`: `natbib-basic` line
  breaks (needs Knuth–Plass), `math-basic` after a `\sqrt` display.
- Documents (ADR 0005): say in the UI that documents live only in this
  browser until export/sync exists.
- Versions (ADR 0006): pruning or export of versions.
- Zotero (ADR 0009): collections, more than 25 results, two-way sync; still
  to verify by hand against a real Zotero (local API CORS, Chrome's
  local-network prompt) and the live doi.org lookup.
