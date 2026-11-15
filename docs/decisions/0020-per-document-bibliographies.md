# 0020: One library, a .bib subset per document

## Context

The `.bib` library (ADR 0007) is shared by every document, and a project
folder (ADR 0015) copied each file its `\bibliography` lists in full. Over
years a library grows to thousands of entries, so every zip download, folder
save and, later, OneDrive or Google Drive save would carry the whole of it.
A pdflatex project usually holds a small `.bib` with just its own
references, and images already work this way: one stored copy of the bytes,
per-document names (ADR 0013).

Two ways were weighed:

- **(a) Shared library, shown in each document's folder.** This is simple,
  but exports carry the whole library.
- **(b) A copy of the library per document.** Small files, but every fix to
  an entry has to be repeated in each copy.

## Decision

Keep (a)'s single store, with (b)'s output:

- **The library is the one store of entries** in the browser, fed by DOI
  lookups, Zotero, imports and folders. Fixing an entry fixes it for every
  document.
- **A document's `.bib` files are generated**
  (`src/references/bib-subset.ts`, pure). For each file its `\bibliography`
  lists, only the entries the document cites (`\cite…`, `\nocite`) are
  written, under the file's own name:
  - entries are copied exactly as written in the library;
  - everything else in the file (`@string`, `@preamble`, comments) is kept,
    so bibtex reads the same values;
  - keys match without case, as BibTeX matches them;
  - a `crossref` parent comes with its child;
  - `\nocite{*}` keeps the whole file;
  - a listed file with nothing cited is written empty, because bibtex needs
    it to exist.

  The zip download, the folder save and later the cloud drives all write
  this subset (`buildProject`). It is rebuilt at every save: a new
  citation's entry appears in the folder, and a dropped one leaves it.

- **Opening a folder merges its `.bib` into the library** (`mergeBib`):
  - entries the library lacks are appended, with any `@string` macros they
    use that the library doesn't define;
  - for a key in both, the library's copy is kept. If the contents differ,
    the panel says so, and the folder's file is not taken as the save
    baseline, so the next save asks before replacing it (ADR 0015's
    conflict rule).

  Nothing in the library is overwritten by opening a folder.

- **Tests.**
  - A unit test runs the BibTeX emulator (which matches real bibtex, ADR
    0007) on the subset and on the whole library for `plainnat`, `unsrt`
    and `elsarticle-harv`; the `.bbl` files are identical.
  - CI's LaTeX-projects job compiles every exported project with real
    pdflatex and bibtex, with no undefined citations allowed.
    `fixtures/natbib-basic/refs.bib` has one uncited entry, so that job
    compiles a subset that really dropped something.

## Consequences

- Exports are small and look like an ordinary pdflatex project, whatever
  the size of the library.
- **The folder's `.bib` is output, not a second library.** An entry added by
  hand to the folder's file comes back into the library when the folder is
  opened (merged). An edit to an entry the library also has is reported and
  then asked about, never applied silently. Entries the document doesn't
  cite are dropped from the folder's file at the next save. They are not
  lost, because opening the folder merged them first.
- The library itself is still a set of named `.bib` files, which keeps
  import, export and `\bibliography{name}` simple. Moving to an entry-level
  store, so one entry can appear in several named files, is not needed yet.
- Later (`docs/backlog.md`):
  - the Explorer view shows each document's generated `.bib` in its folder;
  - with the Zotero plugin, the library can be fed from Zotero, and a
    document's subset can be sent back as a Zotero collection.
