# 0015: Project folders, and saving them to OneDrive and Google Drive

Status: accepted; phases A (the zip download and its pdflatex check) and
B (save to a folder) are built, C and D are not. The maintainer agreed the direction and the
order of the phases. The points marked **verify** are
what is believed about the providers today, to be confirmed against them
in the phase that needs them.

## Context

Documents, `.bib` files and images live only in this browser's IndexedDB
(ADRs 0005, 0007, 0013). Users want them in a cloud drive they already
use, OneDrive or Google Drive, signed in with that account (and its MFA),
both as a backup and to reach them from other machines.

Constraints:

- No backend (§1). Everything runs in the page.
- `monaco-editor` is the only runtime dependency (§2), so no MSAL, no
  `gapi`, no Google Identity Services script.
- §9 says document content never leaves the device. Saving to a drive
  changes that, so it must stay something the user asks for, and §9 must
  say so once this ships.
- AGENTS §14's rule: browser conveniences never become new LaTeX syntax.
  What lands in the drive must be an ordinary LaTeX project.

## Decision

### 1. One project folder per document

Whatever the destination, a document is saved as the folder pdflatex would
need, built by one pure function (`src/workspace/project.ts`: document →
`{ path, bytes }[]`):

```
a-short-example/
├── a-short-example.tex
├── references.bib          # each .bib its \bibliography lists
├── 357ml_bucket.png        # the document's Images, at their own names
└── plots/energy.png        # names with folders keep them (ADR 0013)
```

- Images go **next to the `.tex`**, at the names `\includegraphics` uses.
  ADR 0013 already resolves names relative to the `.tex`, as pdflatex
  does, so the folder compiles without the app adding `\graphicspath`. An
  `images/` subfolder would break that.
- Only the `.bib` files the document's `\bibliography` lists are written.
  The `.bib` library is shared by all documents (ADR 0007), so each
  project gets its own copy of those files, holding only the entries the
  document cites (ADR 0020).
- The `.bst` styles we ship are TeX Live's standard ones. pdflatex finds
  them itself, so they are not copied.
- The folder and `.tex` names come from the document name, as `.tex`
  downloads already do (ADR 0005).
- A CI job (the "sample compiles in real pdflatex" check from §14 step 13)
  builds the folder for the fixtures and the starter document and runs
  `pdflatex`, `bibtex`, `pdflatex`, `pdflatex` on it. That is the test that
  "ordinary LaTeX project" stays true. It is `npm run check:projects`:
  `scripts/export-projects.ts` writes the folders with the app's own
  `buildProject()` (a fixture's `.bib` files become the library and its
  `images/` files its Images, at their base names, as importing them does),
  and `scripts/check-projects.sh` compiles each one. A folder fails on a
  LaTeX or BibTeX error, a missing file, or an undefined citation or
  reference. `figure-basic` shows the layout works even when the source
  says `\graphicspath{{images/}}`: graphicx tries the document's own folder
  first.

### 2. Destinations, in this order

**A. Zip download (built).** The folder as a `.zip`, with a small zip writer of our
own and the browser's `CompressionStream('deflate-raw')`. This works in
every browser, fills the "project zip export" item from ADR 0013, and
gives the folder logic and the CI check something to run on.

- "Project (.zip)" in the toolbar's Download menu (accessible name
  "Download project (.zip)"; ADR 0022) saves the open document as
  `<folder>.zip`, holding `<folder>/<folder>.tex` and the rest.
- `src/util/zip.ts` writes plain ZIP (APPNOTE 2.0 features, UTF-8 names, no
  ZIP64). Each file is deflated, or stored when deflating doesn't shrink it
  (PNG, JPEG). Every file gets the download's time. It refuses absolute
  paths, `..` and duplicates. Checked with Python's `zipfile` and `unzip -t`.
- A `\bibliography` file the library doesn't have is left out, and the
  download still happens: the editor already flags it
  (`ref/missing-bib-file`), and `buildProject()` returns it in
  `missingBibs` for later destinations that want to say so.

**B. Save to a folder on this computer (File System Access API).**
`showDirectoryPicker()`, then write the project folder into it. The folder
handle is kept in IndexedDB, so later saves only need the browser's
permission prompt (`requestPermission`), not a new pick.

- This needs no sign-in, no app registration and no CSP change.
- If the user picks a folder that the OneDrive or Google Drive desktop app
  syncs, the project is in their cloud drive.
