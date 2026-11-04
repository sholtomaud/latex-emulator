import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../parser/parser.ts';
import { plainText } from '../document/structure.ts';
import type { EnvironmentNode } from '../ast/nodes.ts';
import { elsFrontmatter, elsOptions } from './elsarticle.ts';

const front = (body: string) => {
  const env = parse(`\\begin{frontmatter}${body}\\end{frontmatter}`).root
    .children[0] as EnvironmentNode;
  return elsFrontmatter(env);
};
const text = (nodes: Parameters<typeof plainText>[0] | undefined) =>
  plainText(nodes ?? [])
    .replace(/\s+/g, ' ')
    .trim();

describe('elsOptions (elsarticle.cls options)', () => {
  test('defaults: preprint, 10pt, letter paper, numbered natbib', () => {
    // \ExecuteOptions{a4paper,…} does nothing: elsarticle never declares
    // a4paper, so article's letterpaper stays (as pdflatex shows).
    assert.deepEqual(elsOptions([]), {
      mode: 'preprint',
      size: 10,
      paper: 'letterpaper',
      natbib: ['numbers'],
    });
  });

  test('size, paper, authoryear, nonatbib, review and the journal modes', () => {
    assert.deepEqual(
      elsOptions(['preprint', '12pt', 'a4paper', 'authoryear']),
      {
        mode: 'preprint',
        size: 12,
        paper: 'a4paper',
        natbib: ['round', 'authoryear'],
      }
    );
    assert.equal(elsOptions(['nonatbib']).natbib, null);
    assert.equal(elsOptions(['review']).mode, 'review');
    assert.equal(elsOptions(['3p']).mode, '3p');
    assert.equal(elsOptions(['final']).mode, 'final');
  });
});

describe('elsFrontmatter', () => {
  test('title, authors with affiliation letters, corresponding mark and e-mail', () => {
    const f = front(
      '\\title{Flows}\\author[a]{Ada\\corref{c1}}\\ead{ada@x.org}' +
        '\\author[a,b]{Howard}\\cortext[c1]{Corresponding author}' +
        '\\address[a]{Dept A}\\address[b]{Inst B}'
    );
    assert.equal(text(f.title), 'Flows');
    assert.deepEqual(
      f.authors.map((a) => [text(a.name), a.marks]),
      [
        ['Ada', ['a', '∗']],
        ['Howard', ['a', 'b']],
      ]
    );
    assert.deepEqual(
      f.addresses.map((a) => [a.mark, text(a.text)]),
      [
        ['a', 'Dept A'],
        ['b', 'Inst B'],
      ]
    );
    assert.deepEqual(
      f.notes.map((n) => [n.kind, n.mark, text(n.text)]),
      [['cortext', '\u2217', 'Corresponding author']]
    );
    assert.deepEqual(
      f.emails.map((e) => [e.address, text(e.author)]),
      [['ada@x.org', 'Ada']]
    );
  });

  test('affiliation keys join with commas (no comma after the country)', () => {
    const f = front(
      '\\author[l1]{A}\\affiliation[l1]{organization={Uni},addressline={1 Road},city={Town},postcode={123},country={Land}}'
    );
    assert.equal(text(f.addresses[0].text), 'Uni, 1 Road, Town, 123, Land');
    assert.equal(f.addresses[0].mark, 'a');
  });

  test('one unlabelled address has no letters; footnote marks and two e-mails', () => {
    const f = front(
      '\\author{A\\fnref{f1}}\\ead{a@x}\\author{B}\\ead{b@x}\\address{Somewhere}\\fntext[f1]{Now elsewhere.}'
    );
    assert.deepEqual(
      f.authors.map((a) => a.marks),
      [['1'], []]
    );
    assert.deepEqual(
      f.addresses.map((a) => a.mark),
      [null]
    );
    assert.deepEqual(
      f.emails.map((e) => [e.address, text(e.author)]),
      [
        ['a@x', 'A'],
        ['b@x', 'B'],
      ]
    );
    assert.deepEqual(
      f.notes.map((n) => [n.kind, n.mark, text(n.text)]),
      [['fntext', '1', 'Now elsewhere.']]
    );
  });

  test('abstract, keywords split at \\sep, and what else is in the frontmatter', () => {
    const f = front(
      '\\title{T}\\begin{abstract}We measure.\\end{abstract}\\begin{keyword}a \\sep b c\\sep d\\end{keyword}'
    );
    assert.equal(text(f.abstract), 'We measure.');
    assert.deepEqual(f.keywords?.map(text), ['a', 'b c', 'd']);
    const none = front('\\title{T}');
    assert.equal(none.abstract, undefined);
    assert.equal(none.keywords, undefined);
  });
});

describe('elsFrontmatter: the rest of the title-page notes', () => {
  test('title notes (⋆), a second corresponding author (∗∗), URLs', () => {
    const f = front(
      '\\title{T\\tnoteref{t1}}\\tnotetext[t1]{Funded.}' +
        '\\author{A\\corref{c1}}\\ead[url]{https://a.org}\\author{B\\corref{c2}}' +
        '\\cortext[c1]{One}\\cortext[c2]{Two}'
    );
    assert.equal(text(f.title), 'T⋆');
    assert.deepEqual(
      f.authors.map((a) => a.marks),
      [['∗'], ['∗∗']]
    );
    assert.deepEqual(
      f.notes.map((n) => [n.kind, n.mark]),
      [
        ['tnote', '⋆'],
        ['cortext', '∗'],
        ['cortext', '∗∗'],
      ]
    );
    assert.deepEqual(
      f.urls.map((u) => [u.address, text(u.author)]),
      [['https://a.org', 'A']]
    );
    assert.deepEqual(f.emails, []);
  });

  test('unknown labels, unlabelled notes and affiliations, odd keys', () => {
    const f = front(
      '\\author[zz]{A\\corref{none}\\fnref{none}}\\cortext{no label}\\fntext{no label}\\tnotetext{no label}' +
        '\\affiliation{organization={Uni},state={S},odd={x},postcode}'
    );
    // \\elsRef of an unknown label: 1 for affiliations and \\fnref, nothing for \\corref.
    assert.deepEqual(f.authors[0].marks, ['1', '1']);
    assert.deepEqual(f.notes, []);
    // No country: the last item keeps its comma, as in pdflatex.
    assert.deepEqual(
      f.addresses.map((a) => [a.mark, text(a.text)]),
      [[null, 'Uni, S,']]
    );
  });

  test('more than 26 addresses count on as aa, ab… (\\@alph)', () => {
    const addresses = Array.from(
      { length: 28 },
      (_, i) => `\\address[l${i}]{A${i}}`
    ).join('');
    const f = front(addresses);
    assert.deepEqual(
      f.addresses.slice(25).map((a) => a.mark),
      ['z', 'aa', 'ab']
    );
  });
});

describe('elsOptions: every paper size article knows', () => {
  test('passed on to article', () => {
    for (const paper of [
      'a5paper',
      'b5paper',
      'legalpaper',
      'executivepaper',
      'letterpaper',
    ])
      assert.equal(elsOptions([paper]).paper, paper);
    assert.equal(elsOptions(['5p']).mode, '5p');
    assert.deepEqual(elsOptions(['authoryear', 'number']).natbib, ['numbers']);
  });
});
