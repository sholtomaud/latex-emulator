# 0016: Pseudocode (`algorithm` + `algpseudocode`)

## Context

Roadmap step 10b. Papers set pseudocode with the `algorithmicx` bundle's
`algpseudocode` layout inside the `algorithms` bundle's `algorithm`
float. Its look is quite specific, and a reader would notice a generic
indented list:

- bold keywords;
- small-type line numbers ending in a colon;
- comments pushed to the right margin after a ▷;
- rules above and below the float and under its caption.

Every value below was read from TeX Live 2023's `algorithmicx.sty`,
`algpseudocode.sty`, `algorithm.sty` and `float.sty`, or measured with
`\showlists` in pdflatex. These are the same files `fixtures/algorithm-basic`
was compiled with. On Debian and Ubuntu they are in `texlive-science`,
which CI installs.

## Decision

### Parsing: ordinary LaTeX, no new AST shape

Unlike `lstlisting`, the body of `algorithmic` is normal LaTeX: math,
`\textbf`, `\ref` and so on. The parser already produces a flat child
list of commands (`\State`, `\If{…}`, …) and inline content. A **pure**
pass, `src/latex/algorithmic/lines.ts`, turns that list into lines:

```ts
interface AlgLine {
  label: 'require' | 'ensure' | 'none';
  number: number | null; // printed number, or null
  line: number; // ALG@line: what \label refers to here
  depth: number; // in \algorithmicindent units
  parts: AlgPart[]; // keyword | text | user nodes | \textproc name
  comment: Node[] | null; // \Comment{…} and anything after it
  range: Range;
}
```

It reports unbalanced blocks as `syntax/unbalanced-algorithmic` errors,
pointing at the command. Unbalanced blocks are an `\EndWhile` with no
`\While`, an `\Else` outside an `\If`, an `\ElsIf` after `\Else`, a block
still open at `\end{algorithmic}`, and text before the first `\State`.
The lines are still produced, so the preview never blanks. A wrong end
closes the block it names and reports the inner ones.

The registry gains the environments `algorithm` (a float, `o` for the
placement) and `algorithmic` (`o` for the numbering step). It also gains
the commands, each with its arity and hover docs:

- statements: `\State`, `\Statex`, `\Require`, `\Ensure`, `\Return`,
  `\Call{name}{args}`, `\Comment{…}`;
- blocks: `\If`/`\ElsIf`/`\Else`/`\EndIf`, `\For`/`\ForAll`/`\EndFor`,
  `\While`/`\EndWhile`, `\Repeat`/`\Until`, `\Loop`/`\EndLoop`,
  `\Procedure`/`\EndProcedure`, `\Function`/`\EndFunction`.

`\Return` and `\Call` are rendered inline, so they work inside arguments
too, as in `\If{\Call{P}{x}}`.

### What each command prints (algpseudocode.sty)

| Command                              | Opens                               | Closes            |
| ------------------------------------ | ----------------------------------- | ----------------- |
| `\While{c}` … `\EndWhile`            | **while** c **do**                  | **end while**     |
| `\For{c}` … `\EndFor`                | **for** c **do**                    | **end for**       |
| `\ForAll{c}` … `\EndFor`             | **for all** c **do**                | **end for**       |
| `\Loop` … `\EndLoop`                 | **loop**                            | **end loop**      |
| `\Repeat` … `\Until{c}`              | **repeat**                          | **until** c       |
| `\If{c}` … `\EndIf`                  | **if** c **then**                   | **end if**        |
| `\ElsIf{c}`                          | **else if** c **then** (same depth) |                   |
| `\Else`                              | **else** (same depth)               |                   |
| `\Procedure{N}{a}` … `\EndProcedure` | **procedure** `\textsc{N}`(a)       | **end procedure** |
| `\Function{N}{a}` … `\EndFunction`   | **function** `\textsc{N}`(a)        | **end function**  |

Further details from the same file:

- `\Require` and `\Ensure` are `\item[\textbf{Require:}]`, a list label
  with no line number.
- `\Return` is **return** followed by a space.
- `\Call{N}{a}` is `\textsc{N}(a)`. The parentheses are left out when `a`
  is empty, which also holds for `\Procedure` and `\Function`.
- `\Comment` is `\hfill\(\triangleright\) #1`, with nothing to end it, so
  anything after it on the line is set after the comment's text.
- The `noend` package option drops the closing lines (`\algtext*`). They
  take no number. `\Until` is not one of them.
- `\ALG@step`: every statement counts; with `[n]`, every n-th is
  numbered; `[0]`, the default, numbers none. `\@currentlabel` is the
  line number, so `\label` in a line refers to it.

### Layout (algorithmicx.sty, `\begin{algorithmic}`)

The environment is a `list`:

- `\itemsep`, `\parsep`, `\partopsep` and `\itemindent` are 0;
  `\topsep` is 0.2em.
- `\labelsep` is 0.5em. `\labelwidth` is 1.2em when numbered and 0.5em
  when not. `\leftmargin` is `\labelwidth` + `\labelsep`.
- `\hskip\ALG@tlm`, 1.5em per level, comes after the label. So in HTML
  the depth is a margin on the text span: only a wrapped statement's
  first line is indented, as in TeX.
- The number is `\alglinenumber{n}`, which is `\footnotesize n:`,
  right-aligned in `\labelwidth`. It is a box of no net width with
  line-height 0, like listings' numbers (ADR 0014).