- It works in Chrome and Edge, and in Brave once the user turns it on:
  Brave is Chromium but blocks the pickers by default
  (brave-browser#11407), so the panel tells Brave users where to enable
  it. The app tests for the API, not the browser, so nothing else is
  needed. Elsewhere the panel points to the zip download (§7's browser
  policy).

Built as follows:

- **Where.** The Storage panel (ADR 0019) has a "This document’s folder"
  block: Save to folder…, Open folder…, "Save there as I type", and Stop
  saving to this folder.
- **First save.** It picks a folder (`showDirectoryPicker`, read/write) and
  creates the project folder inside it. The handle goes in a small
  database of its own (`latex-emulator-folders`), so the documents
  database keeps its version and open tabs aren't made read-only. Handles
  are tied to this browser, so workspace backups leave them out.
- **Later saves** write only files whose content changed
  (`src/workspace/folder-save.ts`, pure). The `.tex` keeps the name it
  first had in the folder, so renaming the document doesn't leave a
  second `.tex`. Files no longer in the project (a deleted image) are left
  alone: we never delete the user's files.
- **Changes made in the folder are never overwritten silently.** We keep
  each file's SHA-256 from the last save. A file that is different now (an
  edit in another editor, a sync from another machine) is a conflict. The
  save then writes nothing and offers Overwrite or Cancel. The first save
  into a folder that already holds a different project of that name is a
  conflict too.
- **Permission.** Browsers forget folder permission between visits. A save
  by hand asks again; automatic saves never ask, they wait for a click.
- **Saving as you type** is opt-in per document. It runs after an autosave
  (1.5 s debounce), stops at a conflict, and resumes after a save by hand
  succeeds (`src/workspace/folder-sync.ts`).
- **Open folder…** reads a project folder into a new document:
  - the `.tex` at the top level (the one named after the folder, else the
    one with `\begin{document}`);
  - the `.bib` files its `\bibliography` lists;
  - only the images its `\includegraphics` resolve to, with
    `\graphicspath` and graphicx's extension order, at the same paths.
    The compiled PDF and unrelated files are ignored.

  The document then saves back into that folder. Its `.bib` files are
  merged into the library (ADR 0020): entries the library lacks are added;
  for a key in both the library's copy is kept and reported, and that file
  is not taken as the baseline, so the next save asks before replacing the
  folder's copy.

- **Tests.** The e2e tests replace the picker with folders in the origin
  private file system. These are real `FileSystemDirectoryHandle`s, so
  writes go through the same API. The Chromium build on some hosts closes
  the page when such a handle is read back from IndexedDB; the pinned
  image's does not. Run `e2e/specs/folder.spec.ts` in the container.

**B2. Versions on disk (proposed).** File names don't carry the version.

- **The working files** (`paper.tex`, its `.bib`, images) are the working
  copy, like a git working tree. Saves, and "save there as I type",
  overwrite them, with the conflict check above.
- **Each saved version (ADR 0006) is written once and never overwritten.**
  - Its `.tex` goes to `versions/paper-v1.2.0.tex`.
  - It is listed in `versions/versions.json` with its date, SHA-256 and
    label.
  - Labels (submitted, published…) can change later. Keeping them in the
    index instead of the file name means a relabel never renames a file.
- **Putting the version in the working file's name** (`paper-v1.2.0.tex`
  overwritten on autosave) would break `\include`s and `\bibliography`
  paths across bumps. It would also make every bump a new file that
  editors and sync tools treat as unrelated.
- **Download Preprint's PDF** is still named with version and label, since
  it is a snapshot.
- **Opening a folder** with a `versions/` folder brings its versions back
  into the history, verified against their SHA-256.

**C. OneDrive (Microsoft Graph).**

- **Sign-in:** authorization code with PKCE, in a popup, as a
  single-page-app client (no client secret). The popup returns to a small
  same-origin callback page that hands the code back with `postMessage`.
  We write the PKCE code (`crypto.subtle` SHA-256, about 200 lines) rather
  than use MSAL.
- **Accounts and MFA:** Microsoft's own sign-in page handles personal,
  work and school accounts, and MFA, passkeys and the organisation's
  conditional-access rules. The app never sees a password.
- **Scope:** `Files.ReadWrite.AppFolder` only. The app sees just its own
  folder (`Apps/<app name>`), never the rest of the drive. Each document is
  a subfolder there. **Verify:** that personal and work accounts both grant
  it without admin consent.
- **Calls:** `PUT /me/drive/special/approot:/<path>:/content` for small
  files, and an upload session for anything over 4 MB.

**D. Google Drive (Drive API v3).**

