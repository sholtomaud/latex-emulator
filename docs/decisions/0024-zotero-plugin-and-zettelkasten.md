# 0024: Our Zotero plugin: an MCP server with Zettelkasten tools

Status: accepted. Phase 1 (the plugin, pairing and read tools, tested in
a real Zotero) is built; phases 2–4 are not.

## Context

Zotero is the user's long-term store of sources, annotations and notes. The
app reads it today (ADR 0009, 0011), but cannot write to it. Its local API
on port 23119 is read-only, and that will not change. The backlog
(item 4) asks for:

- writes into Zotero from the app: notes, preprint versions, a
  document's references as a collection;
- a **Zettelkasten** kept in Zotero (permanent notes with Luhmann IDs,
  links between them, literature notes from annotations) that the writing
  assistant (ADR 0023) and outside agents (Claude Code, Claude Desktop) can
  search, follow and extend;
- an "install" button in the app.

Writing to `zotero.sqlite` directly corrupts libraries while Zotero runs,
so writes need code running inside Zotero: a plugin.

**Prior art.**

- [`cookjohn/zotero-mcp`](https://github.com/cookjohn/zotero-mcp) is a
  Zotero plugin serving MCP over streamable HTTP on its own port (23120).
  Forks add note writing.
- `54yyyu/zotero-mcp` is a Python server: the local API for reads, the web
  API for writes, and an optional embedding index.

Neither has Zettelkasten tools, and neither lets a web page pair with it
safely: cookjohn's runs a second listener with no origin pairing.
Following the user's decision (backlog), we write our own and keep it
small.

**What Zotero's built-in server allows** (read from
`chrome/content/zotero/xpcom/server/server.js`, Zotero `main`, November
2026):

- A plugin can add an endpoint to the server on 127.0.0.1:23119
  (`Zotero.Server.Endpoints['/path']`). Better BibTeX's JSON-RPC endpoint
  works this way.
- Requests that look like they come from a browser (a `Mozilla/` user
  agent or an `Origin` header) are dropped. The exception is an endpoint
  that sets `allowRequestsFromUnsafeWebContent`.
- The server answers every `OPTIONS` preflight itself, with no CORS
  headers. So a web page can only make **simple requests**: `POST` with
  `Content-Type: text/plain` and no custom headers.
- An endpoint's `init()` returns `[status, headers, body]`, so it can add
  `Access-Control-Allow-Origin` to its own responses.
- Responses are HTTP/1.0 and whole, with no streaming. MCP's streamable
  HTTP allows a plain JSON response, so no streaming is needed.

**What browsers do.**

- Chromium asks the user before a public HTTPS page reaches loopback
  ("Local Network Access"; since Chrome 145 the `loopback-network`
  permission), and wants `fetch(…, { targetAddressSpace: 'loopback' })`.
- Brave has its own "localhost access" permission.
- Both prompt once per site.
- The app's CSP already allows `http://127.0.0.1:23119` (ADR 0009).

## Decision

### 1. A Zotero plugin in this repository

- **Where:** `zotero-plugin/` in this repo, not a separate repo.
  - It shares pure modules with the app: citation keys (ADR 0008) and
    the JSON-RPC message types.
  - It is tested by the same CI.
  - It ships with the site.
- **Language:** TypeScript under the same rules (erasable, no runtime
  dependencies).
- **Build:** `scripts/build-zotero-plugin.ts` bundles it into one script
  with Vite's library mode (IIFE), writes `manifest.json` and
  `bootstrap.js`, and zips the `.xpi` with the app's own zip writer.
  There is no new dependency.
- **Shipped with the Pages build:**
  - `/<base>/zotero/latex-emulator-zotero.xpi`;
  - its `updates.json`, which the manifest's `update_url` points to, so
    Zotero updates the plugin itself;
  - the service worker precaches the `.xpi`, so the button works offline.
- **Zotero versions:** the ones the CI checks, which is Zotero 10 at
  phase 1 (10.0.8 was current; this record first said 7 and 8). The
  manifest allows `10.0` to `10.*`. It widens only when another version
  is tested.

### 2. MCP on Zotero's own port, no second listener

- **The endpoint** is `POST http://127.0.0.1:23119/latex-emulator/mcp`.
  It speaks MCP's streamable HTTP with JSON responses only: one JSON-RPC
  message in, one out, no SSE and no sessions.
- **Two kinds of client:**
  - **Outside agents** (Claude Code, Claude Desktop through `mcp-remote`,
    llama.cpp tool-calling front ends). They send ordinary MCP:
    `application/json` and `Authorization: Bearer <token>`. They send no
    `Origin`, so Zotero lets them through.
  - **The app**, a web page. It sends simple requests only:
    `text/plain` bodies holding the JSON-RPC message, with the token in
    `params._meta["latex-emulator/token"]` (MCP reserves `_meta` for this
    kind of thing). It sends no custom headers, so the browser never
    preflights.
