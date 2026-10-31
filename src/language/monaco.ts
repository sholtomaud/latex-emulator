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
import { toMarkers } from './markers.ts';

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

export interface LatexEditor {
  getValue(): string;
  setValue(value: string): void;
  setDiagnostics(source: string, diagnostics: Diagnostic[]): void;
  focus(): void;
}

export function createLatexEditor(
  host: HTMLElement,
  value: string,
  onChange: (value: string) => void
): LatexEditor {
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
      monaco.editor.setModelMarkers(
        model,
        MARKER_OWNER,
        toMarkers(diagnostics, source)
      );
    },
  };
}
