# AGENTS.md — LaTeX Emulator

Instructions for AI coding agents (and humans) working in this repository.
This file is the **single source of truth** for project conventions.
`CLAUDE.md` imports it and adds only Claude-Code-specific notes.

---

## 1. What we are building

A **Progressive Web App** that lets a user write LaTeX in a **Monaco editor** and get:

1. **Live diagnostics.** Syntax errors (unbalanced braces, unclosed environments,
   `\begin`/`\end` mismatch), lint warnings (chktex-style style rules), unknown
   or unsupported commands, and **spell checking** of prose (never of command
   names, labels, keys or math).
2. **Editor intelligence.** Syntax highlighting, completion for commands,
   environments, `\ref`/`\cite` keys, hover docs, folding by section and
   environment, and quick-fixes for common diagnostics.
3. **Live preview.** A paginated preview that looks like a LaTeX-typeset document.
4. **A PDF download that matches the preview.** It is produced by the browser's
   own print engine (`window.print()` → "Save as PDF"), driven by
   **paged-media CSS**. No PDF.js, no jsPDF, no server, and no canvas
   rasterisation. The PDF text must stay real, selectable, searchable text.

### Explicit non-goals

- **We do not compile TeX.** We do not port or WASM-build TeX, pdfTeX, XeTeX,
  LuaTeX or any TeX distribution. We do not ship `.sty`/`.cls` files.
- We **emulate** a well-defined subset of LaTeX (see §6). We parse it into an
  AST and render it to semantic HTML, MathML and CSS.
- No backend. Everything runs client-side and works offline once installed.

---

## 2. Technology constraints (hard rules)

| Area | Rule |
|---|---|
| App framework | **Boba** (`github:sholtomaud/boba`): light-DOM Custom Elements, `BaseComponent`, the Boba `Router`, the `EventTarget` `Store`. No React, Lit, Vue, Svelte, etc. |
| Languages | **TypeScript** (Node ≥ 25 native type stripping) and, where justified, **Rust compiled to WASM**. Nothing else. |
| Shared types | Rust types that cross the WASM boundary generate their TS definitions with the **`ts-rs`** crate. Never hand-write a TS mirror of a Rust struct. |
| Runtime deps | **`monaco-editor` is the only runtime npm dependency.** Everything else uses native browser APIs. |
| Browser APIs | Custom Elements, ES modules, Web Workers, MathML Core, CSS Paged Media (`@page`), CSS `hyphens`, `text-wrap`, `@font-face`, Service Worker, Cache API, OPFS/IndexedDB, File System Access (progressive enhancement), `Intl.Segmenter`, `window.print()`. |
| Dev tooling | Inherit Boba's template: Vite (dev server and bundling only), `node --test`, Playwright, oxlint, Prettier, `tsc` for typechecking. Rust: `cargo`, `wasm-bindgen`/`wasm-pack`, `clippy`, `rustfmt`. |
| Adding a dependency | Not allowed without an explicit justification in the PR description: why a native API or ~200 lines of our own code won't do. Dev-only deps get the same scrutiny. |

### Where Rust/WASM is allowed

**Default to TypeScript.** Move a module to Rust only when one of these holds,
and record the decision in `docs/decisions/`:

- Profiling shows the TS version blocks typing latency (target: diagnostics
  in < 50 ms for a 2,000-line document, measured in a worker).
- It is a self-contained, CPU-heavy algorithm with a narrow interface. Likely
  candidates are the Hunspell-compatible spell checker, Knuth–Plass line
  breaking, and the incremental parser if the TS one proves too slow.

A given capability is implemented in **one** language. Never keep parallel TS
and Rust implementations of the same thing, except for a short-lived fallback
during a migration, behind a flag and removed in the same milestone.

WASM is loaded with `WebAssembly.instantiateStreaming` (via `wasm-bindgen
--target web` output) **inside a Web Worker**, never on the main thread.

---

## 3. Boba conventions (inherited — follow exactly)

- **Components:** one folder per component in `src/components/<tag-name>/`
  with exactly three files: `<tag-name>.html`, `<tag-name>.css`, `<tag-name>.ts`.
  Import markup and styles with Vite's `?raw`. Extend `BaseComponent`. Guard
  `customElements.define` with `customElements.get`.
- **Light DOM only.** Do not call `attachShadow`. `:host` in component CSS is
  rewritten to the tag name by `BaseComponent`. Monaco also relies on being
  in the light DOM.
