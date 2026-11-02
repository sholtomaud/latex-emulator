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

- **Zotero on this computer does not work from a web page, by Zotero's
  design** (checked against a real Zotero, November 2026). There are two
  blockers, and either one is enough:
  - **Zotero refuses browser requests.** Its HTTP server
    (`chrome/content/zotero/xpcom/server/server.js`, `_processEndpoint`)
    treats a request as coming from a browser if its User-Agent starts with
    `Mozilla/` or it has an `Origin` header. It drops such a request unless
    it carries `X-Zotero-Connector-API-Version` or `Zotero-Allowed-Request`,
    or the endpoint opts in with `allowRequestsFromUnsafeWebContent`, and
    no endpoint does, the local API included. `_cancelResponse()` closes the
    connection without a reply, "so web content can't get any information
    about whether Zotero is running". A page can't add those headers either:
    a custom header needs a CORS preflight, and Zotero sends
    `Access-Control-Allow-Origin` only for its own bookmarklet origin.
  - **Chrome's Local Network Access check.** Called from
    `https://sholtomaud.github.io` with Zotero 11.0-beta.3 running, Chrome
    stopped the request before it left the browser: "blocked by CORS
    policy: Permission was denied for this request to access the
    `loopback` address space". Zotero's debug log showed no request at
    all. Granting the permission would only reach the first blocker.

  To check that the local API itself works, run
  `curl -i "http://localhost:23119/api/users/0/items/top?format=csljson&limit=1&q=a"`.
  curl isn't a browser, so Zotero answers it with 200 and CSL-JSON (seen
  with the same Zotero). In Zotero, Help → Debug Output Logging shows
  `Preventing request from browser` for a refused request that got through.

- **The local option stays, with an explanation.** While it is selected,
  a note under the picker (also its accessible description) says Zotero
  drops requests from web browsers and points to the zotero.org web
  library or a `.bib` exported from Zotero (the explorer's Import .bib
  button). A failed local search says the same. `fetch()` fails the same
  way whether Zotero refused the request or isn't running, so the message
  can't tell which happened. The opt-in typeahead (ADR 0011) has the same
  limit with the local library. The request code and its mocked e2e tests
  stay, so the option works as written if Zotero ever lets web pages in.
  Removing it would also be reasonable; we keep it because the explanation
  is useful to anyone who expects it to work.
- E2E tests mock both endpoints with `page.route`. The web library is
  unaffected by any of the above.
- Zotero's own citation keys (or Better BibTeX's) are not reused: entries get
  this app's `author_topic_year` keys, unique across the library.
- Collections, pagination beyond 25 results and two-way sync are left for
  later.
