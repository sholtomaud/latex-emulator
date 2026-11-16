import { test } from 'node:test';
import assert from 'node:assert';
import { htmlToText, parseZettel, retitle, zettelHtml } from './zettel-note.ts';

test('a zettel note: the ID and title as its first line (a heading), the body as paragraphs', () => {
  assert.strictEqual(
    zettelHtml(
      '1a2',
      'Energy sets <limits>',
      'First & foremost.\nSame paragraph.\n\nSecond.'
    ),
    '<h1>1a2 Energy sets &lt;limits&gt;</h1>\n<p>First &amp; foremost.<br>Same paragraph.</p>\n<p>Second.</p>'
  );
  assert.strictEqual(
    zettelHtml('3', 'Title only', ''),
    '<h1>3 Title only</h1>'
  );
});

test('reading a note back: ID, title and plain-text body, whatever Zotero wrapped it in', () => {
  const html =
    '<div data-schema-version="9"><h1>1a2 Energy sets &lt;limits&gt;</h1>\n<p>First &amp; foremost.<br>Same.</p><p>Second&nbsp;one &#8212; ok.</p></div>';
  assert.deepStrictEqual(parseZettel(html), {
    id: '1a2',
    title: 'Energy sets <limits>',
    body: 'First & foremost.\nSame.\n\nSecond one — ok.',
  });
  // A note edited in Zotero with a plain first paragraph still counts.
  assert.deepStrictEqual(parseZettel('<p>7 Short</p>'), {
    id: '7',
    title: 'Short',
    body: '',
  });
});

test('a note whose first line is not "<ID> <title>" is not a zettel', () => {
  for (const html of [
    '',
    '<p>Shopping list</p>',
    '<h1>1a2</h1>',
    '<h1>A1 Title</h1>',
  ])
    assert.strictEqual(parseZettel(html), null, html);
});

test('retitling keeps the rest of the note, formatting and all', () => {
  assert.strictEqual(
    retitle(
      '<div><h1 class="x">1 Old</h1><p><b>kept</b></p></div>',
      '1 New & better'
    ),
    '<div><h1 class="x">1 New &amp; better</h1><p><b>kept</b></p></div>'
  );
  assert.strictEqual(
    retitle('<p>1 Old</p><p>body</p>', '1 New'),
    '<h1>1 New</h1><p>body</p>'
  );
});

test('htmlToText: block ends become line breaks; numeric entities decode', () => {
  assert.strictEqual(
    htmlToText('<ul><li>a</li><li>b&#x27;s</li></ul>'),
    "a\nb's"
  );
  assert.strictEqual(htmlToText('<p>x</p><p></p><p></p><p>y</p>'), 'x\n\ny');
});
