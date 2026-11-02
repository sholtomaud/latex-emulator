# 0016: Pseudocode (`algorithm` + `algpseudocode`)

**Status: draft.** This is the plan for roadmap step 10b. It is revised as
the work lands and finalised in the PR that completes it.

## Context

Roadmap step 10b. Papers set pseudocode with the `algorithmicx` bundle's
`algpseudocode` layout inside the `algorithms` bundle's `algorithm`
float. Its look is quite specific, and a reader would notice a generic
indented list:

- bold keywords;
- small-type line numbers ending in a colon;
- comments pushed to the right margin after a ▷;
- rules above and below the float and under its caption.

The values below were read from TeX Live 2023's sources. They are the
same files `fixtures/algorithm-basic` was compiled with.

## Decision

### Parsing: ordinary LaTeX, no new AST shape

Unlike `lstlisting`, the body of `algorithmic` is normal LaTeX: math,
`\textbf`, `\ref` and so on. The parser already produces a flat child
list of commands (`\State`, `\If{…}`, …) and text. A **pure** pass,
`src/latex/algorithmic/lines.ts`, turns that list into lines:

```ts
interface AlgLine {
  kind: 'statement' | 'require' | 'ensure' | 'blank';
  depth: number; // nesting level, in \algorithmicindent units
  number: number | null; // null for \Require/\Ensure/\Statex, or with no [n]
  content: Node[]; // keyword text is built here, as LaTeX nodes
  comment: Node[] | null; // \Comment{…}
  range: Range;
}
```

It reports unbalanced blocks (`\EndWhile` with no `\While`, `\Else`
outside `\If`, a block still open at `\end{algorithmic}`) as
`syntax/unbalanced-algorithmic` errors, pointing at the command. The
lines are still produced, so the preview never blanks.

The registry gains the environments `algorithm` (a float, `o` for the
placement) and `algorithmic` (`o` for the numbering step). It also gains
the commands, each with its arity and hover docs:

- statements: `\State`, `\Statex`, `\Require`, `\Ensure`, `\Return`,
  `\Call{name}{args}`, `\Comment{…}`;
- blocks: `\If`/`\ElsIf`/`\Else`/`\EndIf`, `\For`/`\ForAll`/`\EndFor`,
  `\While`/`\EndWhile`, `\Repeat`/`\Until`, `\Loop`/`\EndLoop`,
  `\Procedure`/`\EndProcedure`, `\Function`/`\EndFunction`.

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
  hanging into the margin with no line number.
- `\Return` is **return** followed by a space.
- `\Call{N}{a}` is `\textsc{N}(a)`. The parentheses are left out when `a`
  is empty, which also holds for `\Procedure` and `\Function`.
- The `noend` package option drops the closing lines (`\algtext*`).

### Layout (algorithmicx.sty, `\begin{algorithmic}`)

The environment is a `list`:

- `\itemsep`, `\parsep`, `\partopsep` and `\itemindent` are 0;
  `\topsep` is 0.2em.
- `\labelsep` is 0.5em. `\labelwidth` is 1.2em when numbered (`[n]`,
  n > 0) and 0.5em when not. `\leftmargin` is `\labelwidth` + `\labelsep`.
- `\algorithmicindent` is 1.5em per nesting level.
- The label is `\alglinenumber{n}` = `\footnotesize n:`, right-aligned in
  `\labelwidth`. With `[n]`, only every n-th line is numbered, but every
  line still counts.
- `\Comment` is `\hfill\(\triangleright\) text`. It is set flush right on
  its line, with ▷ from Latin Modern Math.

In HTML this becomes one `div.algorithmic` of `div.alg-line` rows. Each row
has a zero-width label box, as listings' numbers do (ADR 0014), and
`padding-left: depth × 1.5em`, all on the vertical spacing model
(`base.css`).

### The float (algorithm.sty → float.sty `\fs@ruled`)

- `\floatstyle{ruled}`, so `\@fs@pre` is `\hrule height.8pt \kern2pt`,
  then the caption.
- `\@fs@mid` is `\kern2pt\hrule\kern2pt`, then the body.
- `\@fs@post` is `\kern2pt\hrule`, a rule of the default 0.4pt.
- The caption is `\floatc@ruled`: `{\bfseries Algorithm n} text\par`.
  It is left-aligned, never centred, with no colon, and always on top:
  the caption goes first wherever `\caption` is written in the body.
- `\floatname{algorithm}{Algorithm}` with its own counter. The package
  options `section`, `chapter` and the like (numbered within) are
  out of scope for article and warn.
- Placement follows ADR 0012: the float is set where written. float.sty's
  `[H]` means exactly that; `[h]`, `[t]`, `[b]` and `[p]` are also set
  where written, as tables and figures are.
- `\ref` to an `\label` after `\caption` gives the algorithm's number.
  `\listofalgorithms` is out of scope for now and warns.

### Fixture

`fixtures/algorithm-basic` (11pt, A4):

- a numbered Euclid algorithm with `\Require`, `\Ensure`, comments and
  nested `\While`;
- an unnumbered algorithm with `\Function`, `\If`/`\ElsIf`/`\Else`,
  `\For`, `\ForAll`, `\Call` and `\Repeat`/`\Until`;
- prose before, between and after.

The floats use `[H]` with blank lines around them, so pdflatex places
them where written, on one page. That measures the layout, not ADR
0012's known placement gaps. A first draft with `[h]` and no blank lines
showed both gaps: the paragraph ran on through the float, and the second
float moved to page 2. Each algorithm line's first glyph and baseline is
checked like `codeLines` (ADR 0014), and so are the right edges of the
comments.

## Consequences

- The `algorithm` float shares the table/figure float machinery
  (`this.float` gains `'algorithm'`). Its caption differs:
  `\floatc@ruled`, not `\@makecaption`.
- `\Comment` flush right uses a flex row: content, then a spacer, then
  the comment. A comment wider than the space left wraps to the next line
  in TeX, which `\hfill` cannot express. That case is out of scope and
  measured later if it matters.
- Not covered: `algorithmic` from the older `algorithmic` package
  (uppercase `\STATE`, `\IF`), `algpascal`/`algc` layouts, `\algdef`/
  `\algnewcommand` user definitions, `algorithm2e`. Each warns as an
  unsupported command or package.
- The Monaco grammar needs no change: these are ordinary commands.
