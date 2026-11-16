# 0022: Workbench layout: an activity bar and side bars

Status: accepted. Phase 1 (the activity bar and primary side bar) is built;
phases 2 and 3 are not.

## Context

The left-hand explorer (ADR 0005) has grown to hold everything. It is one
scrolling column with the documents, Storage (status, backup and restore,
the document's folder), Versions, Images, Bibliography and Zotero. Each
feature made it longer, and features still to come need space: an Outline,
Problems, the Zotero plugin and, on the right, the writing assistant
(ADR 0023).

VS Code's answer is familiar to most of our users:

- a narrow **activity bar** of icons;
- a **primary side bar** showing one view at a time;
- a **secondary side bar** on the right, where VS Code, Cursor and similar
  tools now put the AI chat.

## Decision

### Regions

```
┌──┬──────────────┬───────────────────┬───────────────────┬──────────────┐
│A │ primary side │ editor (Monaco)   │ preview (iframe)  │ secondary    │
│c │ bar: one     │                   │                   │ side bar:    │
│t │ view at a    │                   │                   │ Assistant    │
│i │ time         │                   │                   │ (ADR 0023)   │
│v │              │                   │                   │              │
└──┴──────────────┴───────────────────┴───────────────────┴──────────────┘
```

- **Activity bar** (`activity-bar`, about 3rem wide), at the far left:
  - one icon per view: Explorer, Versions, References, Storage, later
    Outline and Problems;
  - the Assistant's icon sits at the bottom of the column and toggles the
    secondary side bar;
  - icons are inline SVG in the component's template. No icon font: AGENTS
    §2 allows no new dependency.
- **Primary side bar** (`side-bar`): shows the chosen view.
  - Clicking the active icon closes the side bar, as in VS Code. Ctrl/⌘+B
    still toggles it (ADR 0005's shortcut).
  - Its width can be dragged (15–30rem) and is remembered.
- **Secondary side bar** on the right: the Assistant (ADR 0023), later
  Comments.
  - It opens and closes independently.
  - On wide screens it is a fourth column; when space runs short, it is
    laid over the preview rather than squeezing the editor.
- **Narrow screens** (≤ 768px): both side bars become drawers over the
  content, and the activity bar stays as the left edge.
- **State:** `uiStore` holds the open view, whether each bar is open, and
  their widths, saved as `localStorage` preferences (AGENTS §11 allows small
  preferences).

### Views

- **Explorer** (the default). Each document is a folder, laid out like its
  project folder (ADR 0015, ADR 0020), so what you see is what gets saved:

  ```
  ▾ A Short Example            ← the open document
      a-short-example.tex
      references.bib          generated · 3 cited of 412 in the library
    ▾ figs
        plot.png
  ▸ Thesis chapter 2
  ```

  - New, import, rename and delete work as now.
  - Images can be added by drop, paste or picker into the folder (or a
    subfolder).
  - Opening the `.bib` node shows the cited entries. It is read-only,
    because it is generated (ADR 0020); you edit entries in References.
  - The folder link and "save there as I type" (ADR 0015 B) show on the
    document's row.
  - The tree is a pure model (`src/workspace/explorer-tree.ts`: documents,
    images and citations in, nodes out), rendered from a `<template>` with
    the ARIA tree pattern (`role="tree"`, `treeitem`, arrow keys,
    Enter/F2/Delete).

- **Versions:** today's Versions section (labels from ADR 0006 included),
  with room for a diff later.
- **References:**
  - the `.bib` library (files, import, clean, Add by DOI or URL);
  - Zotero search and typeahead settings;
  - the Zotero plugin's "Get the plugin" and "Check connection" buttons
    (backlog).
- **Storage:** today's Storage panel (ADR 0019 status, backup and restore),
  and the folder settings (ADR 0015 B).
- **Later:**
  - **Outline:** the section tree, from the AST.
  - **Problems:** the diagnostics list.

### Accessibility

- The activity bar is a vertical `tablist` (`aria-orientation="vertical"`).
  Each icon is a `tab` with a visible tooltip and an accessible name, and
  the side bar is its `tabpanel`.
- Badges carry text for screen readers, for example "Storage: back up
  due" or "Assistant: 3 findings".
- Every view keeps a named region, so the existing role-based e2e locators
  ("Versions", "Bibliography", "Storage", "Images") carry over.

### Phases (one PR each)

1. **Activity bar and primary side bar** (built).
   - Today's sections are moved, unchanged inside, into four views in
     `document-explorer`, one shown at a time:
     - Explorer: documents and images;
     - Versions;
     - References: bibliography and Zotero;
     - Storage.
   - The choice is in `uiStore.sideView`, remembered as a preference; the
     open/close logic is pure (`src/util/side-views.ts`).
   - `activity-bar` is the tablist: arrow keys move between tabs, Enter or
     a click opens a view, and a second click closes the side bar.
   - Storage gets a badge (and "Storage (needs attention)" as its name)
     when its status warns. A backup warning shouldn't hide behind a
     closed view.
   - The toolbar's toggle and Ctrl/⌘+B still open and close the side bar.
   - E2E specs open the view they need (`e2e/support/views.ts`).
   - The visual baselines changed, the preview ones included: the
     activity bar takes 3rem, so the preview page is drawn at a slightly
     smaller scale. Print fidelity is unaffected (it passes in the pinned
     image).
2. **The Explorer tree:** documents as folders with their `.tex`, images and
   generated `.bib`.
3. **The secondary side bar,** with the Assistant shell (ADR 0023).

## Consequences

- The side bar shows one concern at a time. New features get a view (or a
  section in one) instead of lengthening a single column.
- A second click is needed to reach things that were one scroll away.
  Badges on the icons keep warnings visible (an overdue backup, a folder
  conflict, assistant findings).
- Phase 1 changes every app-chrome screenshot, so the visual baselines are
  regenerated in the pinned image as intended changes.
- The component split makes `document-explorer` (now about 400 lines) into
  smaller view components. Their logic stays in pure modules, so the
  coverage gate keeps applying.
