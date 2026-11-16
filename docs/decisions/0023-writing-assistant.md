# 0023: The writing assistant

Status: step 1 built (November 2026): the chat pane, Assistant setup and
four providers (§6 below). The checks, profiles, audits, Z3 and
auto-zettel are still proposed.

## Context

The maintainer wants an assistant beside the editor that checks the writing
as it happens, against standards such as an academic supervisor's
style guide (`Supervisor++`: attribution, the Known-New contract, no "LLM
voice"), and that can also:

- audit flow and structure (CARS, IMRaD, SDS, TEAL paragraphs);
- check the logic of arguments with a solver;
- turn the author's ideas into Zettelkasten notes in Zotero.

Several assistants with different prompts should be possible. They could
run on several local llama.cpp servers (small models for small tasks)
or on cloud models.

The hard part is checking while writing without sending every keystroke
to a model.

## Decision

### 1. Three tiers of checking, cheapest first

**a. Local rules, instant, on every keystroke, no model.** Much of a style
guide is mechanical. It runs as lint rules (AGENTS §8, one file per rule) in
the language worker, offline and deterministic, with codes `style/…`. A
**style profile** turns rules on and sets thresholds. From `Supervisor++`:

- banned constructions: "not merely", "not only … but also", "is not X,
  but Y" contrasts, "It is important to note", "This demonstrates that";
- fillers and intensifiers: simply, just, really, quite, very. "Critical"
  above N per 1,000 words is flagged;
- the "definition colon" (a colon introducing a definition mid-sentence),
  as a heuristic;
- quotation protocol, read from the AST:
  - text in ` ` '' `` with no page-numbered citation (`\citep[p.~5]{…}`)
    nearby;
  - scare quotes (double quotes with no citation at all);
- rhythm:
  - more than one "however" or "furthermore" in a paragraph;
  - three sentences in a row with the same opening structure;
  - em-dash density;
  - spread of sentence lengths;
- spelling (AGENTS §8), in the profile's variety (e.g. Australian
  English).

These need no network, cost nothing, and can ship before any model is
connected.

**b. Paragraph checks by a model, when the writer pauses.**

- **Unit:** the paragraph. It is small enough for a small local model and
  large enough for grammar and Known-New flow.
- **When:**
  - the caret leaves a paragraph that changed;
  - or the paragraph has been still for 2 s and ends a sentence (`.`, `?`
    or `!`).

  Typing never triggers a request.

- **What is sent:**
  - the paragraph (a typical one is 80–250 words; one over 400 is split at
    sentence ends);
  - the paragraphs before and after it, as read-only context for Known-New
    links;
  - the section heading;
  - the profile's prompt.

  That is roughly 0.5–1.5k tokens besides the prompt.

- **Never sent twice:** results are cached by the SHA-256 of (paragraph,
  neighbours, profile, model). An unchanged paragraph is never re-sent, and
  an undo brings back the cached result.
- **Queue:**
  - one request in flight per server;
  - a request for a paragraph that has since changed is cancelled;
  - a server that is down pauses the tier and says so.
- **Structured output:** findings as JSON with this schema:

  ```json
  {
    "findings": [
      {
        "quote": "exact words from the paragraph",
        "rule": "known-new",
        "severity": "warning",
        "message": "…",
        "suggestion": "…"
      }
    ]
  }
  ```

  llama.cpp enforces it (`json_schema`, its grammar-constrained output);
  cloud models get it as a tool or response format.
  - **Mapping to ranges:** each finding's `quote` is located in the
    paragraph's text. A finding whose quote isn't there is dropped, so an
    invented location never becomes a marker.
  - **Display:** findings become Monaco markers (source `assistant`) with
    the message on hover, and are listed in the panel.

**c. Audits on demand.** A button per audit, for a section or the whole
document. They are never automatic.

- flow across paragraphs;
- structure (CARS moves in an introduction, IMRaD, SDS, TEAL/TEAL-C
  paragraphs);
- attribution, "Says who?": every claim about the literature has a cited
  subject;
- grounded narrative: research claims the author hasn't stated;
- the logic check (§4).

Results are comments anchored to ranges, in the panel.

**Readiness ("traffic lights").** Each category (spelling, style, grammar,
flow, attribution, logic) shows green, amber or red from its findings per
1,000 words, with the profile's thresholds. Amber or red opens that
category's list.

### 2. Profiles (assistants)

A profile holds:

- a name;
- a system prompt (the user's own, such as `Supervisor++`, or a shipped
  one);
