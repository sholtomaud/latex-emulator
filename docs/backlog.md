# Backlog

The working list of what is open, so any session (human or agent) can pick
the work up. AGENTS.md §14 is the roadmap; ADRs in `docs/decisions/` record
why things are the way they are. This file tracks what is **not done yet**.
Update it in the same PR that starts, finishes or defers an item.

## In progress

- The writing assistant (ADR 0023), taken ahead of the agreed order on
  request: step 1 (the chat pane, setup and providers) is done; profiles
  and the checks are next for it. Versions on disk is next otherwise.
- **Zotero plugin with Zettelkasten tools** (ADR 0024), taken ahead of
  versions on disk and local style rules at the maintainer's request
  (November 2026). Phase 1 is done: the plugin (MCP on Zotero's port,
  pairing, `search_items` and `get_item`), the References section to get
  it and connect, and a CI job running it in a real Zotero 10. Next:
  phase 2, the Zettelkasten tools. Phase 1 follow-ups:
  - a scheduled CI run against Zotero's latest release, so a new Zotero
    that breaks the plugin is noticed before users update;
  - test older Zotero versions before widening `plugin.json`'s range;
  - one way of keeping secrets: the assistant's keys use the browser's
    password manager, the plugin's token the encrypted SecretStore;
    choose one (and move the zotero.org key, ADR 0009, to it).

## Next

In this order (agreed November 2026):