- **Sign-in:** Google's OAuth 2.0 flow for client-side web apps, in a
  popup to the same callback page. **Verify:** whether Google issues
  tokens to a browser-only client with PKCE and no secret. If it doesn't,
  use its token (implicit) response, which gives a roughly one-hour access
  token and no refresh token, so the user signs in again after that.
- **Scope:** `drive.file` only: files the app created (or the user opened
  with it). This avoids the full-Drive scope, which Google restricts and
  which needs a paid security assessment. **Verify:** what consent-screen
  review `drive.file` still needs for a public app.
- **Limit:** with `drive.file` and without Google's Picker (a script from
  `apis.google.com`, which §2 rules out), the app can open only projects
  it saved itself. That is enough for save and reopen.
- **Calls:** a folder per document under one app folder (`LaTeX Emulator`),
  with multipart uploads (`uploadType=multipart`, resumable over 5 MB).

C and D sit behind one interface (`CloudDrive`: `signIn`, `list`, `read`,
`write`, `remove`, `version`), so the explorer and the sync logic don't
know which provider they talk to. Fakes for tests implement the same
interface.

### 3. Saving and opening

- **IndexedDB stays the working copy.** The drive is where the user saves
  to and opens from; the editor never waits on the network, and offline
  editing (§11) keeps working.
- **Explicit at first:** "Save to OneDrive / Google Drive / folder" and
  "Open from …" in the explorer. Saving writes the whole project folder,
  skipping files whose content hash hasn't changed since the last save.
- **Changes made elsewhere are never overwritten silently.** For each
  document we remember the version the drive returned at the last save
  (Graph's `eTag`; Drive's `version`, or `modifiedTime` if that proves
  more reliable, to **verify**). If the drive's copy has moved on, the
  user chooses between overwriting it, saving as a new folder, or
  cancelling. Graph uploads send `If-Match`, so the check is atomic there.
  Drive has no such precondition, so on Google the check runs just before
  the upload and a small race remains.
- **Automatic saving** (after autosave, when online) is a later step, built
  on the same version check, and is off by default.
- **Opening** a project reads the `.tex`, the `.bib` files and the images
  into a new document. Images go through ADR 0013's import rules, and
  `.bib` files whose name is taken in the library get the existing
  "keep both" handling.

### 4. Tokens and privacy

- Access tokens, and Microsoft's refresh token, are kept in memory for the
  session only, like the Zotero API key (ADR 0009). After a reload the user
  signs in again. The provider usually does this with one click, without a
  password, while their browser session with it lasts. Nothing secret goes
  to `localStorage` or IndexedDB. The chosen provider and the drive's
  folder and item ids are kept, since they are not secrets.
- The client ids are public by design and are committed in the source. The
  app registrations (Microsoft Entra ID, Google Cloud) list the GitHub
  Pages URL and the local dev URL as the only allowed redirect addresses.
- **CSP** (`connect-src`) gains, phase by phase:
  - OneDrive: `https://login.microsoftonline.com` and
    `https://graph.microsoft.com`. **Verify:** the hosts that Graph's
    download redirects and upload sessions use (SharePoint and OneDrive
    storage hosts), so they can be listed exactly rather than with a
    broad wildcard.
  - Google Drive: `https://www.googleapis.com`, plus `https://oauth2.googleapis.com`
    if the code flow is used.
  - The sign-in pages open in a popup, which is navigation, not
    `connect-src`.
- §9 and §11 of AGENTS.md get updated in the PR that ships each phase.
  Document content goes only to the destination the user picked, only when
  they save, and nowhere else.

## Consequences

- Phases A and B deliver most of the value (a portable project, and cloud
  storage through a synced folder) with no accounts, no CSP change and no
  new privacy surface. C and D can follow when the API route is worth its
  setup.
- Someone with owner rights must create and maintain the Microsoft Entra
  ID and Google Cloud app registrations, including Google's consent-screen
  details. Sign-in can't be tested in CI. E2E tests replace the providers
  with `page.route` fakes (as for Zotero and doi.org), and each provider
  is checked by hand once, as Zotero was (ADR 0009).
- A project is a copy, not a link: the same image in two documents is
  written once into each project folder, unlike the shared bytes in
  IndexedDB (ADR 0013).
- Versions (ADR 0006) are not saved to the drive in this ADR; a
  `versions/` subfolder could come later.
- Firefox and Safari get the zip download and, after C and D, the drives,
  but not "save to folder".
- A folder synced by the OneDrive or Google Drive desktop app gives cloud
  storage today, with no sign-in. C and D remain for machines without the
  desktop app, and for Firefox and Safari.