- its local style rules;
- the tasks it does (paragraph check, audits, chat);
- for each task: an endpoint, model, parameters and output schema.

**Routing.** A task goes to its profile's endpoint. For example:

- a 3–4B model on `localhost:8081` for paragraph checks;
- a larger local model on `:8080` for audits;
- a cloud model for chat, chosen per profile.

Several llama.cpp servers can run on different ports.

**Shipped profiles:**

- Proofreader: grammar, spelling, punctuation;
- Academic editor: a starter; the user pastes their own guide;
- Logician (§4).

**Provider shapes.** Two cover every provider named so far: Anthropic
Messages, and OpenAI-compatible chat (llama.cpp, OpenRouter, DeepSeek,
Qwen, Gemini's compatible endpoint).

**Prompt caching.** The profile prompt always comes first and never
changes, so llama.cpp's prompt cache (`cache_prompt`, slot reuse) and
Anthropic's prompt caching reuse it. A guide like `Supervisor++` is about
5k tokens, and caching keeps paragraph checks fast and cheap.

- **Context budget:** each model's context size comes from llama.cpp's
  `/props`. A small-context model gets a shorter context window (no
  neighbours), never a truncated prompt.

### 3. Placement and privacy

- **Placement:** the secondary side bar on the right (ADR 0022), with chat,
  findings, audits and the traffic lights. A pop-out window may come later:
  a same-origin `window.open` kept in sync over `BroadcastChannel`.
- **Opt-in per document:** "the assistant may read this document", with
  the provider named. Local servers are the default.
- **Keys:** held for the session, or kept in the browser's password
  manager on request (§6). Never in page storage.
- **CSP:** see §6.

### 4. The logic check (Z3)

- **The solver:**
  - `z3-solver` (MIT, Microsoft Research) is WASM with a TypeScript API;
  - it is a second runtime dependency, which needs AGENTS §2's
    justification;
  - it is loaded only when the check is run, in a worker;
  - preferably a single-threaded build: its threaded build needs COOP/COEP
    headers, which GitHub Pages can't send.
- **No new LaTeX syntax** (AGENTS §14's rule). `\begin{argument}`,
  `\premise` and similar would stop the document compiling in pdflatex,
  because we don't ship `.sty` files.
  - The formalisation lives beside the document, in the app's storage and
    as `<name>.logic.json` in the project folder.
  - It is linked to sentence ranges.
- **Flow:**
  1. The Logician profile proposes the formalisation: premises and
     conclusion as structured JSON (SMT-LIB terms), each anchored to a
     quote.
  2. The author reviews and corrects it in the panel. **No result is shown
     before the formalisation is accepted.**
  3. Z3 checks it:
     - consistency (are the premises satisfiable);
     - validity (premises with the negated conclusion are unsat);
     - unused premises (the unsat core, with named assertions);
     - a counterexample (the model, when the argument is invalid);
     - a timeout, as "unknown".
  4. The results become markers and comments on the anchored sentences.
     Each says it concerns the accepted formalisation.
- **Modal arguments:** the standard (Kripke) translation, with frame axioms
  for K, T, S4 and S5 chosen in the panel. "Valid in S5 but not in K" is
  then reportable.

### 5. Auto-zettel

The assistant notices the author's own claims, not those of the sources.
It **suggests** zettel candidates in the panel:

- a Luhmann ID next to related notes;
- a declarative title;
- the body;
- links to the items cited in that paragraph.

Accepting one creates the note through the Zotero plugin (backlog), with
links back to the document and version.

- An opt-in automatic mode creates drafts only, tagged `zk/draft` and
  `zk/llm`, never permanent notes. A slip-box keeps its value only if what
  is in it is the author's own.
- The assistant searches zettels first (titles, then links), before
  annotations and full text.

### 6. Step 1 as built: the chat

- **The pane** (`assistant-panel`, ADR 0022's secondary side bar).
  - **Pinned** (the default) it is a column of the layout at any width
    above 768px: the editor and preview share what is left, like the side
    bar on the left. **Unpinned** it floats over the preview and closes
    when focus goes back to the editor. Phones keep the drawer.
  - Its left edge is a window splitter (`role="separator"`): drag it, or
    use ← → (16px), Home and End. Widths run from 280px to the smaller of
    720px and 60% of the window. Pinning and width are remembered
    (`assistant-pane`). Pure logic: `src/assistant/pane.ts`.
  - Ctrl/⌘+Alt+B toggles it, as before; the activity bar's foot button
    too.
  - Replies are text. Fenced code blocks are shown as code with a Copy
    button (`fences.ts`); nothing from a model is parsed as HTML or
    Markdown (AGENTS §9).
  - Stop keeps what arrived. A failed send shows the error and puts the
    question back in the composer.
- **Assistant setup**, a fifth activity bar view (`assistant-setup`): per
  provider its key, model (with Load models), a Test connection button,
  and for the local server its address. One radio chooses the chat's
  provider; the pane also has a provider menu and a Setup link.
- **Providers** (`providers.ts`, pure). Claude (Anthropic Messages API,
  default `claude-opus-5-5`, with server-side refusal fallbacks on the
  models that take them), OpenRouter (`openrouter/auto` by default),
  Gemini (its OpenAI-compatible endpoint; the model is picked from Load
  models), and a local OpenAI-compatible server (llama.cpp by default on
  `localhost:8080/v1`; Ollama and LM Studio work too) with
  `cache_prompt`. Replies stream (SSE, `sse.ts`).
- **fetch, not the Anthropic SDK.** AGENTS §2 allows no runtime
  dependency but Monaco, and one fetch path serves all four providers.
  Claude needs the `anthropic-dangerous-direct-browser-access` header for
  a call from a web page with the user's own key.
- **Keys** (`key-store.ts`). In memory for the session. "Remember" saves
  them in the browser's own password manager through the Credential
  Management API (`PasswordCredential`): encrypted by the operating
  system with the user's passwords, and synced the way they are. All
  remembered secrets of the app are one saved entry (JSON), because the
  API returns one credential per site, not per name; "Use saved keys"
  reads it, and the browser may ask first. A key is never written to
  localStorage, backups or project folders.
  - **Browsers without the API** (Firefox, Safari) first kept keys for
    the session only, because encrypting them in page storage was
    rejected: without a passphrase the decryption key sits beside them.
    In November 2026 the maintainer chose an encrypted fallback instead,
    as for the Zotero plugin's token (ADR 0024): there "Remember" keeps
    keys on this device, AES-GCM under a non-exportable key in a database
    of their own. That keeps them out of plain-text storage and backups,
    and page code can't read the key as bytes; someone with a copy of the
    browser profile still has both, and setup says where keys go.
  - Both live in one vault, `src/storage/vault.ts`; the assistant's keys
    are a section of it, so saving them never drops the plugin's token.
- **The document is sent only where allowed.** A per-document checkbox,
  "Let the assistant read this document", off by default; the pane says
  which provider receives it. When on, the source follows the fixed
  instructions in the system prompt (`context.ts`), so prompt caches keep
  the instructions.
- **Conversations** are per document, in a small IndexedDB database of
  their own (`latex-emulator-assistant`), like the folder links: the
  documents database keeps its version. They stay on this device: backups
  (ADR 0019) and project folders leave them out. A deleted document's
  conversation is deleted.
- **CSP** (AGENTS §9). `connect-src` gains `https://api.anthropic.com`,
  `https://openrouter.ai`, `https://generativelanguage.googleapis.com`
  and `http://localhost:*` / `http://127.0.0.1:*` (which replaces the
  Zotero port). A local server's address must be on this computer
  (`baseUrlProblem`). Another cloud host needs one CSP line and a
  provider entry; allowing all HTTPS was rejected (a wider exfiltration
  path if a script were ever injected).
- **Verified** with every provider mocked (`e2e/specs/assistant-chat.spec.ts`)
  and the pure modules unit-tested. Not yet verified against the live
  services from a browser: in particular whether Gemini's OpenAI-compatible
  endpoint and a given local server send the CORS headers a web page
  needs (llama-server does by default). Chrome may also ask the user to
  allow a public site to reach `localhost` (local network access); the
  error message points at the server and CORS.

## Consequences

- The cheapest useful part, the local style rules, needs no model and can
  ship early. It also makes the style guide's mechanical rules testable.
- Model checks cost one request per changed paragraph, at pauses. With
  caching and local models they cost no money; with cloud models,
  per-document opt-in and caching bound the cost.
- Findings from a model are suggestions. Only those whose quotes exist
  become markers, and none changes the text without the author.
- Z3 adds a large WASM file, loaded only when the check is run. The
  formalisation step is where errors can enter, which is why the author
  accepts it first.
- Order (`docs/backlog.md`):
  1. the activity bar (ADR 0022);
  2. the local style rules;
  3. the Zotero plugin;
  4. the assistant panel with paragraph checks;
  5. audits;
  6. the Z3 check;
  7. auto-zettel.
