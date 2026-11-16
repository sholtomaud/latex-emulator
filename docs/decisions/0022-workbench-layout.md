# 0022: Workbench layout: an activity bar and side bars

Status: accepted and built: phases 1 (the activity bar and primary side
bar), 2 (the Explorer's documents as folders) and 3 (the secondary side
bar). Draggable widths are still to come.

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
  - Its width can be dragged (15–30rem) and is remembered (not built yet;
    15rem for now).
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
    images and citations in, nodes out), rendered from `<template>`s. Phase 2
    uses nested lists with buttons rather than the ARIA tree pattern (see
    Phases).

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
2. **The Explorer tree** (built): documents as folders with their `.tex`,
   images and generated `.bib`.
   - The open document expands to a list of its files:
     - its `.tex`;
     - each `.bib` its `\bibliography` lists, with "3 cited of 412 in the
       library" (or "not in your library") and a button to open
       References;
     - its images.

     Other documents stay closed; opening one expands it. The model is pure
     (`src/workspace/explorer-tree.ts`), and it refreshes as you type and
     when the library changes.

   - **Nested lists with buttons, not the ARIA `tree` pattern.** Rows carry
     actions (rename, download, delete; copy, rename, download and delete
     for images), and the tree pattern doesn't allow interactive controls
     inside its items. Lists of buttons are accessible and keyboard-operable
     with Tab, and keep the names screen readers and tests use. A real tree
     with a context menu for actions can come later.
   - The image panel moves into the open document's files, keeping its
     add, drop, paste and reuse controls. Images are still listed with
     their full paths (`figs/plot.png`); folder rows can come later.
   - **A fix to the vendored Boba core** (AGENTS §3). `BaseComponent`
     appended its template on every `connectedCallback`, so moving a
     component in the DOM (as the Explorer moves the image panel)
     duplicated its content and listeners. It now renders and initialises
     once. This is a local divergence until the same fix is made in
     `sholtomaud/boba`.
3. **The secondary side bar** (built), with the Assistant shell
   (ADR 0023).
   - `assistant-panel` is a `complementary` region named "Assistant". For
     now it says what the assistant will do (style-profile checks as you
     type, paragraph checks when you pause, audits on request) and has a
     close button that returns focus to the toggle.
   - **The toggle is a button, not a tab.** It sits at the foot of the
     activity bar, outside the tablist, with `aria-expanded` and
     `aria-controls`, because it opens a second region rather than
     choosing the primary side bar's view. Ctrl+Alt+B (⌘⌥B) toggles it,
     as VS Code's secondary side bar; the shortcut matches the physical
     key, because ⌥B types "∫" on a Mac (`src/util/shortcuts.ts`).
   - `uiStore.assistantOpen`, remembered as the `assistant-open`
     preference.
   - **Layout.** At 1440px and wider it is a fourth column (20rem).
     Narrower, it lies over the right of the preview, so the editor keeps
     its width (the preview page behind it is not rescaled). At 768px and
     below it is a drawer from the right, `min(20rem, 85vw)` wide.
     `e2e/specs/assistant-panel.spec.ts` measures all three.
   - The widths are fixed for now; dragging them (15–30rem, remembered) is
     a later change for both side bars.

### The toolbar: one Download menu

The toolbar had four download buttons (.tex, .zip, Preprint, PDF). They
become **one Download button** whose menu holds the four, PDF first:
minimal by default, the choices shown when asked for.

- The `download-menu` component follows the WAI-ARIA menu-button
  pattern. Down or Up on the button opens it at the first or last item,
  arrows wrap (`src/util/menu-keys.ts`, pure), Home and End jump, Escape
  or a choice returns focus to the button, and Tab or a click elsewhere
  closes it.
- Each item says what it gives ("Saves a version, stamped with its number
  and SHA-256"). The items keep the old buttons' accessible names
  ("Download PDF", "Download Preprint", "Download project (.zip)",
  "Download .tex").
- Ctrl/⌘ P still prints at once.

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
