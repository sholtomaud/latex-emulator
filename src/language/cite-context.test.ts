import { describe, test } from 'node:test';
import assert from 'node:assert';
import { citeContextAt } from './cite-context.ts';

/** `|` marks the cursor. */
function at(marked: string) {
  const offset = marked.indexOf('|');
  const text = marked.replace('|', '');
  return { text, offset, ctx: citeContextAt(text, offset) };
}

describe('citeContextAt', () => {
  test('inside the key list of any cite command', () => {
    for (const s of [
      'See \\citep{odu|',
      'See \\citet{odu|}',
      'See \\citep[see][p.~5]{odu|} more',
      '\\Citet*{odu|}',
      '\\nocite{odu|}',
      '\\citeauthor{a, odu|}',
    ]) {
      const { ctx } = at(s);
      assert.ok(ctx, s);
      assert.strictEqual(ctx.prefix, 'odu', s);
    }
  });

  test('the range to replace is the whole key under the cursor', () => {
    const { text, ctx } = at('\\citep{a, odu|m_energy_1996, b}');
    assert.ok(ctx);
    assert.strictEqual(
      text.slice(ctx.replace.start, ctx.replace.end),
      'odum_energy_1996'
    );
    assert.deepStrictEqual(ctx.keys, ['a', 'odum_energy_1996', 'b']);
  });

  test('an empty key right after { or a comma', () => {
    assert.strictEqual(at('\\citep{|}').ctx?.prefix, '');
    const { text, ctx } = at('\\citep{a,|}');
    assert.strictEqual(ctx?.prefix, '');
    assert.strictEqual(text.slice(ctx!.replace.start, ctx!.replace.end), '');
  });

  test('not in notes, other commands, or outside the braces', () => {
    for (const s of [
      '\\citep[odu|]{x}',
      '\\ref{odu|}',
      '\\citep{x} odu|',
      '\\citep|{x}',
      'plain odu|',
    ])
      assert.strictEqual(at(s).ctx, null, s);
  });
});