- **Dynamic markup:** put a `<template>` in the `.html` and clone and populate
  it with DOM APIs (`cloneNode`, `textContent`, `classList`). Do not build
  HTML strings in TS (see §9, Security).
- **Imports:** always use explicit `.ts` extensions on relative imports.
- **TypeScript must be erasable** (`erasableSyntaxOnly`, so Node can strip
  types). That means **no `enum`, no `namespace`, no constructor parameter
  properties, no `import x = require()`**. Use `as const` objects plus union
  types instead of enums.
- `verbatimModuleSyntax` is on: use `import type` for type-only imports.
- `strict` is on. Avoid `any`; use `unknown` and narrow it.
- Custom element tag names are kebab-case and contain a hyphen.
- Routing goes through the Boba `Router` (`src/core/router/router.ts`), with
  routes registered in `src/main.ts`. Respect `window.BOBA_BASE_URL` so the app
  works under a GitHub Pages sub-path.
- App state lives in `Store` instances in `src/store/`. Components subscribe
  to `change` events; they do not reach into each other.
- Treat `src/core/` as vendored Boba code. Fix bugs upstream in `sholtomaud/boba`
  where practical, and note any local divergence in `docs/decisions/`.

---

## 4. Architecture

```
          ┌──────────────── main thread ─────────────────┐
 keystroke│ <latex-editor> (Monaco)                      │
  ───────►│   model.onDidChangeContent ──debounce──┐     │
          │                                        ▼     │
          │                  postMessage(text, version)  │
          └────────────────────────────────────────┬─────┘
                                                   ▼
          ┌──────────── language worker ─────────────────┐
          │ lexer → parser → AST (+ source ranges)       │
          │   ├─ diagnostics: syntax · lint · spelling   │
          │   ├─ symbols: labels, cites, sections, macros│
          │   └─ (optional) WASM: spell / parse          │
          └───────┬───────────────────────┬──────────────┘
                  │ markers, symbols       │ AST
                  ▼                        ▼
   monaco.editor.setModelMarkers   renderer (main thread)
   completion/hover providers      AST → DOM (HTML + MathML)
                                     │  two-pass: counters, refs, TOC
                                     ▼
                         <latex-preview> same-origin <iframe>
                           document.css + paged-media CSS
                                     │
                                     ▼
                     iframe.contentWindow.print() → PDF
```

Key design decisions:

1. **One AST, many consumers.** The parser produces a lossless AST in which
   every node carries a `{ start, end }` source range (UTF-16 offsets, to
   match Monaco). Diagnostics, highlighting support, outline, completion and
   rendering all consume that AST. Nobody re-parses with regexes.
2. **Error-tolerant parsing.** The parser must always return an AST, even for
   broken input, with error nodes and diagnostics. Typing an unclosed `{`
   must not blank the preview.
3. **Off-main-thread language work.** Lexing, parsing, linting and spell
   checking run in a module Web Worker (`new Worker(new URL(..., import.meta.url),
   { type: 'module' })`). Messages are versioned: drop any result whose
   `version` is older than the model's current version.
4. **Preview is the print target.** The preview is a same-origin `<iframe>`
   containing *only* the rendered document and its stylesheets, with no app
   chrome and no Tailwind. "Download PDF" calls `print()` on that iframe, so
   the preview and the PDF use the same CSS. Before printing, set the iframe
   document's `<title>` to the intended filename, because Chromium uses it as
   the default PDF name.
5. **Two-pass rendering.** Like LaTeX's `.aux` file: pass 1 collects labels,
   counters, section titles and citations; pass 2 renders with resolved
   `\ref`, `\pageref` (see §7), `\tableofcontents` and the bibliography.
   Unresolved references render as **`??`** and raise a warning, just like LaTeX.
6. **Math via native MathML Core.** TeX math is converted to MathML by our own
   translator; MathJax and KaTeX are not allowed. It is rendered with a
   self-hosted OpenType math font.

---

## 5. Target repository layout

The repo was scaffolded from Boba's `template/` (milestone 1); the demo pages
were removed. Grow toward:

