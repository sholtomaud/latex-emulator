# 0021: Offline-first: a service worker and an installable app

## Context

AGENTS §11 requires the app to work fully offline after the first load,
with a hand-written service worker. None existed: every visit downloaded
the app (5.3 MB, 3.4 MB of it Monaco), so on a poor connection it didn't
start at all. Documents were in IndexedDB, but the app needed to reach them
couldn't load. Offline use matters even more with local services (the
planned Zotero plugin, llama.cpp), which work without the internet.

## Decision

- **A hand-written `public/sw.js`, filled in by the build.**
  - After `vite build`, `scripts/precache.ts` (logic in
    `src/pwa/precache.ts`, pure) lists every file of the build and replaces
    the marker in the built `sw.js` with that list and a version (a short
    SHA-256 of every file's name and bytes). Every release therefore
    changes `sw.js`, which is how browsers notice an update.
  - The worker itself, `404.html` and `.nojekyll` are not listed.
  - `npm run build` and `scripts/build-pages.sh` both run it.
  - There is no Vite config or plugin: a post-build script does the same
    job.
- **Offline-first caching.**
  - On install, every listed file goes into the cache
    `latex-emulator-<version>`, bypassing the HTTP cache.
  - Same-origin GET requests are answered from that cache, falling back to
    the network.
  - Navigations get the cached start page: every page of the app is the
    app, and its router handles the path, unknown ones included.
  - Requests to other origins are never cached or answered by the worker:
    doi.org, Zotero, and local services such as llama.cpp go to the
    network as before (AGENTS §9).
  - Activation deletes the caches of older releases.
- **Updates wait for the user.**
  - The first install takes over at once.
  - A later release downloads and caches in the background, then waits. The
    app shows "A new version of LaTeX Emulator is ready." with a Reload
    button.
  - Reload tells the waiting worker to take over. The page reloads when it
    does, and the reload's `pagehide` flushes unsaved text.
  - A tab is never switched to new code mid-edit, and the app checks for a
    release whenever it comes back to the front.
  - Only a change of controller after the first is treated as an update.
    A test found that a check made once at page load ignored updates in the
    tab where the app was first installed.
- **Production builds only.** `src/pwa/register.ts` registers the worker
  only when `import.meta.env.PROD`, with scope `BOBA_BASE_URL`, so the
  Pages build's worker covers `/latex-emulator/`. The Vite dev server
  serves modules that change on every edit, so it has no worker.
- **Installable.**
  - `public/manifest.webmanifest`: name, `start_url` and `scope` `./`
    (relative to where the app is served), `display: standalone`, theme
    colours.
  - Icons at 192 and 512 px, a maskable 512 px icon and the SVG favicon.
    `scripts/make-icons.ts` renders the PNGs from `public/favicon.svg`.
  - An installed app also helps Chrome grant persistent storage
    (ADR 0019).

## Consequences

- After one visit, the app starts, edits, previews, prints and saves to
  IndexedDB with no network. Tests:
  - `e2e/specs/offline.spec.ts` (production build): offline start with no
    failed requests and fonts loaded; one cache, named by the build; a new
    release waits for Reload, then replaces the old cache; the manifest and
    icons.
  - `e2e/pages/pages.spec.ts`: works offline under `/latex-emulator/` (and
    on the live site after each deploy).
- The first visit downloads everything once, about 5.3 MB, Monaco included,
  so later visits on a poor connection cost nothing. Splitting Monaco out
  of the precache, to cache it on first use instead, is possible if the
  first visit proves too heavy.
- The update test publishes a release by rewriting `dist/sw.js`, because
  Playwright's routing doesn't see a worker's update check. That file's
  tests run serially, and repeat runs need `--workers=1`.
- Offline-only features are still limited by what is local. DOI lookups
  and the Zotero web library need the network, and they say so when it's
  missing.
