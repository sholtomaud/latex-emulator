# CLAUDE.md

@AGENTS.md

AGENTS.md above is the canonical project guide. Everything there applies.
This file adds only Claude-Code-specific working notes. If it ever conflicts
with AGENTS.md, AGENTS.md wins; fix the conflict in the same change.

## How to work in this repo

- **Read before you build.** Before touching a subsystem, read its section in
  AGENTS.md (§4 architecture, §6 LaTeX subset, §7 PDF/CSS, §8 diagnostics).
  The boundary rules (`src/latex/**` has no DOM and no Monaco) are the most
  common thing to get wrong.
- **Plan non-trivial changes first.** For anything that adds a dependency,
  introduces or moves code into Rust/WASM, changes the AST shape, or alters
  CSP/service-worker behaviour, propose a plan and draft the ADR
  (`docs/decisions/`) before writing code.
- **Check against LaTeX, not memory.** When emulating a command's output or a
  class dimension, cite the source macro (`article.cls`, `size1x.clo`,
  `amsmath.sty`) in a code comment. If you can't confirm a value, say so
  instead of guessing, and add a fixture so it can be verified against `pdflatex`.
- **Verify visually.** For any change under `src/render/` or `src/styles/document/`,
  run the Playwright print-fidelity specs and look at the produced screenshots
  or PDF. Passing assertions alone are not enough for typography work.
- **Erasable TypeScript only:** no `enum`, `namespace` or constructor parameter
  properties. Use explicit `.ts` import extensions and `import type`. Node's
  type stripping will reject anything else at test time.
- **Never use `innerHTML` with document content.** Build DOM nodes. This is a
  security rule, not a style preference.

## Commands (quick reference)

```bash
npm run dev                  # Vite dev server
npm run typecheck && npm run lint && npm test
npm run build && npx playwright test
npm run build:wasm           # only when crates/ exists
```

All of the checks in AGENTS.md §10 must pass before pushing. Report failures
honestly with the output; never skip, weaken or delete tests to get green.

## Environment notes

- In cloud sessions Chromium and Playwright are preinstalled. Do not run
  `npx playwright install`.
- `src/wasm/` is generated output and is gitignored; regenerate it, don't edit it.
- Fonts and dictionaries in `public/` carry their own licenses. Keep each
  license file next to the asset when adding or updating one.