```
src/
├── main.ts                       # routes, boot, SW registration
├── core/                         # Boba core (base-component, router, store)
├── store/                        # app stores: document, settings, diagnostics
├── components/
│   ├── app-shell/                # layout: editor | preview split, toolbar
│   ├── latex-editor/             # Monaco host element
│   ├── latex-preview/            # iframe preview + print trigger
│   ├── diagnostics-panel/        # problems list
│   └── outline-panel/            # section tree
├── latex/                        # PURE TS — no DOM access, runs in Node tests
│   ├── lexer/                    # catcode-aware tokenizer
│   ├── parser/                   # error-tolerant parser → AST
│   ├── ast/                      # node types, visitors, source ranges
│   ├── macros/                   # \newcommand / \renewcommand expansion
│   ├── commands/                 # registry: supported commands & environments,
│   │                             #   arity, docs, render hooks (single table)
│   ├── lint/                     # rule-per-file lint rules
│   ├── spell/                    # prose extraction + checker interface
│   └── math/                     # TeX math → MathML
├── render/                       # AST → DOM (uses DOM APIs; Playwright-tested)
├── language/                     # Monaco glue: Monarch grammar, providers, markers
├── workers/
│   └── language.worker.ts        # hosts src/latex/* (+ WASM) off main thread
├── styles/
│   ├── app.css                   # app chrome (Tailwind allowed here only)
│   └── document/                 # LaTeX look: NEVER loaded into app chrome
│       ├── base.css              # fonts, sizes, paragraphs, lists
│       ├── article.css           # class-specific geometry
│       ├── math.css
│       └── print.css             # @page rules, page-break control
└── wasm/                         # generated wasm-bindgen output (gitignored)
crates/                           # Rust workspace (only if/when needed)
└── latex-spell/ …                # each crate: lib.rs, wasm.rs, ts-rs exports
public/
├── manifest.webmanifest
├── sw.js                         # hand-written service worker
├── fonts/                        # Latin Modern woff2 + Latin Modern Math (licenses alongside)
└── dict/                         # Hunspell .aff/.dic (licenses alongside)
fixtures/                         # *.tex inputs + expected outputs (see §10)
docs/decisions/                   # short ADRs: NNNN-title.md
e2e/
├── specs/                        # functional e2e (dev + prod builds)
├── smoke/                        # fast smoke checks (prod build)
└── visual/                       # toHaveScreenshot specs + __screenshots__/ baselines
scripts/playwright-docker.sh      # run Playwright in the pinned CI image
playwright.config.ts              # projects: functional-dev/-prod, smoke, visual
```

**Boundary rule:** `src/latex/**` must not reference `window`, `document`,
`HTMLElement` or Monaco. It must run unchanged under `node --test` and inside
the worker. `src/render/**` may use the DOM. `src/language/**` is the only place
that imports `monaco-editor`.

---

## 6. Supported LaTeX subset

Grow the subset deliberately. Every supported command or environment lives in
**one registry** (`src/latex/commands/`) with its arity, optional args,
mode (text/math/both), hover documentation and render hook. Completion, hover,
lint ("unknown command") and rendering all read the same registry.

**Tier 1 (MVP)**
- Preamble: `\documentclass[opts]{article}` (`10pt|11pt|12pt`, `a4paper|letterpaper`,
  `twocolumn` later), `\usepackage` (recognised and validated; known packages
  toggle features, unknown ones warn), `\title`, `\author`, `\date`, `\maketitle`.
- Sectioning: `\section`, `\subsection`, `\subsubsection`, `\paragraph`, starred variants.
- Text: paragraphs (blank line), `\\`, `\newline`, `\par`, `~`, `--`, `---`,
  ` `` ''` quotes, `\emph`, `\textbf`, `\textit`, `\texttt`, `\textsc`, `\underline`,
  size commands, `\footnote`, accents and special-character escapes, `%` comments.
- Lists: `itemize`, `enumerate` (nesting, LaTeX label styles), `description`.
- Math: `$…$`, `\(…\)`, `\[…\]`, `equation`, `equation*`, `align`, `align*`
  (amsmath), common symbols, `\frac`, `\sqrt`, sub/superscripts, `\left…\right`,
  `\text`, matrices.
- Cross-refs: `\label`, `\ref`, `\eqref`; `\tableofcontents`.
- Misc: `\newpage`, `\clearpage`, `center`, `quote`, `verbatim`, `\verb`.

**Tier 2:** `\newcommand`/`\renewcommand` (with optional-arg defaults),
`figure`/`table` + `\caption`, `tabular`, `\includegraphics` (local images
from the project store), `thebibliography`/`\bibitem`/`\cite`, `abstract`,
`\hyperref`/`\href`/`\url`, `twocolumn`, `geometry` package options.