- **Why not a second port, like cookjohn's?** A port of our own would
  allow full CORS preflights, but it needs our own HTTP server, can clash
  with other software, and needs a CSP change. Zotero's server is already
  loopback-only and maintained by Zotero. The simple-request limit is the
  only cost.
- **The client in the app** is a small JSON-RPC client of our own (no MCP
  SDK, AGENTS §2) in `src/references/zotero-mcp.ts`. It is pure, apart
  from the injected `fetch`.

### 3. Security: pairing, origins, tokens

Anything on the computer can reach 127.0.0.1, and any web page can try to.
So:

- **Origin check.** A request with an `Origin` must come from an origin
  on the plugin's allowed list. The list starts with the Pages origin;
  `localhost` dev origins are added in the plugin's settings. Other
  origins get 403, without CORS headers.
- **Host check** against DNS rebinding: `Host` must be `127.0.0.1:23119`
  or `localhost:23119`. MCP asks servers to do this.
- **Every call needs a token.** Tokens are random 256-bit strings,
  stored in Zotero's preferences, one per client, each named and
  revocable in the plugin's settings pane.
- **Pairing the app.**
  - The app's "Connect" button sends `pair/request` with the app's name.
  - Zotero shows a dialog: "LaTeX Emulator at https://… wants to read and
    write your Zotero library. Code: 4 7 1 9". The app shows the same
    code.
  - If the user allows it, the plugin returns a token. The app keeps it
    as the user chose for API keys: for the session, or stored encrypted
    if they opt in (backlog, user preferences).
  - No request is sent until the user clicks Connect, because the
    browser's local-network prompt should come from a click, not from
    page load.
- **Pairing an outside agent.** The settings pane has "Add an MCP
  client". It makes a token and shows the config to paste, for example
  `claude mcp add --transport http zotero http://127.0.0.1:23119/latex-emulator/mcp --header "Authorization: Bearer …"`.
- **Writes are limited.**
  - Every write uses Zotero's own JavaScript API
    (`new Zotero.Item('note')`, `saveTx()`), never SQL.
  - Nothing is deleted: "remove" tools move items to Zotero's trash.
  - Each token's scopes (`read`, `write-notes`, `write-items`) are set at
    pairing.
- **Agents' notes go to an inbox.** A note made by an agent is tagged
  `zk/inbox` until the user accepts it (removes the tag) in Zotero. This
  is Luhmann's fleeting → permanent step, and it keeps the user in
  charge of what enters the Zettelkasten.

### 4. The Zettelkasten in Zotero

