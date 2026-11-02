# Backlog

The working list of what is open, so any session (human or agent) can pick
the work up. AGENTS.md §14 is the roadmap; ADRs in `docs/decisions/` record
why things are the way they are. This file tracks what is **not done yet**.
Update it in the same PR that starts, finishes or defers an item.

## In progress

Nothing: step 10a (`listings`) is done (ADR 0014).

## Next

- **Step 10b: `algorithm` + `algpseudocode`** (`algorithmic`, `\State`,
  `\If`/`\ElsIf`/`\Else`, `\For`, `\While`, `\Procedure`, `\Function`,
  `\Require`/`\Ensure`, `\Comment`, line numbers), the `algorithm` float
  (float.sty `ruled` style), measured against pdflatex.
- **Project folders and cloud drives (ADR 0015, proposed).** Each phase is
  its own PR:
  - A. The project folder (`src/workspace/project.ts`: the `.tex`, the
    `.bib` files its `\bibliography` lists, its Images next to the `.tex`)
    as a zip download, plus a CI job that compiles it with real pdflatex
    and bibtex.
  - B. Save to a folder on this computer with the File System Access API
    (Chromium; zip elsewhere). A folder synced by the OneDrive or Google
    Drive desktop app puts the project in the cloud with no sign-in.
  - C. OneDrive: PKCE sign-in in a popup, `Files.ReadWrite.AppFolder`,
    explicit save and open, the version check before overwriting. Needs a
    Microsoft Entra ID app registration.
  - D. Google Drive on the same `CloudDrive` interface, scope `drive.file`.
    Needs a Google Cloud OAuth client.
  - Later: automatic saving to the drive (off by default), versions in the
    drive.
- Steps 11–13 of AGENTS §14 (elsarticle, the starter-document tour, the
  language worker and the rest).

## Deferred follow-ups (from ADRs and PRs)

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
