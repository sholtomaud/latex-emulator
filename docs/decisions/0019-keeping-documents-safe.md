# 0019: Keeping documents safe in the browser

## Context

Documents were lost on the GitHub Pages site. Our own code deletes nothing:
every database upgrade only adds stores, and there is no service worker
yet. The risks are the browser's and the site's:

- **Browser storage is best-effort by default.** Without a grant from
  `navigator.storage.persist()`, a browser may clear an origin's storage
  under pressure. Safari also deletes it after seven days without a visit,
  unless the app is on the Home Screen.
- **One origin for every Pages site.** Storage belongs to an origin (scheme
  and host), not a path. `sholtomaud.github.io/latex-emulator` shares its
  storage with every other `sholtomaud.github.io/*` app:
  - DevTools' "Clear site data" on any of them clears ours;
  - they share one quota, and eviction takes the whole origin;
  - their scripts can read and delete our database.
- **Clearing site data is always possible.** No browser API protects
  against the user (or another app on the origin) doing it.

We also found two of our own bugs:

- **A failed save looked saved.** `Workspace.save` updated its memory
  before writing, so after a failed write the next save of the same text
  was skipped as "unchanged".
- **A stale tab lost its edits.** After a newer version took the database
  in another tab, the old tab's connection closed. It showed a notice, but
  the edits typed after it could never be stored, and nothing said so.

## Decision

- **Ask for persistent storage** after the first save of each session:
  - Chrome grants or refuses by itself (installed or often-used sites);
  - Firefox asks the user, so we wait for real work rather than the first
    visit;
  - a backup also asks again.
- **Show the storage status** in a Storage panel in the explorer
  (`storage-panel`, logic in `src/storage/storage-health.ts`, pure):
  - "Stored in this browser only.";
  - whether the browser has agreed not to clear it;
  - usage against the quota;
  - the last backup.

  It warns when storage is 80% full, or when edits have gone a week without
  a backup (counted from the first document when there was never one).

- **Back up everything as one zip** (`src/workspace/backup.ts`, pure):
  - `workspace.json` holds every document, version, `.bib` file and image
    entry;
  - `blobs/<sha256>` holds the image bytes;
  - readable copies of the `.tex` and `.bib` files sit alongside, for
    anyone opening the zip without the app (restore ignores them).

  The download is `latex-emulator-backup-YYYY-MM-DD.zip`, and its time is
  kept as a preference for the status line.

- **Restore by merging, never by overwriting newer work:**
  - for each document, `.bib` file and image, the copy with the later
    `updatedAt` wins, and ties keep this browser's copy;
  - versions are added when missing;
  - restoring the same backup twice changes nothing.

  A fresh browser creates the starter document and `references.bib`, both
  newer than any backup. Untouched starters (still the shipped text) give
  way to the backup's copies, and a starter with a restored document's name
  is removed. A restored document whose name an edited one already has gets
  a unique name.

- **A backup file is untrusted input.**
  - `unzip()` (`src/util/zip.ts`) checks paths as `zip()` does, and checks
    every file's CRC-32 and size against the central directory. Inflating
    stops at the declared size, so a zip bomb fails.
  - `readBackup` checks every record's fields and types. A version must
    match its SHA-256, because preprint stamps print it.
  - Image bytes must match their hash. Their type and size are recomputed,
    and files pdflatex couldn't include are dropped.
- **Our two bugs are fixed:**
  - `Workspace` updates its memory only after the write succeeds, and a
    failed save shows a notice instead of disappearing.
  - When a newer version takes the database, the tab saves what it has,
    then makes the editor read-only and says to reload.

## Consequences

- One click recovers a cleared browser, from a zip the user keeps
  elsewhere. Nothing protects data that was never backed up. A refused or
  unavailable persistence grant is shown plainly; it is not an error.
- Backups are manual. Saving to a folder on disk (ADR 0015 phase B), then
  OneDrive and Google Drive (phases C and D), make the copy outside the
  browser automatic. The zip format here is what those saves will write.
- The shared `github.io` origin remains. Moving to an origin of our own
  (a custom domain for the Pages site) separates the app from the others.
  Data does not follow a move, so the move needs this backup and restore.
  That is in `docs/backlog.md`.
- Untouched starters are recognised by their exact text, so changing the
  shipped sample later means an older backup's starter is no longer
  "untouched". It is then merged like any other document.