**Tier 3 (stretch):** BibTeX `.bib` parsing, `theorem`-style environments,
multi-file projects (`\input`/`\include`), Knuth–Plass justification, other
document classes (`report`, `letter`).

Anything outside the subset: parse it generically (command + brace groups),
raise a **warning** diagnostic ("`\foo` is not supported by the emulator"),
and render its arguments' text so content is never silently lost.

---

## 7. Making the PDF look like LaTeX

"Perfect PDF" means: **a reader should not be able to tell at a glance that
it didn't come from `pdflatex`.** Measure that with fixtures (§10), not by eye.

**Fonts.** Self-host **Latin Modern Roman/Sans/Mono** (woff2) and **Latin
Modern Math** (for MathML) in `public/fonts/`, with their GUST Font License
files. Never fall back silently to system fonts: preload the fonts and
`await document.fonts.ready` inside the iframe before printing.

**Geometry.** Derive sizes from the LaTeX `article` class and its `size1x.clo`
files, exposed as CSS custom properties set from `\documentclass` options.
For example, at 10pt: base 10pt/12pt leading, `\parindent` 15pt, `\textwidth`
345pt, `\section` at `\Large` (14.4pt) bold. **Before hard-coding any value,
verify it against `article.cls`/`size10.clo`/`size11.clo`/`size12.clo` and a
`pdflatex` reference PDF.** Write those values in `styles/document/article.css`
with a comment citing the source macro.

**Paragraph and typography rules (CSS):**
- `text-align: justify; hyphens: auto;` with the document's `lang` set on the
  root, so the browser's hyphenation dictionary for that language is used.
- First paragraph after a heading has no indent; later paragraphs indent by
  `\parindent` with zero `\parskip`, like LaTeX's default.
- `text-wrap: pretty` as a cheap approximation to Knuth–Plass. Real Knuth–Plass
  is a Tier-3 Rust candidate.
- `font-variant-ligatures: common-ligatures`, `font-kerning: normal`,
  old-style figures off, as in LaTeX's defaults.

**Paged media (`styles/document/print.css`):**
- `@page { size: A4 | letter; margin: … }` computed from the class geometry.
- Page numbers in `@page { @bottom-center { content: counter(page); } }` margin boxes.
- `break-before/after/inside` on headings, figures, equations, list items;
  `orphans`/`widows` ≥ 2; headings never stranded at a page bottom.
- Footnotes: CSS footnote floats are not reliably supported. Render footnotes
  at the end of the containing page *section* or as end-of-document notes,
  and record which choice was made in an ADR.
- `\pageref` and TOC page numbers: browsers don't expose layout page numbers
  to script. Either use `target-counter()` where it is supported or paginate
  ourselves (see below). Until then, render them as `??` with an info diagnostic.

**Browser support policy.** Chromium (Chrome/Edge) is the **reference print
engine** and the one the "Download PDF" fidelity guarantee applies to. Firefox
and Safari must remain *usable* (editing, preview, a reasonable PDF). Before
relying on a paged-media feature, check its current support and say which
browsers it was verified in.

**Pagination in the preview.** The on-screen preview must show page boundaries
that match the PDF. Start with a single flow plus CSS print emulation. If
on-screen pages are needed, implement our own lightweight paginator in
`src/render/paginate/` rather than adding a polyfill dependency.

---

## 8. Diagnostics, linting and spelling

- A diagnostic is `{ range, severity: 'error'|'warning'|'info'|'hint', code, message, source: 'syntax'|'lint'|'spell'|'ref', fixes? }`.
  Codes are stable strings (e.g. `syntax/unclosed-env`, `lint/space-before-ref`,
  `spell/unknown-word`). They map to Monaco markers in `src/language/` only.
- **Lint rules:** one file per rule in `src/latex/lint/rules/`, each with
  `meta` (code, default severity, description) and a pure `check(ast, ctx)`.
  Each rule ships with fixture-driven tests covering both positive and negative cases.
  Candidate rules: non-breaking space before `\ref`/`\cite`, `"` used as a quote,
  `...` instead of `\ldots`, wrong dash length in number ranges, `$$` display
  math (discouraged), unused/duplicate labels, undefined refs, `\\` ending a
  paragraph, mismatched `\left`/`\right`.
