/**
 * Our Monaco build: the editor API plus only the editor features we use. Not
 * `editor.main`, which bundles every language and the TS/JSON/CSS/HTML
 * services (AGENTS.md §12). This is the only module that loads Monaco at
 * runtime; <latex-editor> imports it lazily.
 */
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

import 'monaco-editor/editor/browser/coreCommands.js';
import 'monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/codeAction/browser/codeActionContributions.js';
import 'monaco-editor/editor/contrib/comment/browser/comment.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js';
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError.js';
import 'monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/indentation/browser/indentation.js';
import 'monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js';
import 'monaco-editor/editor/contrib/links/browser/links.js';
import 'monaco-editor/editor/contrib/multicursor/browser/multicursor.js';
import 'monaco-editor/editor/contrib/smartSelect/browser/smartSelect.js';
import 'monaco-editor/editor/contrib/snippet/browser/snippetController2.js';
import 'monaco-editor/editor/contrib/suggest/browser/suggestController.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js';
import 'monaco-editor/editor/common/standaloneStrings.js';

import type { Diagnostic } from '../latex/diagnostics.ts';
import {
  LATEX_LANGUAGE_ID,
  latexLanguageConfiguration,
  latexMonarch,
} from './latex-language.ts';
import { fixesAt, toMarkers } from './markers.ts';
import { createPositionMap } from './positions.ts';
import { citeContextAt } from './cite-context.ts';
import type { CitationServices } from './cite-services.ts';
import { matchEntries } from '../references/cite-index.ts';
import type { ZoteroSuggestion } from '../references/zotero-suggest.ts';

const MARKER_OWNER = 'latex';

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

monaco.languages.register({ id: LATEX_LANGUAGE_ID, extensions: ['.tex'] });
monaco.languages.setMonarchTokensProvider(LATEX_LANGUAGE_ID, latexMonarch);
monaco.languages.setLanguageConfiguration(
  LATEX_LANGUAGE_ID,
  latexLanguageConfiguration
);

/** The app's citation services and the diagnostics on screen (one editor). */
let services: CitationServices | null = null;
let shown: { source: string; diagnostics: Diagnostic[] } = {
  source: '',
  diagnostics: [],
};

const ADD_CITATION = 'latex.addCitationFromZotero';
monaco.editor.registerCommand(
  ADD_CITATION,
  (_accessor, s: ZoteroSuggestion) => {
    void services?.add(s);
  }
);

/** Markdown text with its special characters escaped. */
const md = (s: string) => s.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, '\\$&');

/** Citation keys: typeahead from the library, then (optionally) Zotero. */
monaco.languages.registerCompletionItemProvider(LATEX_LANGUAGE_ID, {
  triggerCharacters: ['{', ','],
  async provideCompletionItems(model, position) {
    const text = model.getValue();
    const map = createPositionMap(text);
    const ctx = services && citeContextAt(text, map.toOffset(position));
    if (!services || !ctx) return { suggestions: [] };
    const a = map.toPosition(ctx.replace.start);
    const b = map.toPosition(ctx.replace.end);
    const range = new monaco.Range(
      a.lineNumber,
      a.column,
      b.lineNumber,
      b.column
    );
    const item = (
      key: string,
      authors: string,
      year: string,
      title: string,
      where: string,
      sort: string
    ): monaco.languages.CompletionItem => ({
      label: { label: key, description: `${authors} ${year}`.trim() },
      kind: monaco.languages.CompletionItemKind.Reference,
      detail: title,
      documentation: where,
      insertText: key,
      // Typing an author, a title word or a year matches too.
      filterText: `${ctx.prefix} ${key} ${authors} ${year} ${title}`,
      sortText: sort,
      range,
    });
    const local = matchEntries(services.entries(), ctx.prefix).map((e, i) =>
      item(
        e.key,
        e.authors,
        e.year,
        e.title,
        `${e.file}.bib`,
        `a${String(i).padStart(4, '0')}`
      )
    );
    const known = new Set(local.map((s) => s.insertText));
    const zotero = (await services.zotero(ctx.prefix))
      .filter((s) => !known.has(s.key))
      .map((s, i) => ({
        ...item(
          s.key,
          s.authors,
          s.year,
          s.title,
          'Zotero: added to the library when chosen',
          `z${String(i).padStart(4, '0')}`
        ),
        label: {
          label: s.key,
          description: `Zotero · ${`${s.authors} ${s.year}`.trim()}`,
        },
        command: { id: ADD_CITATION, title: 'Add from Zotero', arguments: [s] },
      }));
    // Ask again on every keystroke: our ranking (key, then author, title,
    // year), not Monaco's fuzzy re-filtering of an earlier, wider list.
    return {
      suggestions: [...local, ...zotero],
      incomplete: true,
    };
  },
});

