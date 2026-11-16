# LaTeX Emulator for Zotero

A Zotero plugin that serves your library over [MCP](https://modelcontextprotocol.io)
to the LaTeX Emulator and to AI agents such as Claude Code. The design is in
[ADR 0024](../docs/decisions/0024-zotero-plugin-and-zettelkasten.md).

- **Phase 1 (this):** pairing, and two read tools: `search_items` and
  `get_item`.
- **Later:** Zettelkasten tools, the app's Zotero search through the
  plugin, and preprint versions.

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

The endpoint speaks MCP's streamable HTTP with JSON responses only: no
SSE, no sessions. `GET` answers 405, as the spec allows.

## Settings (Zotero → Settings → LaTeX Emulator)

- **Connected:** every paired client, with its site (or "a program on this
  computer"), its permissions and its date. **Remove** revokes its token at
  once.
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
- **Writes:** none in phase 1. When writing tools arrive, they go through
  Zotero's own API (never the database file), notes made by agents are
  tagged `zk/inbox`, and nothing is deleted outright.
- **Storage:** tokens are kept in Zotero's preferences in your Zotero
  profile.

## Code and tests

| Where                         | What                                                           | Tested by                                        |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `src/protocol.ts`             | constants and types shared with the app                        | unit                                             |
| `src/server.ts`               | HTTP → JSON-RPC: Host, Origin, tokens, pairing, MCP            | unit (`server.test.ts`)                          |
| `src/tools.ts`, `validate.ts` | the tools and their argument schemas                           | unit, against `fake-port.ts`                     |
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