- **Spell checking:** Monaco has **no** native spellcheck, and the browser's
  `spellcheck` attribute does not apply to it. We extract prose ranges from the
  AST (skipping commands, environment names, `\label`/`\ref`/`\cite` keys,
  math, verbatim, URLs, and comments if the user setting says so), tokenise them
  with `Intl.Segmenter`, and check them against a Hunspell-format dictionary
  (`.aff`/`.dic`) loaded in the worker. Users get a per-document and a global
  ignore list, plus "add to dictionary". Suggestions appear as quick-fixes.
  The checker is the prime candidate for a Rust/WASM crate.

---

## 9. Security and privacy

- User LaTeX is **untrusted input**. The renderer builds the DOM with
  `createElement`, `textContent`, `setAttribute` and `createElementNS` (MathML).
  **Never** pass user-derived strings to `innerHTML`, `outerHTML`,
  `insertAdjacentHTML`, `document.write`, `eval` or `new Function`.
- URLs from `\href`/`\url`/`\includegraphics` are validated: allow only `http:`,
  `https:`, `mailto:` and project-local asset references. Reject `javascript:`
  and `data:` (except our own image blobs).
- Keep Boba's CSP meta tag. Tighten it over time (drop `'unsafe-inline'` for
  scripts) and add `worker-src 'self' blob:` as Monaco/Vite workers require.
  Document every relaxation in an ADR.
- No telemetry and no network calls with document content. Documents live in
  OPFS/IndexedDB on the user's device.

---

## 10. Test-driven development and testing

### TDD is mandatory

Every change, whether a feature or a bug fix, follows **red → green → refactor**:

1. **Red.** Write the test that describes the behaviour, run it, and *see it
   fail for the right reason*. Pick the lowest layer that can express it:
   a unit test for pure logic, a functional e2e spec for a user-visible
   behaviour, a visual snapshot for appearance.
2. **Green.** Write the minimum code that makes it pass.
3. **Refactor.** Clean up with the suite green.

Commit the test with (or before) the code that satisfies it. A PR that adds
behaviour without a test that would have failed without it is incomplete.
Never weaken, skip, `.only`, or delete a test to get CI green. Do not update a
snapshot to "make it pass" unless the visual change is intended, and say so in
the commit message.

### Test suites

| Suite | Location | Runner | Command | Runs against |
|---|---|---|---|---|
| **Unit** | `src/**/*.test.ts` (colocated) | `node --test` | `npm test` / `npm run test:coverage` | TS source directly, no browser |
| **E2E (functional)** | `e2e/specs/` | Playwright | `npm run e2e` | Vite dev server **and** production build |
| **Smoke** | `e2e/smoke/` | Playwright | `npm run e2e:smoke` | production build |
| **Visual snapshots** | `e2e/visual/` | Playwright `toHaveScreenshot` | `npm run e2e:visual` | production build, in the pinned container |

- **Unit.** Pure modules (`src/latex/**`, `src/render/` helpers, `src/util/`)
  have **≥ 90 % line, branch and function coverage**, enforced by
  `npm run test:coverage`. Components and the vendored Boba router are
  excluded from the gate because they need a browser; e2e covers them.
  Keep logic out of components so it can be unit-tested.
- **E2E.** Real user flows: typing updates the preview, diagnostics appear as
  Monaco markers, quick-fixes apply, the layout responds to width, and offline
  reload works. Use role/label locators (`getByRole`, `getByLabel`) rather than
  CSS where possible.
- **Smoke.** A handful of fast checks (< 10 s total) proving a build is alive:
  it boots with no console errors, page errors or failed requests, an edit
  reaches the preview, and routing works. If a smoke test fails, nothing else matters.
- **Visual snapshots.** These cover the app chrome at desktop and mobile
  sizes, the preview page, and the preview page under
  `page.emulateMedia({ media: 'print' })`. Baselines live in
  `e2e/visual/__screenshots__/` and **must be generated in the pinned
  Playwright container** (`mcr.microsoft.com/playwright:v<version>-noble`),
  because fonts and the Chromium build change pixels. Generate them with
  `npm run e2e:visual:update` (Docker) or the **"Update visual baselines"**
  GitHub workflow. Never commit baselines generated on a host OS.
- **Fixtures (from roadmap step 3).** `fixtures/<name>/` holds `input.tex`,
  `ast.json`, `diagnostics.json`, and `reference.pdf` +
  `reference-page-N.png` generated once by real `pdflatex`, with the
  generating command recorded in `fixtures/README.md`. Print-fidelity visual
  specs compare our rendering of each fixture with its `pdflatex` reference.
  `page.pdf()` is a **test-only** tool; the app itself uses `print()`.