- `\Require:` is wider than `\labelwidth`, so `\@item` sets it at its
  natural width from the line's start, then `\labelsep`.
- The comment is a right float. The `▷` is cmmi10's small
  `\triangleright`: 0.5em wide, from 0.035em to 0.465em. Latin Modern Math
  has nothing that small: U+25B7 spans −0.178em to 0.678em, and U+25B9,
  unicode-math's `\smalltriangleright`, is not in the font. The comment's
  triangle is therefore set at half size, raised and widened to cmmi's
  box. `\triangleright` elsewhere in math keeps the font's larger glyph.

### The float (algorithm.sty → float.sty `\fs@ruled`)

- `\@fs@pre` is `\hrule height.8pt \kern2pt`. `\@fs@mid` is
  `\kern2pt\hrule\kern2pt`. `\@fs@post` is `\kern2pt\hrule`, the default
  0.4pt. The rules are drawn as background gradients of exact thickness,
  because borders round to device pixels.
- The caption is `\floatc@ruled`: `{\bfseries Algorithm n} text\par`.
  It is left-aligned, with no colon, and always on top
  (`\@fs@iftopcapt`), wherever `\caption` is written. It has its own
  counter.
- **No interline glue after a rule.** An `\hrule` sets `\prevdepth` to
  −1000pt. So the caption's baseline sits its own height below the kern,
  and the first line's baseline its own height below the middle rule.
  Each rule sits the previous line's depth below its baseline. Those
  heights and depths come from the glyphs. `src/render/extent.ts`
  computes them from the TFMs, and the renderer passes them to the CSS
  as custom properties. The TFMs are cmr, cmbx, cmcsc and cmmi (generated
  into `cm-metrics.ts` with the widths), plus a few cmsy symbols. Script
  shifts follow TeX's sub1/sup2 rules. In the fixture the heights range
  from 0.694em (ascenders) to 0.75em (parentheses), and the depths from
  0 to 0.194em. A constant would miss by up to 2.1pt.
- **The body is a minipage** (`\@setminipage`), so its list gets no
  `\topsep` above. `\topsep` does come below, before `\@fs@post`.
- **`[H]`** (float.sty `\float@endH`) puts the box in the main list:
  `\vskip\intextsep`, the box, `\vskip\intextsep`. The box is taller than
  `\baselineskip`, so `\lineskip` (1pt) goes before it. After it
  `\prevdepth` is 0. Floats with `[H]` get an `H` class, tables and
  figures included. Other placements keep ADR 0012's `[h]` model. `[H]`
  without a caption keeps the middle rule, because `\@floatcapt` is
  `\vbox{}`, not void.
- **Label widths.** The browser rounds each glyph advance to a whole
  pixel. "Require:" came out 1.2pt wider than TeX's box, which moved the
  text after it. The bold labels ("Algorithm n", "Require:", "Ensure:")
  are set in boxes of their TFM width (`textWidth`), which matches
  pdflatex to 0.02pt.
- `\label` after `\caption` gives the algorithm's number.
  `\listofalgorithms` and the package's numbering options (`section`,
  `chapter`, …) are not emulated. The former warns as an unsupported
  command; the latter, like any package option the emulator doesn't
  read, are ignored.

### Fixture

`fixtures/algorithm-basic` (11pt, A4):

- a numbered Euclid algorithm with `\Require`, `\Ensure`, comments and a
  nested `\While`;
- an unnumbered algorithm with `\Function`, `\If`/`\ElsIf`/`\Else`,
  `\For`, `\Call` and `\Repeat`/`\Until`;
- prose before, between and after.

The floats use `[H]` with blank lines around them, so pdflatex places
them where written, on one page. A first draft with `[h]` and no blank
lines showed ADR 0012's known gaps instead: the paragraph ran on through
the float, and the second float moved to page 2. A later draft filled
the page so far that TeX shrank `\intextsep` (12pt minus 2pt) by 1.1pt.
The fixture now sets at its natural height (559pt of 596pt).

`print-fidelity.spec.ts` gains `algLines`. It checks each line's first
glyph against that word's own box: `bbox-to-json.mjs` now keeps
per-word `yMin`/`yMax`, because lines mix cmr, cmmi and cmsy. It also
checks each comment's right edge and the ▷'s left edge. `algBodies`
keeps the algorithm lines out of the line-break check.

## Consequences

- In the pinned CI image, every algorithm line starts within 0.03pt of
  pdflatex, comments end within 0.01pt, and captions are within 0.1pt.
  Baselines are within 0.8pt. That is the fixture's constant offset, the
  same on the prose before the first float.
- One known gap, asserted as an expected failure. The ▷ of a long
  comment starts 1.7pt off: the comment is flush right, so the ▷'s x is
  the comment's width from the margin, and rounded glyph advances add up
  over its 28 characters.
- `cm-metrics.ts` grows by heights and depths, and by cmcsc10 and cmmi10.
- `to-dom.ts` allows five more inline custom properties, each a plain
  number in em, or a whole number for `--alg-depth`.
- Not covered: `algorithmic` from the older `algorithmic` package
  (uppercase `\STATE`, `\IF`), `algpascal`/`algc` layouts, `\algdef`/
  `\algnewcommand` user definitions, `algorithm2e`, and comments too wide
  for their line. In TeX `\hfill` then lets them run on; here the float
  drops to the next line. The unknown commands warn as unsupported.
- The Monaco grammar needs no change: these are ordinary commands.
