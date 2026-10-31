# 0005: Documents stored in IndexedDB, with a VS Code-style explorer

## Context

Users need to keep several documents, switch between them, and never lose
work. The app is client-only (no backend, AGENTS.md §1). `localStorage` is
synchronous, about 5 MB, and string-only, which is too small once images and
bibliographies arrive.

## Decision

- **IndexedDB** (`src/storage/indexeddb-repository.ts`) stores documents
  `{ id, name, source, createdAt, updatedAt }` in the `latex-emulator`
  database. If IndexedDB can't be opened, an in-memory repository takes over
  with a console warning, so the app still works but won't persist.
- **`localStorage`** keeps only small preferences: the open document and
  whether the explorer is open. Every access is guarded.
- **`Workspace`** (`src/workspace/workspace.ts`) holds all document logic
  over a `DocumentRepository` and is pure and unit-tested:
  - create, open, rename (unique, case-insensitive names), delete;
  - save (unchanged text is not rewritten);
  - import, export.
  On first run it creates the sample document. Deleting the last document
  leaves a fresh "Untitled".
- **Autosave:** 400ms after typing stops. Every action (open, new, import,
  delete, download) saves pending text first, so switching documents never
  drops keystrokes. A final save also runs when the tab is hidden or closed.
- **Explorer:** toggled with ☰ or Ctrl/⌘+B (as VS Code), remembered across
  reloads, and shown as an overlay on narrow screens. It supports
  double-click/✎ rename (Enter saves, Escape cancels), download, and delete
  with confirmation.
- **Files:** `.tex` downloads are named from the document
  ("A Short Example" → `a-short-example.tex`, falling back to `article.tex`).
  Imports are named from the file.

## Consequences

- Documents live only in this browser on this device until project export or
  sync exists. The UI should say so near the explorer (later).
- The editor resets its undo history when switching documents; keeping one
  Monaco model per document is a possible refinement.
- Versions and preprints (next roadmap step) add a second object store; the
  database version number bumps then.