- **A permanent note** (zettel) is a standalone Zotero note in a
  collection (default "Zettelkasten", set in the plugin's settings).
- **The note's first line is its title,** in the form
  `<Luhmann ID> <declarative title>`, for example
  `1a2 Energy flows set the limits of growth`. Zotero shows the first
  line as the note's title, so a person scanning Zotero sees the same
  thing an agent does.
- **Luhmann IDs** alternate numbers and letters: `1`, `1a`, `1a1`, `1a1b`.
  - A pure module (`zotero-plugin/src/luhmann.ts`) parses them, orders
    them (`1a2` before `1a10`), finds the next sibling (`1a2` → `1a3`)
    and the first child (`1a2` → `1a2a`), and rejects duplicates.
  - IDs are not stored anywhere else, so they can't disagree.
- **Links are Zotero's Related relation** (symmetric). A zettel is also
  Related to the sources it draws on, so "show the sources" and "show the
  zettels on this source" are both one hop.
- **Literature notes** are child notes of an item, built from its PDF
  annotations in Zotero's own note-from-annotations format, so its
  citations and page links keep working in Zotero.
- **No vector index at first** (backlog). Agents use Zotero's search,
  scan zettel titles, and follow Related links and Luhmann sequences. If
  entry points prove hard to find, embed only zettel titles and bodies
  with `llama-server --embedding`, in the plugin's own file.

### 5. Tools

**Read** (`read` scope):

| Tool              | Does                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `search_items`    | Zotero quick search; each hit with its citation key, title, creators, year, `zotero://` link (and its CSL-JSON with `include_csl`) |
| `get_item`        | metadata, BibTeX (Better BibTeX's key if installed, else ours, ADR 0008), attachments                                              |
| `get_annotations` | an item's PDF annotations with page labels                                                                                         |
| `get_fulltext`    | an attachment's indexed text, by page range                                                                                        |
| `zettel_list`     | zettels by ID prefix (`1a` → the whole branch), in Luhmann order                                                                   |
| `zettel_get`      | one zettel with its links, sources and neighbours in the sequence                                                                  |
| `zettel_search`   | full-text search within the Zettelkasten only                                                                                      |

**Write** (`write-notes` scope):

| Tool                            | Does                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `zettel_create`                 | a new zettel after a given ID (sibling) or under it (child), or a new top-level ID; tagged `zk/inbox` |
| `zettel_update`                 | change a zettel's title or body; the ID is kept                                                       |
| `zettel_link` / `zettel_unlink` | add or remove a Related link between zettels, or to a source                                          |
| `zettel_tag`                    | add or remove tags                                                                                    |
| `literature_note_create`        | a child note on an item from its annotations                                                          |

**Write** (`write-items` scope), later phases:

- `collection_from_keys`: a document's cited entries (ADR 0020) as a
  Zotero collection;
- `preprint_save_version`: a labelled version (ADR 0006) becomes or
  updates a `preprint` item with the project zip attached, and the PDF if
  the user adds it. The item links to the project folder (ADR 0015 B),
  and the document keeps the item's `zotero://select/…` link.

Tool inputs and outputs are typed in one module, shared by the plugin and
the app's client, and published as MCP `inputSchema`/`outputSchema`.

### 6. The app's side

- **References view** gains a "Zotero plugin" section, hidden until asked
  for:
  - "Get the plugin" downloads the `.xpi`, with the steps: Zotero →
    Tools → Plugins → ⚙ → Install Plugin From File. A web page can't
    install it in one click.
  - "Connect" pairs as above, and shows the code.
  - Then: "Connected to Zotero 7.x, plugin 0.y" or what to check.
- **Once connected,** the Zotero search (ADR 0009) goes through the
  plugin. Its keys and BibTeX come from Zotero (Better BibTeX if
  present). The local API's "allow other applications" setting is then
  no longer needed.
- **The assistant** (ADR 0023) gets the same tools, through the same
  client, when it arrives.

### 7. Tests

- **Unit, plugin core.** The core runs against a `ZoteroPort` interface
  (search, get, save note, relate, tag, trash). The tests use an
  in-memory fake. The coverage gate applies to:
  - MCP dispatch (initialize, `tools/list`, `tools/call`, errors);
  - origin, host and token checks; pairing;
  - each tool;
  - Luhmann IDs and note HTML.
- **Unit, app client.** Simple-request framing, the token in `_meta`,
  error mapping.
- **E2E.** The References view's install, connect and search flows, with
  the plugin endpoint mocked by `page.route` (AGENTS §10: no network).
- **Real Zotero in CI** (a new `zotero` job). Download Zotero's Linux
  build, install the freshly built `.xpi` into a clean profile, run
  Zotero headless under Xvfb, and drive the endpoint from Node:
  - pair;
  - create, link and list zettels;
  - check that a browser-like request from another origin is refused.

  Better BibTeX tests against a real Zotero the same way. If it proves
  flaky, it becomes a nightly job and a manual checklist in
  `zotero-plugin/README.md`. It is never skipped silently.

### Phases (one PR each)

1. **Plugin skeleton and read tools** (built).
   - The build, `.xpi` and `updates.json` on Pages.
   - The endpoint, pairing, origin, host and token checks.
   - `search_items`, `get_item`.
   - The settings pane.
   - The References "Get the plugin" and "Connect" buttons.
   - The CI job with a real Zotero.

   What building it settled:

   - **Layout.** The pure core (`zotero-plugin/src/*.ts`) is unit-tested
     against a fake `ZoteroPort` under the coverage gate. The code that
     runs only inside Zotero (`zotero-plugin/src/zotero/`) is tested by
     `npm run test:zotero` and is outside the gate. The build is
     `scripts/build-zotero-plugin.ts`: Vite's library mode and the app's
     zip writer.
   - **What the real Zotero showed** (Zotero 10.0.8, CI job `zotero`):
     - Zotero's server already refuses a foreign `Host` (400) before any
       endpoint runs, so our 403 is a second layer.
     - It refuses a POST without `Content-Length`; browsers and fetch
       always send one.
     - Just after start-up its translators may still be loading, so the
       BibTeX export awaits `Zotero.Translators.init()`.
     - Its table of status texts lacks 202, 401 and 405. The plugin adds
       them while it runs and removes them when it stops.
   - **`initialize`** also returns Zotero's version in
     `_meta["latex-emulator/zotero-version"]`, for the app's status line.
   - **Where the app keeps the token.**
     - By default, for this session only.
     - With "Remember this connection on this device (stored encrypted)",
       it is encrypted with AES-GCM under a non-exportable key, in a
       database of its own (`src/storage/secret-store.ts`,
       `secret-db.ts`). It is never in `localStorage` or in backups.
     - This protects the token from being read out of storage or a copied
       profile. It does not protect it from code running on the app's own
       origin.
     - The zotero.org API key (ADR 0009) can move to the same store later.
   - **Where the plugin keeps tokens:** in plain text in Zotero's
     preferences (`prefs.js` in the Zotero profile), like other local
     settings. Anyone who can read that profile can already read the
     library itself.
   - **Pairing** shows Zotero's own confirm dialog, with Deny as the
     default. The settings pane lists clients with Remove, adds an MCP
     client (and shows the `claude mcp add` command), and edits the
     allowed websites. A development origin such as
     `http://localhost:5173` must be added there.
   - **The pane and the dialog are not exercised in CI**: a headless Zotero
     can't click them. Their logic (`config.ts`: dialog text, settings
     parsing) is unit-tested, and they are on the manual checklist in
     `zotero-plugin/README.md`.

2. **Zettelkasten** (built, plugin 0.3.0: the zettel tools; literature
   notes, `get_annotations` and `get_fulltext` still to do).
   - Zettels are standalone notes in one top-level collection,
     "Zettelkasten" unless renamed in the settings pane, made the first
     time a zettel is written (the maintainer chose standalone notes over
     child notes of the cited items: a zettel can draw on several
     sources).
   - `luhmann.ts`: IDs alternate numbers and letters (letters run a…z,
     aa…, so a branch never runs out); a branch sorts right after its
     parent. `zettel-note.ts`: the note is `<h1>ID title</h1>` and
     paragraphs; a note whose first line isn't `<ID> <title>` is not a
     zettel and is left alone. A duplicated ID: the first in Zotero's
     order counts.
   - **Placement** (`zettel_create`): `after X` takes X's next sibling,
     or, if that is taken, a new branch under X (Luhmann's way of
     inserting between notes); `under X` takes the child after X's last;
     neither takes the next top-level number. Writes are serialised, so
     two at once never get the same ID.
   - `zettel_update` with only a title rewrites the first line and keeps
     the rest of the note, formatting included; with a body it rewrites
     the note as plain paragraphs.
   - Links take a zettel (`zettel`, an ID) or a source (`item`, a key),
     never one string for both: an all-digit item key would also be a
     valid Luhmann ID.
   - `write-notes` tools write only zettel notes, their tags and Related
     links. Outside agents get it only if "Also let it create and change
     zettels" is ticked; the app still pairs read-only until the
     assistant's zettel suggestions need it (ADR 0023 §5).
   - Checked in a real Zotero 10.0.8 (`npm run test:zotero`): the
     collection is made on first write, Related shows from both sides,
     tags and retitling persist.
3. **App integration.** ✅ Zotero search and typeahead through the
   plugin (brought forward, November 2026: with the plugin paired, the
   app still searched through Zotero's local API, which drops requests
   from web pages, so the typeahead paused):
   - `search_items` takes `include_csl` (plugin 0.2.0): each item's
     CSL-JSON, so hits become `.bib` entries exactly as the web API's do
     (ADR 0009). Off by default, to keep agents' results short. A
     boolean joined the schema checker.
   - In the app, "This computer" searches (the References search and the
     opt-in typeahead) go through the plugin whenever a connection token
     is stored; without one they take the old route, whose message now
     points to the plugin. The zotero.org web library is unchanged. A
     change of connection resets a paused typeahead.
   - Plugin 0.1.0 rejects `include_csl`: the app says to update the
     plugin in Zotero (Plugins → Check for Updates; `updates.json`).
   - Still to do: `collection_from_keys`.
4. **Preprint versions.** `preprint_save_version` and linked project
   files.

## Consequences

- One install gives the app and any MCP-capable agent the same view of
  the library and the Zettelkasten, with no Python or Node to install and
  no second port.
- Plugin endpoints are a Zotero internal, not a published API. A Zotero
  release could change them, which is why the CI job runs the real thing.
  The rest of the plugin is ordinary Zotero plugin code.
- **AGENTS changes when built:**
  - §9: the app sends search text and the user's notes to the plugin on
    127.0.0.1, only after the user connects;
  - §5: adds `zotero-plugin/`;
  - §10: adds the `zotero` CI job.
- The user's library becomes writable by agents. The token scopes, the
  trash-only rule and the `zk/inbox` tag are the guard rails, and the
  plugin's settings list every paired client.
- Simple requests mean the app's client is not a textbook MCP client
  (`text/plain`, the token in `_meta`). Outside agents use standard MCP,
  and the plugin accepts both.
