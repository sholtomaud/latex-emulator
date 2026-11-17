# 0025: Comments, tools in the chat, and the reviewing agent

Status: accepted (November 2026). Built in three PRs: comments (built),
tools in the chat (built), the reviewing agent (built).

## Context

The assistant (ADR 0023) chats about the document but can't act: asked to
make zettels, a local model answered, correctly, that it had no tools. The
plugin's Zettelkasten tools (ADR 0024, plugin 0.3.0) exist, but only MCP
clients such as Claude Code could reach them.

The maintainer wants more than chat: an agent that reads the article on
its own, comments on it, answers the author's comments and closes its
own, and turns the author's claims around each citation into zettels.
That needs comments in the editor, which the app doesn't have.

## Decision

### 1. Comments

- **A thread** is anchored to a range of the source: the start and end
  offsets and the quoted text. It has messages (from "you" or the
  assistant), an opener, and a state: open or resolved.
- **Anchors follow edits.** Each edit in the editor shifts or shrinks the
  anchors after it (`shiftAnchor`, pure). Text changed outside the editor
  (another document opened, a restore) is re-anchored by finding the
  quote nearest its old place (`reanchor`). A thread whose text is gone
  is kept, shown as "text no longer found", never silently dropped.
- **In the editor**, an open thread is its own underline colour and a
  gutter mark, apart from the error, warning and spelling squiggles.
  Hovering shows the thread. Ctrl/⌘+Alt+M ("Add Comment", also in the
  context menu) comments on the selection.
- **The Comments view** (a sixth activity-bar view) lists the threads:
  the quote, the messages, a reply box, Resolve and Reopen, and a click
  that selects the text. Open threads first, in document order.
- **As built:** the controller (`src/comments/comments-controller.ts`)
  takes Monaco's edits in the old text's offsets and applies them from the
  last; saving waits for a 0.5 s pause in typing, and anything else
  (a new thread, a reply, resolving) saves at once. Clicking in a
  thread's text highlights it in the view; clicking a quote in the view
  selects its text. Hovers escape Markdown (`plain-markdown.ts`), so a
  comment never renders as a link or HTML. Backups carry a `comments`
  section; one from before comments restores as it did.
- **Storage:** with the document in IndexedDB, in a database of their own
  like the chats (ADR 0023), and **in workspace backups** (ADR 0019).
  Never in the `.tex`, so the document stays standard LaTeX (AGENTS.md
  §14 rule), and not in project folders.

### 2. Tools in the chat

- The chat offers the model tools, with each provider's tool calling:
  Anthropic `tools` and `tool_use` blocks; `tools`/`tool_calls` on the
  OpenAI-compatible endpoints (OpenRouter, Gemini, llama.cpp, which needs
  `--jinja` and a model that calls tools). Calls and results are shown in
  the conversation.
- Tools:
  - **document:** read the document (only where the author allowed it,
    ADR 0023 §3), read a paragraph;
  - **comments:** list, add, reply, resolve (see the rules below);
  - **Zotero**, through the plugin client: `search_items`, `get_item`
    and the zettel tools. The app pairs again asking for `read` and
    `write-notes`; Zotero's dialog says so.
- A model without tool calling still chats; the pane says the tools are
  off for it.

As built (`src/assistant/`): `reply.ts` assembles a streamed reply's text
and tool calls for either API (Claude's content blocks, thinking and
signatures included, are kept and sent back unchanged); the controller
loops — stream, run each call, send the results — for at most 10 rounds,
and Stop answers any call left open, so the history stays valid for the
next request. `assistant-tools.ts` holds the tools: `document_read`
(numbered lines), `comments_list`, `comment_add` (on an exact quote; an
ambiguous one needs `occurrence`), `comment_reply`, `comment_resolve`
(refused on the author's threads), and the plugin's `search_items`,
`get_item` and `zettel_*`, their schemas taken from the plugin's own
tool table. Without the author's permission the document and comment
tools answer that they may not read it. Tools are on per provider
(Assistant setup); the tool guide joins the fixed system prompt only
when they are. A connection made with a read-only token gets Zotero's
refusal turned into how to reconnect with write permission.

### 3. The reviewing agent

- **When:** a per-document "Review as I write" switch. When the writer
  pauses, each paragraph that changed since its last review is reviewed
  once. Unchanged paragraphs are never re-sent: results are keyed by the
  SHA-256 of the paragraph, its neighbours and the model (ADR 0023
  §1b). A "Review whole document" button reviews every paragraph not yet
  reviewed.
- **What it does** for a paragraph, with the tools above:
  - comments on what needs it (claims without support, unclear
    sentences), anchored to exact quotes; a quote not found in the
    paragraph is dropped, never placed elsewhere;
  - answers the author's open comments on that paragraph;
  - resolves its own threads once the text addresses them. **It may
    reply to the author's threads, and suggest resolving them, but only
    the author resolves those;**
  - makes zettels from the author's own claims around each citation,
    linked to the cited items (looked up by citation key), **created
    directly in Zotero, tagged `zk/inbox`**: the author accepts or
    deletes them in Zotero. It checks existing zettels first, so it
    doesn't repeat one.
- **Limits:** one paragraph in flight per provider; a paragraph that
  changes while being reviewed is cancelled and queued again; a failing
  provider pauses the reviewer and says so. Off by default, per document.

As built (`src/assistant/review/`, `review-service.ts`):

- **Paragraphs** are the body's blank-line separated blocks with at least
  40 letters of prose once comments, commands and the arguments of
  headings, labels, references and citations are removed; `lstlisting`,
  `verbatim` and `algorithmic` are skipped whole.
- **Keys:** a paragraph is keyed by the SHA-256 of its text alone, not its
  neighbours or the model, as first planned: with neighbours in the key,
  each edit sent the paragraphs on both sides again, and switching model
  sent everything. Neighbours still go with it as context. Keys (never
  text) live in their own IndexedDB database, `latex-emulator-reviews`,
  pruned to the document's current paragraphs, and stay out of backups:
  losing them only means paragraphs are reviewed again.
- **Queue:** a pause is 3 s without an edit. One paragraph in flight, in
  document order; typing pauses the queue. A paragraph whose text is gone
  is cancelled. A failure pauses the reviewer with the reason in the
  pane; "Review whole document" (which works with the switch off) resumes.
- **The switch** needs "Let the assistant read this document" (turning
  reading off turns reviewing off), and the chat's provider with a key
  and tools on.
- **The model** gets the chat's fixed instructions, the tool guide and the
  review rules (all fixed text), then the paragraph, its neighbours and
  its threads. `comment_add` is scoped to where the paragraph is now: a
  quote outside it is refused, so a comment can't land elsewhere. The
  reviewer's work shows in the comments, Zotero and the pane's status
  line, not in the chat.

## Consequences

- Comments are useful without any model; the agent builds on them.
- The reviewer's cost is bounded by changed paragraphs and caching; with a
  local model it costs nothing but time.
- Zettels arrive without a click each, but only in `zk/inbox`: nothing
  enters the Zettelkasten unless the author accepts it.
- Comments live in the browser and in backups, not in the project folder,
  so a collaborator opening the `.tex` elsewhere doesn't see them.
