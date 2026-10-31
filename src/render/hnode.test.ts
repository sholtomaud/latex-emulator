import { describe, test } from 'node:test';
import assert from 'node:assert';
import { h, serialize } from './hnode.ts';

describe('hnode', () => {
  test('h builds elements with attributes and children', () => {
    assert.deepStrictEqual(h('p', { class: 'x' }, ['a', h('em', {}, ['b'])]), {
      tag: 'p',
      attrs: { class: 'x' },
      children: ['a', { tag: 'em', attrs: {}, children: ['b'] }],
    });
  });

  test('serialize escapes text and attribute values', () => {
    assert.strictEqual(
      serialize(h('a', { title: '"<&>' }, ['<b>&'])),
      '<a title="&quot;&lt;&amp;&gt;">&lt;b&gt;&amp;</a>'
    );
  });

  test('serialize renders void elements without closing tags', () => {
    assert.strictEqual(
      serialize(h('p', {}, ['a', h('br'), 'b'])),
      '<p>a<br>b</p>'
    );
  });

  test('serialize of plain text', () => {
    assert.strictEqual(serialize('x'), 'x');
  });
});
