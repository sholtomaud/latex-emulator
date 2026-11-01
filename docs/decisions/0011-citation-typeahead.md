# 0011: Citation typeahead, hovers and quick fixes

## Context

Users type `\citep{…}` and got a bare `?` when the key was not resolved.
The usual reason was that the document's `\bibliography{…}` did not list
the `.bib` file holding the key, or there was no `\bibliography`. That is
correct LaTeX behaviour, but nothing helped them find or fix it. They also
asked for typeahead from the library and from Zotero.

## Decision

- **Typeahead inside any cite command's key list.**
  - It covers natbib commands, classic `\cite` and `\nocite`.
  - It works past `[pre][post]` notes, after commas, and in starred and
    capitalised forms.
  - The cursor context comes from the parser's AST
    (`src/language/cite-context.ts`), not a regex.
  - Suggestions come from an index of the library (`src/references/cite-index.ts`).
    Matches rank by key prefix, then by key, author, title or year words.
  - The provider marks its list incomplete so Monaco asks again on each
    keystroke and keeps our ranking. Its own fuzzy re-filtering otherwise let
    unrelated entries through.
- **Zotero in the typeahead is opt-in.** The setting is "Suggest from Zotero
  while typing citations" in the Zotero panel.
  - When it is on, prefixes of 3+ characters are searched in the chosen
    Zotero (local or web), and results are cached per prefix.
  - Choosing a Zotero item inserts its new `author_topic_year` key and adds
    the entry to the first library file the document's `\bibliography` lists
    (else `references.bib`).
  - Off by default, so typing never makes network requests unless the user
    asked for that.
- **Hovers** on a key show "Authors (Year). Title. *file.bib*".
- **Quick fixes.** A diagnostic may carry `fixes` (text edits, as in
  AGENTS.md §8); `src/language/markers.ts` maps them to Monaco code actions
  (Ctrl/⌘ + .).
  - A key in a file `\bibliography` doesn't list: add the file to the list.
  - No `\bibliography`: insert `\bibliographystyle{plainnat}` and
    `\bibliography{file}` before `\end{document}`.

  Both keep the document standard LaTeX; the user applies them.

## Consequences

- The cite command list now lives once, in the registry (`CITE_COMMANDS`).
- With Zotero typeahead on, each new 3+ character prefix sends that text to
  Zotero (AGENTS.md §9 lists it).
- Completion parses the document per keystroke inside a citation, which is
  fast for typical documents. It moves to the language worker with the rest
  of the language features (step 13).
