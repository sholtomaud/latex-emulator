# LaTeX Emulator for Zotero

A Zotero plugin that serves your library over [MCP](https://modelcontextprotocol.io)
to the LaTeX Emulator and to AI agents such as Claude Code. The design is in
[ADR 0024](../docs/decisions/0024-zotero-plugin-and-zettelkasten.md).

- **Phase 1:** pairing, and two read tools: `search_items` and
  `get_item`.
- **0.2.0:** the app's Zotero search and citation typeahead go through
  the plugin (`search_items` with `include_csl`).
- **0.3.0:** the Zettelkasten tools (below).
- **Later:** PDF annotations, full text and literature notes; preprint
  versions.

## Install

1. Get the `.xpi`, either:
   - from the app: References → Zotero plugin → **Get the Zotero plugin**;
   - or by building it: `node scripts/build-zotero-plugin.ts <dir>`, which
     writes `<dir>/zotero/latex-emulator-zotero.xpi`.
2. In Zotero 10: Tools → Plugins → ⚙ → **Install Plugin From File…**
3. Zotero keeps the plugin up to date from the site's
   `zotero/updates.json`.

## Use it from the app

References → Zotero plugin → **Connect**.

- Zotero asks whether to allow it, and shows a four-digit code. Check that
  the app shows the same one.
- The connection lasts for the session unless you tick **Remember this
  connection on this device**. Then the token is stored encrypted in the
  browser.
- The browser may ask whether the site may reach devices on your computer.
  Allow it: the plugin listens on 127.0.0.1 only.

## Use it from Claude Code (or another MCP client)

1. In Zotero: Settings → LaTeX Emulator → **Add an MCP client…**
2. Name the client.
3. Paste the command it shows. It looks like:

   ```bash
   claude mcp add --transport http zotero http://127.0.0.1:23119/latex-emulator/mcp --header "Authorization: Bearer <token>"
   ```

Tick **Also let it create and change zettels** first to let the agent
write zettels; otherwise its token can only read.

The endpoint speaks MCP's streamable HTTP with JSON responses only: no
SSE, no sessions. `GET` answers 405, as the spec allows.

## The Zettelkasten

A zettel is a standalone note in one collection ("Zettelkasten" unless
you rename it in the settings). Its first line is a Luhmann ID and a
declarative title, such as `1a2 Energy sets the limits of growth`, so
Zotero's own note list shows the same thing an agent sees. Links between
zettels, and from a zettel to the sources it draws on, are Zotero's
**Related** relation, which works both ways.

| Tool                            | Scope         | Does                                                                                                           |
| ------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------- |
| `zettel_list`                   | `read`        | every zettel in Luhmann order (`1`, `1a`, `1a2`, `1a10`, `1b`, `2`), or one branch by prefix                   |
| `zettel_get`                    | `read`        | one zettel: body, linked zettels, sources, parent, children, previous and next                                 |
| `zettel_search`                 | `read`        | zettels whose title or body contains every word                                                                |
| `zettel_create`                 | `write-notes` | a new zettel: `after` an ID (its next sibling, or a branch if that's taken), `under` an ID, or a new top level |
| `zettel_update`                 | `write-notes` | a new title (the body is kept as it is) or a new body                                                          |
| `zettel_link` / `zettel_unlink` | `write-notes` | a Related link to another zettel (`zettel`) or a source (`item`)                                               |
| `zettel_tag`                    | `write-notes` | add or remove tags                                                                                             |

New zettels are tagged `zk/inbox`. Removing that tag, in Zotero or with
`zettel_tag`, accepts one into the Zettelkasten. Nothing is ever deleted.

## Settings (Zotero → Settings → LaTeX Emulator)

- **Connected:** every paired client, with its site (or "a program on this
  computer"), its permissions and its date. **Remove** revokes its token at
  once.
- **Zettelkasten:** the collection zettels live in.
- **Websites allowed to connect:** the app's own site always, plus any you
  list. For local development, add `http://localhost:5173`.

## Security

- **Network:**
  - It is reachable only on 127.0.0.1, through Zotero's own server, so no
    other port is opened.
  - Requests naming another `Host` are refused, by Zotero and by the
    plugin.
  - Web pages from sites not on the list are refused, without CORS
    headers.
- **Tokens:**
  - Every call needs a token.
  - A token works only from the site it was paired from.
  - Pairing always asks you in Zotero, with Deny as the default.
- **Writes:** only with the `write-notes` scope, which a client gets only
  if you allow it (the pairing dialog or the checkbox says so). They go
  through Zotero's own API, never the database file. They only create and
  change zettel notes, their tags and their Related links; new zettels are
  tagged `zk/inbox`, and nothing is deleted.
- **Storage:** tokens are kept in Zotero's preferences in your Zotero
  profile.

## Code and tests

| Where                         | What                                                           | Tested by                                        |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `src/protocol.ts`             | constants and types shared with the app                        | unit                                             |
| `src/server.ts`               | HTTP → JSON-RPC: Host, Origin, tokens, pairing, MCP            | unit (`server.test.ts`)                          |
| `src/tools.ts`, `validate.ts` | the tools and their argument schemas                           | unit, against `fake-port.ts`                     |
| `src/zettel-tools.ts`         | the Zettelkasten tools                                         | unit, and `npm run test:zotero`                  |
| `src/luhmann.ts`              | Luhmann IDs: parse, order, siblings, children                  | unit                                             |
| `src/zettel-note.ts`          | a zettel's note HTML: ID, title, body                          | unit                                             |
| `src/config.ts`               | settings read back, tokens, the dialog text                    | unit                                             |
| `src/zotero/`                 | inside Zotero: the endpoint, `ZoteroPort`, the dialog and pane | `npm run test:zotero` (real Zotero), and by hand |

To run the real-Zotero test, quit your own Zotero first: the test needs
port 23119. It uses a throwaway profile and data directory, so your
library is never touched. It needs Xvfb on Linux.

```bash
ZOTERO_DIR=/path/to/Zotero_linux-x86_64 npm run test:zotero
```

CI runs it in the `zotero` job against a pinned Zotero, currently 10.0.8.
Move the pin and `plugin.json`'s version range together.

### By hand, before a release

Headless Zotero can't click dialogs, so check these yourself:

1. Install the `.xpi` in Zotero.
2. In the app, Connect: the dialog shows the site, the permissions and the
   same code.
   - Deny: the app says it was declined.
   - Allow: the app says "Connected to Zotero …".
3. Settings → LaTeX Emulator lists the app. Remove it, and the app's next
   check says the connection was removed.
4. Add an MCP client, run the command it shows, and in Claude Code ask it
   to search Zotero.
5. Add another with **Also let it create and change zettels** ticked; the
   list shows `read, write-notes`. Ask it to make a zettel: it appears in
   the Zettelkasten collection, tagged `zk/inbox`.
6. Rename the Zettelkasten collection in the settings and Save; the next
   zettel goes to (or makes) the new collection.
