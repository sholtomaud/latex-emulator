# 0004: Monaco editor integration

## Context

AGENTS.md §2 already allows exactly one runtime dependency, `monaco-editor`.
This records how it is brought in, because Monaco is large and its default
entry point bundles far more than we need.

## Decision

- **Version:** `monaco-editor@0.57.0`, pinned exactly. Monaco brings two
  transitive runtime dependencies of its own, `marked` (hover Markdown) and
  `dompurify` (sanitising that Markdown). We don't import either directly.
- **Curated entry, not `editor.main`.** `src/language/monaco.ts` imports
  `editor.api.js` plus only the editor features we use: hover, find,
  folding, bracket matching, comment toggle, suggest, context menu, line and
  word operations, multicursor, and a few others. There are no language
  definitions and no TypeScript/JSON/CSS/HTML services (AGENTS.md §12).
  - The feature modules ship without typings; `monaco-features.d.ts`
    declares them.
  - Imports go through the package's `exports` map (`monaco-editor/editor/…`).
- **Lazy loading.** `<latex-editor>` dynamically imports the Monaco entry, so
  the shell and preview render first.
  - Initial JS: ~22 KB gzip.
  - Monaco chunk: 3.4 MB minified / 873 KB gzip.
  - Editor worker: 304 KB.
- **Highlighting** is a Monarch grammar (`latex-language.ts`). It is
  presentation only; meaning comes from the real parser.
- **Diagnostics** flow through `diagnosticsStore`. Whoever parses publishes
  `{ source, diagnostics }`: the preview today, the language worker in the
  next step. The editor turns them into markers only if `source` still
  matches the editor's text, so stale results are dropped.
  `markers.ts`/`positions.ts` are pure and unit-tested.
- **CSP:** unchanged. The editor worker is a same-origin file, allowed by
  `default-src 'self'`. Monaco's dynamic styles are covered by the existing
  `style-src 'unsafe-inline'`. The smoke test (no console errors) confirms
  this in the production build.
- **Print shortcut:** Cmd/Ctrl+P is caught in the capture phase, so the editor
  can't swallow it.

## Consequences

- The Monaco chunk dominates download size. The PWA service worker
  (milestone 8) must precache it for offline use.
- E2E tests set the document by pasting (`e2e/support/editor.ts`). Typing a
  multi-line document triggers Monaco's auto-indent on every line. The helper
  asserts the editor holds exactly the given text.
- Upgrading Monaco means re-checking the curated feature list against the new
  `editor.main.js`.
