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
import { createPositionMap, selectedLines } from './positions.ts';
import { plainMarkdown } from './plain-markdown.ts';
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

/** Selected lines (see assistant/context.ts Excerpt). */
export interface SelectedText {
  text: string;
  startLine: number;
  endLine: number;
}

export interface EditorHooks {
  /** The selection changed (null: nothing selected). */
  onSelection?: (selection: SelectedText | null) => void;
  /** "Ask the Assistant about the Selection" (Ctrl/⌘+Shift+A). */
  onAskAboutSelection?: (selection: SelectedText) => void;
  /**
   * The text changed: the edits in the old text's offsets, or `replaced`
   * when it was set wholesale (another document opened).
   */
  onEdits?: (
    edits: { offset: number; removed: number; inserted: number }[],
    replaced: boolean
  ) => void;
  /** "Add Comment" (Ctrl/⌘+Alt+M) on the selection, in offsets. */
  onAddComment?: (range: { start: number; end: number }) => void;
  /** The caret moved to this offset. */
  onCaret?: (offset: number) => void;
}

/** A comment thread to underline (ADR 0025). */
export interface CommentMark {
  start: number;
  end: number;
  /** Shown on hover, as plain text. */
  hover: string;
  focused: boolean;
}

export interface LatexEditor {
  getValue(): string;
  setValue(value: string): void;
  setDiagnostics(source: string, diagnostics: Diagnostic[]): void;
  focus(): void;
  setReadOnly(readOnly: boolean): void;
  /** Insert at the cursor, replacing the selection; one undo step. */
  insert(text: string): void;
  /** Underline these comment threads. */
  setComments(marks: CommentMark[]): void;
  /** Select a range and scroll it into view. */
  reveal(range: { start: number; end: number }): void;
}

export function createLatexEditor(
  host: HTMLElement,
  value: string,
  onChange: (value: string) => void,
  citations?: CitationServices,
  hooks: EditorHooks = {}
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
  editor.onDidChangeModelContent((e) => {
    hooks.onEdits?.(
      e.changes.map((c) => ({
        offset: c.rangeOffset,
        removed: c.rangeLength,
        inserted: c.text.length,
      })),
      e.isFlush
    );
    onChange(model.getValue());
  });
  editor.onDidChangeCursorPosition((e) =>
    hooks.onCaret?.(model.getOffsetAt(e.position))
  );
  editor.addAction({
    id: 'latex.addComment',
    label: 'Add Comment',
    keybindings: [
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyM,
    ],
    precondition: 'editorHasSelection',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1,
    run: () => {
      const sel = editor.getSelection();
      if (!sel || sel.isEmpty()) return;
      hooks.onAddComment?.({
        start: model.getOffsetAt(sel.getStartPosition()),
        end: model.getOffsetAt(sel.getEndPosition()),
      });
    },
  });
  const commentDecorations = editor.createDecorationsCollection();

  const selected = (): SelectedText | null => {
    const sel = editor.getSelection();
    if (!sel || sel.isEmpty()) return null;
    return {
      text: model.getValueInRange(sel),
      ...selectedLines(sel.startLineNumber, sel.endLineNumber, sel.endColumn),
    };
  };
  editor.onDidChangeCursorSelection(() => hooks.onSelection?.(selected()));
  editor.addAction({
    id: 'latex.askAssistantAboutSelection',
    label: 'Ask the Assistant about the Selection',
    keybindings: [
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyA,
    ],
    precondition: 'editorHasSelection',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 0,
    run: () => {
      const sel = selected();
      if (sel) hooks.onAskAboutSelection?.(sel);
    },
  });

  return {
    getValue: () => model.getValue(),
    setValue: (v) => model.setValue(v),
    focus: () => editor.focus(),
    setReadOnly: (readOnly) => editor.updateOptions({ readOnly }),
    setComments(marks) {
      const range = (start: number, end: number) => {
        const a = model.getPositionAt(start);
        const b = model.getPositionAt(end);
        return new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column);
      };
      commentDecorations.set(
        marks.map((m) => ({
          range: range(m.start, m.end),
          options: {
            inlineClassName: m.focused
              ? 'latex-comment latex-comment-focused'
              : 'latex-comment',
            linesDecorationsClassName: 'latex-comment-gutter',
            hoverMessage: { value: plainMarkdown(m.hover) },
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        }))
      );
    },
    reveal({ start, end }) {
      const a = model.getPositionAt(start);
      const b = model.getPositionAt(end);
      const r = new monaco.Range(
        a.lineNumber,
        a.column,
        b.lineNumber,
        b.column
      );
      editor.setSelection(r);
      editor.revealRangeInCenterIfOutsideViewport(r);
      editor.focus();
    },
    insert(text) {
      if (editor.getOption(monaco.editor.EditorOption.readOnly)) return;
      const range = editor.getSelection() ?? model.getFullModelRange();
      editor.pushUndoStop();
      editor.executeEdits('assistant', [
        { range, text, forceMoveMarkers: true },
      ]);
      editor.pushUndoStop();
      editor.focus();
    },
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
