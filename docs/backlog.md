# Backlog

The working list of what is open, so any session (human or agent) can pick
the work up. AGENTS.md §14 is the roadmap; ADRs in `docs/decisions/` record
why things are the way they are. This file tracks what is **not done yet**.
Update it in the same PR that starts, finishes or defers an item.

## In progress

Nothing: step 10 (code: `listings`, ADR 0014; pseudocode, ADR 0016) is done.

## Next

- **Project folders and cloud drives (ADR 0015).** Each phase is its own
  PR. Phase A is done: the project folder (`src/workspace/project.ts`) as
  a zip download, and `npm run check:projects` compiling it with real
  pdflatex and bibtex in CI.
  - B. Save to a folder on this computer with the File System Access API
    (Chromium; zip elsewhere). A folder synced by the OneDrive or Google
    Drive desktop app puts the project in the cloud with no sign-in.
  - C. OneDrive: PKCE sign-in in a popup, `Files.ReadWrite.AppFolder`,
    explicit save and open, the version check before overwriting. Needs a
    Microsoft Entra ID app registration.
  - D. Google Drive on the same `CloudDrive` interface, scope `drive.file`.
    Needs a Google Cloud OAuth client.
  - Later: export a document other than the open one (from the explorer);
    automatic saving to the drive (off by default), versions in the
    drive.
- Steps 11–13 of AGENTS §14 (elsarticle, the starter-document tour, the
  language worker and the rest).

## Deferred follow-ups (from ADRs and PRs)

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
