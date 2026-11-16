// LaTeX Emulator service worker (ADR 0021). Hand-written; after `vite
// build`, scripts/precache.ts replaces the marker below with the build's
// file list and version, so every release changes this file and browsers
// notice the update.
//
// Offline-first: the app's own files come from the cache, so it starts
// with no network at all (or a bad one). Requests to other origins (doi.org,
// Zotero, local services such as llama.cpp) are never cached or answered
// here: they go to the network as usual.

const PRECACHE = /* __PRECACHE__ */ null;
const PREFIX = 'latex-emulator-';
const CACHE = PREFIX + (PRECACHE ? PRECACHE.version : 'unbuilt');
const here = (path) => new URL(path, self.location).href;

self.addEventListener('install', (event) => {
  if (!PRECACHE) return; // an unbuilt copy has nothing to cache
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Bypass the HTTP cache: a stale index.html would pin old assets.
      await cache.addAll(
        PRECACHE.files.map((f) => new Request(here(f), { cache: 'reload' }))
      );
      // The first install takes over at once. An update waits until the
      // page asks (the user clicks Reload), so a tab is never swapped to
      // new code mid-edit.
      if (!self.registration.active) await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys())
        if (name.startsWith(PREFIX) && name !== CACHE)
          await caches.delete(name);
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !PRECACHE) return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Every page of the app is the app: serve the cached start page.
      const hit =
        request.mode === 'navigate'
          ? await cache.match(here('./'))
          : await cache.match(request);
      return hit ?? fetch(request);
    })()
  );
});