### Before every push

```bash
npm ci
npm run typecheck            # tsc -p .
npm run lint                 # oxlint + prettier --check
npm run test:coverage        # unit tests + coverage gate
npm run build                # vite build
npm run e2e:smoke            # smoke
npm run e2e                  # functional e2e, dev + prod
npm run e2e:visual           # visual snapshots (Docker, pinned image)
# when crates/ exists:
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
npm run build:wasm           # wasm-bindgen → src/wasm/ (also regenerates ts-rs bindings)
```

Where Chromium/Playwright browsers are preinstalled, do not reinstall them;
`playwright.config.ts` falls back to the newest installed Chromium. Otherwise
run `npx playwright install --with-deps chromium`.

### GitHub Actions (`.github/workflows/ci.yml`)

On every PR and every push to `main`, these jobs run in parallel, and all must pass:

- **Unit:** typecheck, lint, `test:coverage`, build (Node 25).
- **Playwright (smoke)**, **Playwright (e2e)**, **Playwright (visual)**:
  each runs in the pinned Playwright container and uploads its report and
  diffs as an artifact.

When Rust crates arrive, a **Rust** job (fmt, clippy, test, wasm build) joins
them. `visual-baselines.yml` is a manual (`workflow_dispatch`) workflow that
regenerates snapshot baselines in the pinned image and commits them to the
chosen branch.

---

## 11. PWA requirements

- `public/manifest.webmanifest` with name, icons (192/512 + maskable),
  `display: standalone`, `start_url` and `scope` relative to `BOBA_BASE_URL`.
- A **hand-written** `public/sw.js`, not a plugin-generated one. It precaches
  the app shell, Monaco chunks, worker, WASM, fonts and dictionaries, using a
  versioned cache name, and cleans up old caches on `activate`. A tiny local
  Vite plugin may emit the precache list of hashed assets at build time.
- The app must be fully functional offline after first load, including
  diagnostics, spelling, preview and PDF.
- Persist documents in OPFS (fall back to IndexedDB). Open and save `.tex`
  files with the File System Access API where available, falling back to
  `<input type=file>` and a download link.

---

## 12. Performance budgets

- Keystroke → markers updated: **< 150 ms** p95 for a 2,000-line document.
- Keystroke → preview updated: **< 300 ms** p95 (debounced; render only
  changed top-level blocks where possible).
- Main thread long tasks during typing: none > 50 ms.
- Initial load (excluding Monaco): JS < 150 KB gzip. Load only Monaco's core
  editor worker; do **not** bundle Monaco's TS/JSON/CSS/HTML language services.

---

## 13. Workflow

- Branch from `main`; one focused change per PR; conventional, descriptive
  commit messages explaining *why*.
- Architectural choices (new dependency, Rust migration, CSP change, a
  rendering trade-off like footnote placement) get a short ADR in
  `docs/decisions/NNNN-kebab-title.md`: Context, Decision, Consequences.
- When you add a supported command, update the registry, add tests and a
  fixture snippet, and tick it off in §6 if it changes a tier's status.
- Work test-first (§10). The PR description lists the tests added and which
  suites they belong to.
- Keep this file current. If a change makes any statement here false, update
  AGENTS.md in the same PR.

---

## 14. Build order (roadmap)

1. ✅ Scaffold from Boba; strip demo pages; app shell with editor | preview
   split (textarea placeholder editor, iframe preview, placeholder
   plain-text renderer); unit/e2e/smoke/visual suites and CI.
2. Monaco integration (core editor + worker only) with a Monarch LaTeX grammar.
3. Lexer + error-tolerant parser + AST with ranges; syntax diagnostics → markers.
4. Renderer for Tier-1 text constructs; iframe preview; `document/*.css`;
   Latin Modern fonts; print → PDF; first `pdflatex` reference fixtures.
5. TeX math → MathML; equation numbering; `\label`/`\ref` two-pass.
6. Lint rules; completion and hover from the command registry; quick-fixes.
7. Spell checking (TS first; Rust/WASM crate if it misses the budget).
8. PWA: manifest, service worker, OPFS storage, file open/save.
9. Tier 2 features; pagination-accurate preview; print-fidelity CI gate.