1. ~~**Activity bar and side bars** (ADR 0022)~~ (done, three PRs): the
   activity bar and primary side bar; the Explorer tree; the secondary
   side bar on the right with the Assistant shell. Later: a draggable
   width for the left side bar (the Assistant's is done), an Outline and
   a Problems view.
2. **Versions on disk** (ADR 0015 B2, small): with a folder linked, each
   saved version is written once to `versions/<name>-v1.2.0.tex` and
   listed in `versions/versions.json` with its label. Working files keep
   their names and are overwritten by saves.
3. **Local style rules** (ADR 0023, tier a): lint rules with no model, set
   by a style profile. They cover `Supervisor++`'s mechanical rules:
   banned constructions, fillers, the quotation protocol, rhythm, and
   em-dash density.
4. **Zotero plugin** (ADR 0024; phase 1 done). Our own Zotero plugin serving MCP on
   Zotero's own port (`/latex-emulator/mcp` on 127.0.0.1:23119), paired
   with the app by a code shown in Zotero, with read tools, Zettelkasten
   tools (Luhmann IDs, Related links, literature notes, an `zk/inbox` tag
   for agents' notes) and, later, preprint versions. Four phases:
   - ~~skeleton, pairing and read tools, and a CI job with a real
     Zotero~~ (done);
   - Zettelkasten tools;
   - ~~Zotero search and typeahead through the plugin~~ (done, plugin
     0.2.0); a document's references as a collection;
   - preprint versions with linked project files.

   No vector index at first; if needed, embed only the zettels with
   `llama-server --embedding` (ADR 0024 §4).

5. **The writing assistant** (ADR 0023), in steps:
   - ~~the chat pane (pinned or floating, resizable), Assistant setup,
     and providers: Claude, OpenRouter, Gemini, a local llama.cpp
     server~~ (done, November 2026);
   - profiles: several assistants with their own prompts, each task
     routed to its own endpoint (several local servers on their own
     ports);
   - ~~chat: insert a suggested block at the cursor or replace the
     selection; ask about the selection~~ (done, November 2026);
   - chat follow-ups: send the `.bib` entries cited; a token/cost
     estimate per message;
   - paragraph checks on pause, structured findings, the cache;
   - audits on demand and the readiness traffic lights;
   - the Z3 logic check (a second runtime dependency, with its own
     justification);
   - auto-zettel suggestions through the Zotero plugin.
6. **Back-filling zettels with a local model** (llama.cpp's
   `llama-server`, not Ollama), a resumable job over the library:
   - per item: metadata, abstract, annotations and child notes, within a
     context budget for a model that fits in 32 GB RAM; full text only by
     map-reduce when needed;
   - output: draft zettels tagged for review (e.g. `zk/draft`, `zk/llm`),
     never silently made permanent;
   - idempotent (processed items are marked), checkpointed,
     rate-limited, with a dry run first.
7. **OneDrive and Google Drive** (ADR 0015 phases C and D, below).
   Sign-in, then backup and sync of project folders. The owner must first
   create the Microsoft Entra ID and Google Cloud app registrations.

- **elsarticle phase B (ADR 0018):** `review` (1.5 line spacing); `1p` and
  `3p` (elsarticle.cls's geometry values, two-sided); the class's list
  spacing; `\newtheorem`/`\newproof`/`\newdefinition` (needs theorem
  environments); `\footnotesize` captions; `highlights` and
  `graphicalabstract`. Then `5p` (two columns). Each measured with a
  fixture.

- **Project folders and cloud drives (ADR 0015).** Each phase is its own
  PR. Phases A (zip download, `npm run check:projects`) and B (save to a
  folder, open a folder, save as you type) are done.
  - C. OneDrive: PKCE sign-in in a popup, `Files.ReadWrite.AppFolder`,
    explicit save and open, the version check before overwriting. Needs a
    Microsoft Entra ID app registration.
  - D. Google Drive on the same `CloudDrive` interface, scope `drive.file`.
    Needs a Google Cloud OAuth client.
  - Later: export a document other than the open one (from the explorer);
    automatic saving to the drive (off by default), versions in the
    drive.
- Steps 12–13 of AGENTS §14 (the starter-document tour, the language
  worker and the rest).

## Deferred follow-ups (from ADRs and PRs)

- Explorer (ADR 0022): folder rows for images in subfolders; a real ARIA
  tree with a context menu for row actions; opening a `.bib` row to show
  its cited entries; make the `BaseComponent` render-once fix upstream in
  `sholtomaud/boba`.

- Offline (ADR 0021): if the first visit's ~5.3 MB proves too heavy, cache
  Monaco on first use instead of precaching it; a "Ready to work offline"
  note once the first install completes; the language worker and
  dictionaries join the precache when they exist (automatic: every built
  file is listed).

- Folders (ADR 0015 B): save versions into a `versions/` subfolder;
  "Back up all" into a chosen folder on a schedule; detect a folder's
  `.tex` changed elsewhere and offer to load it (today a save just
  reports the conflict).
- Origin (ADR 0019): every `sholtomaud.github.io/*` site shares one
  storage origin, so clearing one clears all, and their scripts can read
  ours. Give the app its own origin (a custom domain for Pages). Data
  doesn't follow a move: announce it and point users to Back up all /
  Restore first.
- Storage (ADR 0019): a reminder to back up when the app closes with
  unbacked-up edits; `QuotaExceededError` named in the save-failed notice;
  backup of the Zotero and other preferences.

- Text rendering (ADR 0018): try `text-rendering: geometricPrecision` on
  the whole document. On the elsarticle addresses it made the CI image
  measure exactly what the host does; document-wide it may remove the
  pixel-rounding gaps (centred table cells, the algorithm ▷) and let the
  centred-line tolerance tighten. It changes every visual baseline.
- Optical sizes: TeX picks the design by size (cmr10 for `\footnotesize`
  and `\small` even in a 12pt document). Footnotes, the elsarticle
  addresses and footer do; the general size classes still inherit the
  document's design (LM Roman 12 in 12pt documents).

- Test browser (ADR 0017): run the Playwright container as the image's
  non-root `pwuser` with a seccomp profile that lets Chromium's sandbox
  start; bump Playwright as soon as a release ships a Chromium with the
  current security fixes (`@playwright/test` and `playwright` together).

- Pseudocode (ADR 0016): `\listofalgorithms`; the package's numbering
  options (`section`, …); the older `algorithmic` package (`\STATE`);
  `\algdef`/`\algnewcommand`; `algorithm2e`; comments too wide for their
  line. The ▷ of a long comment drifts with the browser's whole-pixel
  glyph advances (declared `triangleGap`).
- Math: `\triangleright` outside `\Comment` uses Latin Modern Math's
  large U+25B7 (cmmi's is about half its size; the font has no U+25B9).
  `x_1, \dots, x_n` sets the ellipsis tighter than TeX's `. . .`.
- `\usepackage` validation: AGENTS §6 says unknown packages warn, but no
  package is checked today (found during step 10b).

- Large references libraries: the lag with a 10,000-entry `.bib` is
  fixed. `src/latex/bibtex/bib-cache.ts` parses each library text once
  while it is unchanged and indexes its keys, so renders no longer
  re-read the library and undefined citations no longer scan it.
  `node scripts/bench-citations.ts` measures it: per render 148 → 20 ms
  with 400 citations, and 1.7 s → 15–52 ms with undefined citations or
  while a key is typed. Still on the main thread: one document parse per
  completion or hover request (`citeContextAt`), and building the
  typeahead index (≈75–150 ms, once per library change). Both move to
  the language worker (step 13). Rust/WASM for `parseBib` only if it
  still blocks after that (AGENTS §2).

- Fidelity measurement: switch the prose position checks in
  `print-fidelity.spec.ts` to the baseline probe the code-line check uses
  (glyph rects are rounded to whole pixels; ADR 0014), then tighten.
- Monaco grammar: don't highlight the inside of `lstlisting`/`verbatim` as
  LaTeX.
- Listings (ADR 0014): HTML/XML (tag mode), `breaklines`, `escapeinside`,
  `\lstinputlisting`, `aboveskip`/`belowskip` keys, `upquote`, `\color`
  styles (no xcolor yet), `\lstlistoflistings`, kerns inside flexible
  units, frames other than `single` measured against pdflatex.
- Figures (ADR 0013): `\includegraphics{` typeahead; an "Add image…" quick
  fix for a missing image (needs command-style fixes beyond ADR 0011's text
  edits); Exif resolution; Zotero attachments. (Project zip export: ADR 0015,
  phase A.)
- Tables (ADR 0012): floats without a blank line before them (LaTeX keeps
  the paragraph going); booktabs `\addlinespace`, `\specialrule`; floats
  only ever placed where written.
- Fidelity gaps declared in `print-fidelity.spec.ts`: `natbib-basic` line
  breaks (needs Knuth–Plass), `math-basic` after a `\sqrt` display.
- Documents (ADR 0005): say in the UI that documents live only in this
  browser until export/sync exists (ADR 0015).
- Versions (ADR 0006): pruning or export of versions.
- Zotero (ADR 0009): collections, more than 25 results, two-way sync; still
  to verify by hand: the live doi.org lookup. Zotero on this computer was
  checked against a real Zotero: Zotero refuses requests from web pages, and
  the app now says so. Revisit if Zotero adds a way for web pages to opt in.
