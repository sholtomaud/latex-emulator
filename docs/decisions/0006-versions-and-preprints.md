# 0006: Versions, preprints and SHA-256 checksums

## Context

Authors need to hand out drafts and later prove which source a given PDF
came from. The PDF is produced by the browser's print engine (AGENTS.md §1),
and the LaTeX must stay standard (§14 rule), so the stamp can't be LaTeX
markup inside the document.

## Decision

- **Versions are immutable snapshots** of a document's source:
  `{ id, documentId, version, createdAt, sha256, source }`. They live in a
  second IndexedDB store, `versions` (database version 2), indexed by
  document. Deleting a document deletes its versions.
- **Semantic versioning.** The first version is **0.1.0** (semver: 0.x means
  "draft"), or 1.0.0 if the first save is a major release.
  - **Save version** bumps the patch by default; minor and major are chosen
    in the explorer.
  - Saving unchanged text as a patch returns the latest version instead of
    duplicating it. Minor and major always create a release.
- **Checksum:** SHA-256 (Web Crypto) of the exact UTF-8 bytes of the
  version's `.tex`, identical to `shasum -a 256 <file>.tex`. The explorer
  shows the first 16 hex digits and the full hash on hover. A version
  downloads as `<name>-v<version>.tex`.
- **Download Preprint** saves a patch version if the text changed, then
  prints that snapshot. Older versions can be printed from the history; the
  preview shows the snapshot while printing and is restored afterwards. The
  stamp is app-level CSS in `@page` margin boxes, never written into the
  LaTeX:
  - `@bottom-left`: `Preprint · v0.1.1 · October 31, 2026`, the date in
    LaTeX's `\today` format;
  - `@bottom-right`: `SHA-256` and the first 16 hex digits.

  Both are in `\footnotesize`, on the page number's baseline (`\footskip`
  below the text). The PDF's default name is
  `<name>-v<version>-preprint.pdf`.
- **Verified** with a real Chromium-printed PDF: the footer reads
  `Preprint · v0.1.0 · October 31, 2026   1   SHA-256 8f042c51e87fa114`, and
  `sha256sum` of the fixture source starts `8f042c51e87fa114`.

## Consequences

- The PDF shows a 64-bit prefix of the hash, like a git short hash. The full
  hash is in the app and is reproducible from the `.tex` download.
- Versions are kept forever until their document is deleted. Pruning or
  export can come later.
- With elsarticle (roadmap), its own "Preprint submitted to …" footer may
  replace or join this stamp; that is decided then.
