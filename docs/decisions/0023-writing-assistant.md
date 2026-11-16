# 0023: The writing assistant

Status: proposed (design only). It changes AGENTS §9 when built.

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
- **Keys:** held for the session or, on opt-in, kept; both are encrypted in
  local storage (backlog).
- **CSP** (an AGENTS §9 relaxation, recorded here when built):
  - `connect-src` gains `http://localhost:*` and `http://127.0.0.1:*` for
    local servers;
  - each configured HTTPS endpoint is added, or all HTTPS once custom
    endpoints are allowed.

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
