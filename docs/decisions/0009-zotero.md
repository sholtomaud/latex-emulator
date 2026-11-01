# 0009: Zotero, on this computer and on zotero.org

## Context

Roadmap step 7: bring references in from Zotero, either from the Zotero
desktop app on the user's computer or from their zotero.org web library.
There is no backend (§1), and documents must stay standard LaTeX + BibTeX.
A sister project (`sholtomaud/budget-app`, ADR 0021 there) already talks
to a local llama.cpp server on `localhost` from its GitHub Pages site. Its
approach is to allow `http://localhost:*` in `connect-src` and use plain
`fetch`. The local server answers with `Access-Control-Allow-Origin`.

## Decision

- **One protocol, two hosts.** Zotero 7's local API mirrors the Web API v3:
  - on this computer: `http://localhost:23119/api/users/0/…`, no key;
  - on zotero.org: `https://api.zotero.org/users/<id>/…` with a
    `Zotero-API-Key` header.

  Both are searched with `items/top?format=csljson&q=…`. The answer is
  CSL-JSON, so results go through the same converter and `author_topic_year`
  keys as DOI lookups (ADR 0008), and the user's `.bib` files stay plain
  BibTeX.
- **API key: this session only.** The zotero.org key is held in memory and
  never stored, matching budget-app's ADR 0020; the user re-enters it after a
  reload. The library choice and user ID are small preferences in
  `localStorage`.
- **CSP:** `connect-src` gains exactly `https://api.zotero.org`,
  `http://localhost:23119` and `http://127.0.0.1:23119`. A page served over
  HTTPS may call `http://localhost`, because browsers treat loopback as
  potentially trustworthy, so it isn't blocked as mixed content.
- **Errors say what to check.** If Zotero doesn't answer, the app asks the
  user to start Zotero 7 and turn on Settings → Advanced → "Allow other
  applications on this computer to communicate with Zotero", and to allow
  the browser's local-network prompt if one appears. Other errors:
  - 403 from the local API: that setting is off;
  - 404 from the local API: the Zotero version is too old;
  - 403 or 404 from the web: a bad key or user ID.
- **Only the search text is sent**, and only on an explicit search. Document
  content never leaves the device (§9).

## Consequences

- **Not yet verified against a real Zotero.** The development sandbox had
  neither Zotero nor network access. Two things must be checked by hand:
  - whether Zotero's local API sends CORS headers for a web page's origin;
  - Chrome's Local Network Access permission prompt when the Pages site
    calls `localhost`.

  E2E tests mock both endpoints with `page.route`. If Zotero rejects
  browser origins, the local option needs a different route; the web
  library is unaffected.
- Zotero's own citation keys (or Better BibTeX's) are not reused: entries get
  this app's `author_topic_year` keys, unique across the library.
- Collections, pagination beyond 25 results and two-way sync are left for
  later.
