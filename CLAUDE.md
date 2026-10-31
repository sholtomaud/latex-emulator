# CLAUDE.md

@AGENTS.md

AGENTS.md above is the canonical project guide. Everything there applies.
This file adds only Claude-Code-specific working notes. If it ever conflicts
with AGENTS.md, AGENTS.md wins; fix the conflict in the same change.

## How to work in this repo

- **Test first, always (AGENTS.md §10).** Write the failing test, run it and
  show it failing, then implement, then show it passing. Choose the lowest
  layer that can express the behaviour: unit → functional e2e → visual snapshot.
  Logic that lives in a component and can't be unit-tested is a smell; move it
  to a pure module.
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
- **Verify visually and numerically.** For any change under `src/render/` or
  `src/styles/document/`, run `e2e/specs/print-fidelity.spec.ts` (it prints a
  dx/dy table against pdflatex) and look at the screenshots. For layout work,
  add a fixture (`scripts/make-reference.sh`, needs TeX Live and poppler) so
  the new behaviour is measured against real pdflatex output.
- **Run Playwright in the pinned image before trusting a pass.** Glyph
  advances and line breaks differ between Chromium builds. Several fidelity
  issues only showed in the CI image (`scripts/playwright-docker.sh`).
- **Erasable TypeScript only:** no `enum`, `namespace` or constructor parameter
  properties. Use explicit `.ts` import extensions and `import type`. Node's
  type stripping will reject anything else at test time.
- **Never use `innerHTML` with document content.** Build DOM nodes. This is a
  security rule, not a style preference.

## Commands (quick reference)

```bash
npm run dev                  # Vite dev server
npm test                     # unit (fast inner TDD loop)
npm run check                # typecheck + lint + coverage gate + build
npm run e2e:smoke            # smoke suite
npm run e2e                  # functional e2e (dev + prod)
npm run e2e:visual           # visual snapshots in the pinned Docker image
npm run e2e:visual:update    # regenerate baselines (intended visual changes only)
npm run e2e:pages            # GitHub Pages build under /latex-emulator/
npm run build:pages          # build the Pages artifact into .pages/
npm run build:wasm           # only when crates/ exists
```

All of the checks in AGENTS.md §10 must pass before pushing. Report failures
honestly with the output; never skip, weaken or delete tests to get green.

## Environment notes

- In cloud sessions Chromium and Playwright are preinstalled. Do not run
  `npx playwright install`.
- Visual baselines must come from the pinned Playwright image. In a cloud
  session the Docker daemon may need starting first (`dockerd &`). If Docker
  can't run, use the "Update visual baselines" GitHub workflow instead of
  generating baselines on the host.
- After any change under `src/components/`, `src/render/` or `src/styles/`,
  open the Playwright screenshots or the snapshot diffs and actually look at them.
- `src/wasm/` is generated output and is gitignored; regenerate it, don't edit it.
- Fonts and dictionaries in `public/` carry their own licenses. Keep each
  license file next to the asset when adding or updating one.
