import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  LATEX_LANGUAGE_ID,
  latexLanguageConfiguration,
  latexMonarch,
} from './latex-language.ts';

describe('LaTeX Monarch grammar', () => {
  test('has an id and a root state', () => {
    assert.strictEqual(LATEX_LANGUAGE_ID, 'latex');
    assert.ok(Array.isArray(latexMonarch.tokenizer.root));
  });

  test('every rule regex compiles', () => {
    for (const [state, rules] of Object.entries(latexMonarch.tokenizer)) {
      for (const rule of rules as unknown[]) {
        const re = Array.isArray(rule)
          ? rule[0]
          : (rule as { regex?: unknown }).regex;
        if (re === undefined) continue; // { include: ... }
        assert.doesNotThrow(
          () => new RegExp(re as RegExp | string),
          `bad regex in ${state}`
        );
      }
    }
  });

  /** A first-match reimplementation of Monarch's root state, enough to check token classes. */
  function firstToken(text: string): string {
    for (const rule of latexMonarch.tokenizer.root as unknown[]) {
      if (!Array.isArray(rule)) continue;
      const re = new RegExp(`^(?:${(rule[0] as RegExp).source})`);
      if (re.test(text)) {
        const action = rule[1];
        return typeof action === 'string' ? action : JSON.stringify(action);
      }
    }
    return 'none';
  }

  test('classifies the main token kinds', () => {
    assert.strictEqual(firstToken('% note'), 'comment');
    assert.match(firstToken('\\section{X}'), /keyword/);
    assert.match(firstToken('\\begin{itemize}'), /keyword/);
    assert.strictEqual(firstToken('\\emph{x}'), 'tag');
    assert.strictEqual(firstToken('\\%'), 'string.escape');
    assert.match(firstToken('$x$'), /math/);
  });

  test('language configuration pairs braces and knows % comments', () => {
    assert.deepStrictEqual(latexLanguageConfiguration.comments, {
      lineComment: '%',
    });
    assert.ok(
      latexLanguageConfiguration.brackets!.some(
        ([a, b]) => a === '{' && b === '}'
      )
    );
  });
});