/** Hovering a citation key shows its reference. */
monaco.languages.registerHoverProvider(LATEX_LANGUAGE_ID, {
  provideHover(model, position) {
    const text = model.getValue();
    const map = createPositionMap(text);
    const ctx = services && citeContextAt(text, map.toOffset(position));
    if (!services || !ctx) return null;
    const key = text.slice(ctx.replace.start, ctx.replace.end);
    const e = services
      .entries()
      .find((x) => x.key.toLowerCase() === key.toLowerCase());
    if (!e) return null;
    const a = map.toPosition(ctx.replace.start);
    const b = map.toPosition(ctx.replace.end);
    return {
      range: new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column),
      contents: [
        {
          value: `${md(e.authors)} (${md(e.year)}). ${md(e.title)}. *${md(`${e.file}.bib`)}*`,
        },
      ],
    };
  },
});

/** Quick fixes carried by diagnostics (e.g. add a \\bibliography). */
monaco.languages.registerCodeActionProvider(LATEX_LANGUAGE_ID, {
  provideCodeActions(model, range) {
    const text = model.getValue();
    if (text !== shown.source) return { actions: [], dispose() {} };
    const map = createPositionMap(text);
    const fixes = fixesAt(
      shown.diagnostics,
      text,
      map.toOffset({
        lineNumber: range.startLineNumber,
        column: range.startColumn,
      }),
      map.toOffset({ lineNumber: range.endLineNumber, column: range.endColumn })
    );
    return {
      actions: fixes.map((f) => ({
        title: f.title,
        kind: 'quickfix',
        isPreferred: true,
        edit: {
          edits: f.edits.map((e) => ({
            resource: model.uri,
            textEdit: { range: e.range, text: e.text },
            versionId: model.getVersionId(),
          })),
        },
      })),
      dispose() {},
    };
  },
});

export interface LatexEditor {
  getValue(): string;
  setValue(value: string): void;
  setDiagnostics(source: string, diagnostics: Diagnostic[]): void;
  focus(): void;
}

export function createLatexEditor(
  host: HTMLElement,
  value: string,
  onChange: (value: string) => void,
  citations?: CitationServices
): LatexEditor {
  services = citations ?? null;
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const editor = monaco.editor.create(host, {
    value,
    language: LATEX_LANGUAGE_ID,
    ariaLabel: 'LaTeX source',
    theme: dark ? 'vs-dark' : 'vs',
    automaticLayout: true,
    minimap: { enabled: false },
    wordWrap: 'on',
    wrappingIndent: 'same',
    fontSize: 14,
    lineNumbersMinChars: 3,
    scrollBeyondLastLine: false,
    tabSize: 2,
    renderLineHighlight: 'line',
    unicodeHighlight: { ambiguousCharacters: false },
    fixedOverflowWidgets: true,
  });
  const model = editor.getModel()!;
  model.setEOL(monaco.editor.EndOfLineSequence.LF);
  editor.onDidChangeModelContent(() => onChange(model.getValue()));

  return {
    getValue: () => model.getValue(),
    setValue: (v) => model.setValue(v),
    focus: () => editor.focus(),
    setDiagnostics(source, diagnostics) {
      // Stale results (computed for older text) are dropped.
      if (source !== model.getValue()) return;
      shown = { source, diagnostics };
      monaco.editor.setModelMarkers(
        model,
        MARKER_OWNER,
        toMarkers(diagnostics, source)
      );
    },
  };
}
