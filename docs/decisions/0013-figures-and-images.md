# 0013: Figures, `\includegraphics` and the image store

Status: accepted. The maintainer chose per-document folders with reuse across
documents, upload/drag-and-drop/paste only, and placeholders for PDF figures.

## Context

Roadmap step 9b: the `figure` float and `\includegraphics`, with images the
user adds in the app. Documents must stay standard LaTeX that compiles with
pdflatex and graphicx (AGENTS §14 rule), so the image store has to behave
like a project folder: `\includegraphics{plots/energy}` names a file, and
an exported project must compile unchanged. AGENTS §9 allows only
project-local image references. The CSP now allows `img-src 'self' data:`.

## Decision

- **Formats: what pdflatex reads.** PNG and JPEG are stored and shown.
  PDF figures, which are common in LaTeX, are stored so an export still
  compiles. The browser can't draw a PDF into the page without PDF.js,
  which is a non-goal, so the preview shows a framed placeholder at the
  figure's size, with its name and an info diagnostic. SVG, GIF and WebP are
  refused at import with a message: pdflatex can't include them.
- **Per-document folders, shared bytes.** Each document has its own image
  folder, so `fig1.png` in two papers never clashes. The LaTeX stays plain
  `\includegraphics{fig1}`, with no hidden prefixes in names or labels,
  which would break pdflatex and export. The bytes are content-addressed, in
  two IndexedDB stores (database version 4):
  - `imageBlobs`: `{ sha256, blob, info }`, one per distinct file, where
    `info` is the parsed header (type, pixel size, resolution, or a PDF's
    page box);
  - `images`: `{ id: documentId + '/' + name, documentId, name, sha256,
    updatedAt }`, where `name` is the path as `\includegraphics` reads it,
    e.g. `plots/energy.png`.

  "Reuse from another document" adds an `images` entry pointing at the
  same blob, with no copy. Importing the same file twice stores it once. A
  name already used in the folder gets a visible numbered suffix
  (`fig1-2.png`). A blob is deleted when its last entry is. The upgrade
  follows ADR 0005's multi-tab rules. Entries and blobs change in one
  transaction, so a blob is never orphaned. Deleting a document deletes
  its folder. The logic is `src/workspace/image-library.ts`, and the pure
  parts are in `src/images/`.
- **Name resolution like graphicx.** An argument with an extension must
  match exactly. Without one, try pdflatex's `\DeclareGraphicsExtensions`
  order: `.pdf`, `.png`, `.jpg`, `.mps`, `.jpeg`, `.jbig2`, `.jb2`, then
  the upper-case forms (pdftex.def). `\graphicspath{{dir/}}` prefixes are
  tried in order. The resolver is a pure function with unit tests.
- **Natural size like pdfTeX.** The natural size is pixels / resolution
  inches (pixels × 72 / dpi in bp). The resolution comes from the PNG
  `pHYs` chunk or the JPEG JFIF density, rounded to whole dpi, defaulting
  to 72 dpi (`\pdfimageresolution` in TeX Live's pdftexconfig). The
  rounding is as recalled from pdfTeX's `writepng.c`, not re-read. Exif
  density is not read. A PDF's size is its first `/CropBox`, else its
  `/MediaBox`, when it isn't inside a compressed object stream.
  `fixtures/figure-basic` checks this: `pdfimages -list` shows pdflatex
  placing the 600 px plot at 300 ppi, exactly 2in.
- **graphicx keys** (`src/render/graphics.ts`), applied in the order
  written, as graphicx does: `width`, `height`, `totalheight` (aspect ratio
  kept when only one is given), `keepaspectratio`, `scale`, `angle`
  (multiples of 90°: size keys before it scale the image, size keys after
  it scale the turned box), `natwidth`/`natheight`, and `draft`/`final`.
  Lengths go through `parseLength`, so `0.5\linewidth` works. `trim`,
  `clip`, `viewport`, `page`, `bb` and other keys warn
  (`syntax/unsupported-graphics-option`) and are ignored.
- **Rendering.** The image is an `<img>` with an exact `width`/`height` in
  pt (bp), from a `blob:` URL made from the stored blob, one per distinct
  file (`src/render/image-urls.ts`). A URL is revoked once no image name in
  the document uses it. Printing waits for every image to decode. The
  image sits on the baseline with no depth, like a TeX box. An `<img>` never runs script, but this also
  needs `img-src blob:` in the CSP (a relaxation; see Consequences).
  `to-dom.ts` accepts an image `src` only when it is a blob URL the
  renderer issued. Strings from the document never become a `src`.
- **Missing image.** pdflatex stops with "File not found". We render a
  framed box with the name (like graphicx `draft`) at the requested size, or
  at 1in × 0.75in when no size is given. We raise `ref/missing-image` (an
  error) at the argument. A quick fix that opens the file picker needs a
  command-style fix, which ADR 0011's text-edit fixes can't express. That
  is left for later.
- **`figure` float.** This reuses the `table` float and the in-place `[h]`
  spacing from ADR 0012, measured against pdflatex:
  - an image that opens the float has its top at the float's top, with no
    interline glue;
  - `\abovecaptionskip` comes before the caption;
  - a float that ends with a caption is followed by `\intextsep` alone,
    because TeX's float box includes the caption's depth (`\@endfloatbox`),
    which cancels the `\prevdepth` term;
  - paragraphs in floats have no indent (`\@parboxrestore`).

  `\centering` (and `\raggedright`/`\raggedleft`) at the start of a
  paragraph now wraps the rest of its group in a block. Before, it wrapped
  inline text in a `span`, where `text-align` has no effect.
- **Adding images.** The explorer gets an Images section for the open
  document (like Bibliography), with upload, drag-and-drop and paste from
  the clipboard, plus "Reuse from another document".
  This is its own component, `<image-panel>`. A pasted screenshot becomes
  `pasted-image.png` (numbered on a clash), renamable, and a pasted file
  keeps its name. Rename accepts folders (`figs/energy`) and keeps the
  type's extension. Each image can copy
  `\includegraphics[width=\linewidth]{name}` to the clipboard, be
  downloaded, or be deleted. Typeahead inside `\includegraphics{` is left
  for later.
- **No import from a URL.** It would need `connect-src https:` for any
  host and would still fail wherever the host sends no CORS headers.
  Copying an image in the browser and pasting it covers most cases.

## Consequences

- CSP: `img-src` gains `blob:`. `connect-src` is unchanged.
- Database version 4. Tabs open on version 3 see the existing upgrade
  notice.
- Later: `\includegraphics{` typeahead, an "Add image…" quick fix for a
  missing image, Exif resolution, and a project zip export that writes each
  document's folder next to its `.tex`.
- Zotero attachments (step 9 plan) can arrive later through the same store.
  The local API serves files, but that needs a separate check of its CORS
  behaviour.
