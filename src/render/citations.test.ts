import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { renderDocument } from './render-document.ts';
import { serialize } from './hnode.ts';
import type { HChild } from './hnode.ts';

const read = (p: string) =>
  fs.readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8');
const bib = read('bibtex/test.bib');
const bstStyles = {
  plainnat: fs.readFileSync(
    new URL('../assets/bst/plainnat.bst', import.meta.url),
    'utf8'
  ),
  unsrt: fs.readFileSync(
    new URL('../assets/bst/unsrt.bst', import.meta.url),
    'utf8'
  ),
};

/** Plain text of the rendered body, no-break spaces as spaces. */
const textOf = (children: HChild[]): string =>
  children
    .map((c) => (typeof c === 'string' ? c : textOf(c.children)))
    .join('');

function render(body: string, preamble = '\\usepackage{natbib}') {
  const src = `\\documentclass{article}\n${preamble}\n\\begin{document}\n${body}\n\\bibliographystyle{plainnat}\n\\bibliography{test}\n\\end{document}`;
  return renderDocument(src, {
    today: new Date(2026, 9, 31),
    bibFiles: { test: bib },
    bstStyles,
  });
}
/** Text of the first paragraph (the citations), whitespace normalised. */
const cited = (body: string, preamble?: string) =>
  textOf([render(body, preamble).tree.children[0]])
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('natbib citations (expected text from real pdflatex + natbib)', () => {
  test('default author–year style: square brackets, comma separators', () => {
    assert.strictEqual(
      cited(
        'Energy systems were described by \\citet{odum_energy_1996}, and later refined \\citep[see][p.~10, ch.~2]{odum_energy_1996}. Two authors are cited as \\citet{brown_emergy_2004}; three or more as \\citet{hall_energy_2014}. Several works can be cited at once \\citep{brown_emergy_2004,hall_energy_2014}. The author alone is \\citeauthor{odum_energy_1996} and the year alone is \\citeyear{odum_energy_1996}. A plain \\cite{odum_energy_1996} behaves like citet, and a page note alone gives \\citep[p.~10]{odum_energy_1996}.'
      ),
      'Energy systems were described by Odum [1996], and later refined [see Odum, 1996, p. 10, ch. 2]. Two authors are cited as Brown and Ulgiati [2004]; three or more as Hall et al. [2014]. Several works can be cited at once [Brown and Ulgiati, 2004, Hall et al., 2014]. The author alone is Odum and the year alone is 1996. A plain Odum [1996] behaves like citet, and a page note alone gives [Odum, 1996, p. 10].'
    );
  });

  test('round and semicolon options', () => {
    assert.strictEqual(
      cited(
        'X \\citep{brown_emergy_2004,hall_energy_2014} Y \\citet{odum_energy_1996}.',
        '\\usepackage[round,semicolon]{natbib}'
      ),
      'X (Brown and Ulgiati, 2004; Hall et al., 2014) Y Odum (1996).'
    );
  });

  test('merging, starred, alt, alp, yearpar, capitalised and noted variants', () => {
    assert.strictEqual(
      cited(
        'A \\citep{odum_maximum_1955,odum_maximum_1955b}. B \\citet{odum_maximum_1955,odum_maximum_1955b}. C \\citep{odum_energy_1996,odum_maximum_1955}. D \\citet*{hall_energy_2014}. E \\citealt{odum_energy_1996}. F \\citealp{odum_energy_1996}. G \\citeyearpar{odum_energy_1996}. H \\Citet{waals_continuity_1873}. I \\citep[p.~5]{odum_energy_1996}. J \\citet[p.~5]{odum_energy_1996}. K \\citet[see][p.~5]{odum_energy_1996}. L \\citeauthor*{hall_energy_2014}. M \\citefullauthor{hall_energy_2014}. N \\citealp[see][]{odum_energy_1996}.'
      ),
      'A [Odum and Pinkerton, 1955a,b]. B Odum and Pinkerton [1955a,b]. C [Odum, 1996, Odum and Pinkerton, 1955a]. D Hall, Lambert, and Balogh [2014]. E Odum 1996. F Odum, 1996. G [1996]. H Van der Waals [1873]. I [Odum, 1996, p. 5]. J Odum [1996, p. 5]. K Odum [see 1996, p. 5]. L Hall, Lambert, and Balogh. M Hall, Lambert, and Balogh. N see Odum, 1996.'
    );
  });

  test('undefined citations print a bold ? and warn at the key', () => {
    const r = render('A \\citep{nokey} and \\citet{nokey}.');
    assert.match(
      serialize(r.tree.children[0]),
      /A \[<span class="bf">\?<\/span>\] and <span class="bf">\?<\/span>\./
    );
    const d = r.diagnostics.filter((x) => x.code === 'ref/undefined-citation');
    assert.strictEqual(d.length, 2);
    assert.strictEqual(d[0].severity, 'warning');
  });

  test('cite keys with underscores are not syntax errors', () => {
    const r = render('\\citep{odum_energy_1996} \\nocite{brown_emergy_2004}');
    assert.deepStrictEqual(
      r.diagnostics.filter((d) => d.source === 'syntax').map((d) => d.code),
      []
    );
  });
});

describe('the bibliography', () => {
  const r = render(
    '\\citep{odum_energy_1996,brown_emergy_2004,hall_energy_2014}'
  );
  const html = r.tree.children.map(serialize).join('');

  test('is a References section with the cited entries, sorted as plainnat sorts', () => {
    assert.match(html, /<h2 class="section">References<\/h2>/);
    const items = [...html.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]);
    assert.strictEqual(items.length, 3);
    assert.match(items[0], /^<p>Mark T\. Brown and Sergio Ulgiati\./);
    assert.match(items[1], /^<p>Charles A\. S\. Hall/);
    assert.match(items[2], /^<p>Howard T\. Odum\./);
  });

  test('typesets the .bbl: emphasis, dashes, \\penalty0 and doi', () => {
    assert.match(
      html,
      /<em>Ecological Modelling<\/em>, 178\(1–2\):201–213, May 2004\. <span class="newblock"><\/span>doi: 10\.1016\/j\.ecolmodel\.2003\.12\.032\./
    );
    assert.match(
      html,
      /URL <span class="tt">https:\/\/example\.org\/eroi<\/span>\./
    );
  });

  test('\\nocite{*} includes everything; the label count matches bibtex', () => {
    const all = render('\\nocite{*}');
    assert.strictEqual(
      all.tree.children.map(serialize).join('').match(/<li>/g)?.length,
      20
    );
  });

  test('an unknown style warns and falls back to plainnat (natbib keeps its round default)', () => {
    const src =
      '\\documentclass{article}\\usepackage{natbib}\\begin{document}\\citep{odum_energy_1996}\\bibliographystyle{nosuch}\\bibliography{test}\\end{document}';
    const x = renderDocument(src, { bibFiles: { test: bib }, bstStyles });
    assert.ok(
      x.diagnostics.some((d) => d.code === 'ref/unknown-bibliography-style')
    );
    // natbib has no \bibstyle@nosuch, so its own defaults apply.
    assert.match(textOf(x.tree.children), /^\(Odum, 1996\)References/);
  });

  test('\\bibliography{a,b} reads a.bib and b.bib from the library', () => {
    const src =
      '\\documentclass{article}\\usepackage{natbib}\\begin{document}\\citet{odum_energy_1996} \\citet{extra_2020}\\bibliographystyle{plainnat}\\bibliography{test, extra.bib}\\end{document}';
    const x = renderDocument(src, {
      bibFiles: {
        test: bib,
        extra:
          '@misc{extra_2020, author = {Zed Extra}, title = {T}, year = 2020}',
      },
      bstStyles,
    });
    assert.match(
      textOf(x.tree.children).replace(/ /g, ' '),
      /^Odum \[1996\] Extra \[2020\]/
    );
  });

  test('a missing .bib file warns; its citations are undefined', () => {
    const src =
      '\\documentclass{article}\\usepackage{natbib}\\begin{document}\\citep{odum_energy_1996}\\bibliographystyle{plainnat}\\bibliography{refs}\\end{document}';
    const x = renderDocument(src, { bstStyles });
    const missing = x.diagnostics.find(
      (d) => d.code === 'ref/missing-bib-file'
    );
    assert.ok(missing);
    assert.match(missing.message, /refs\.bib/);
    assert.ok(x.diagnostics.some((d) => d.code === 'ref/undefined-citation'));
  });

  test('without \\bibliographystyle, plainnat is used with a warning', () => {
    const src =
      '\\documentclass{article}\\usepackage{natbib}\\begin{document}\\citet{odum_energy_1996}\\bibliography{test}\\end{document}';
    const x = renderDocument(src, { bibFiles: { test: bib }, bstStyles });
    assert.ok(
      x.diagnostics.some((d) => d.code === 'ref/missing-bibliography-style')
    );
    assert.match(textOf(x.tree.children), /^Odum \(1996\)References/);
  });
});

describe('classic LaTeX citations (no natbib)', () => {
  test('a hand-written thebibliography gives numbered citations', () => {
    const src =
      '\\documentclass{article}\\begin{document}See \\cite{b} and \\cite[p.~5]{a}.\\begin{thebibliography}{9}\\bibitem{a} First.\\bibitem{b} Second.\\end{thebibliography}\\end{document}';
    const x = renderDocument(src, {});
    const html = x.tree.children.map(serialize).join('');
    assert.match(
      textOf(x.tree.children).replace(/ /g, ' '),
      /See \[2\] and \[1, p\. 5\]\./
    );
    assert.match(html, /<span class="item-label">\[1\]<\/span>First\./);
  });
});

describe('numerical natbib (expected text from real pdflatex + natbib)', () => {
  const body =
    'A \\citet{knuth} B \\citep{knuth,plain} C \\citealt{plain} D \\citealp{plain} E \\citep[see][p.~2]{plain} F \\citenum{plain} G \\citeyearpar{plain} H \\citeauthor{plain} I \\citeyear{plain}.';
  const handwritten = (options: string, items: string, text = body) =>
    renderDocument(
      `\\documentclass{article}\\usepackage${options}{natbib}\\begin{document}${text}\\begin{thebibliography}{9}${items}\\end{thebibliography}\\end{document}`,
      {}
    );
  const firstPara = (x: ReturnType<typeof renderDocument>) =>
    textOf([x.tree.children[0]]).replace(/\u00a0/g, ' ');
  const items = '\\bibitem[Knuth]{knuth} K.\\bibitem{plain} P.';

  for (const [options, expected] of [
    [
      '',
      'A (author?) (Knuth) B (Knuth; 2) C (author?) 2 D 2 E (see 2, p. 2) F 2 G ((year?)) H (author?) I (year?).',
    ],
    [
      '[numbers]',
      'A (author?) [Knuth] B [Knuth, 2] C (author?) 2 D 2 E [see 2, p. 2] F 2 G [(year?)] H (author?) I (year?).',
    ],
    [
      '[square]',
      'A (author?) [Knuth] B [Knuth; 2] C (author?) 2 D 2 E [see 2, p. 2] F 2 G [(year?)] H (author?) I (year?).',
    ],
    [
      '[semicolon,numbers]',
      'A (author?) [Knuth] B [Knuth; 2] C (author?) 2 D 2 E [see 2, p. 2] F 2 G [(year?)] H (author?) I (year?).',
    ],
  ])
    test(`\\usepackage${options}{natbib}`, () =>
      assert.strictEqual(firstPara(handwritten(options, items)), expected));

  test('one numerical \\bibitem makes every citation numerical', () => {
    const x = handwritten(
      '',
      '\\bibitem[Odum(1996)]{odum} O.\\bibitem[Knuth]{knuth} K.',
      'A \\citep{odum} B \\citep{knuth}'
    );
    assert.strictEqual(firstPara(x), 'A (1) B (Knuth)');
    const html = x.tree.children.map(serialize).join('');
    assert.match(html, /<span class="item-label">\[1\]<\/span>O\./);
    assert.match(html, /<span class="item-label">\[Knuth\]<\/span>K\./);
  });

  test('(author?) is bold, as natbib sets it', () => {
    assert.match(
      serialize(handwritten('', items, '\\citet{knuth}').tree.children[0]),
      /<span class="bf">\(author\?\)<\/span> \(Knuth\)/
    );
  });
});

describe('undefined citations say why', () => {
  const PATTEN =
    '@article{patten_information_1963, author = {Patten, B. C.}, title = {Information processing behavior of a natural plankton community}, journal = {Am. Zool.}, year = {1963}}';
  const message = (src: string, bibFiles: Record<string, string>) =>
    renderDocument(src, { bibFiles, bstStyles }).diagnostics.find(
      (d) => d.code === 'ref/undefined-citation'
    )?.message;
  const doc = (bib: string) =>
    `\\documentclass{article}\\usepackage{natbib}\\begin{document}\\citeauthor{patten_information_1963}${bib}\\end{document}`;

  test('the key is in a library file that \\bibliography does not list', () => {
    assert.strictEqual(
      message(doc('\\bibliographystyle{plainnat}\\bibliography{references}'), {
        references: bib,
        mylib: PATTEN,
      }),
      'Citation "patten_information_1963" is in mylib.bib, which \\bibliography{references} doesn’t list. Use \\bibliography{references,mylib}.'
    );
  });

  test('the document has no \\bibliography', () => {
    assert.strictEqual(
      message(doc(''), { mylib: PATTEN }),
      'Citation "patten_information_1963" is in mylib.bib, but the document has no \\bibliography. Add \\bibliographystyle{plainnat} and \\bibliography{mylib} where the references should appear.'
    );
  });

  test('the file is listed but BibTeX could not read that entry', () => {
    const broken = `@article{ok_2000, title = {OK}, year = 2000}\n\n@article{patten_information_1963,\n  title = {Unclosed,\n  year = 1963\n`;
    assert.match(
      message(doc('\\bibliographystyle{plainnat}\\bibliography{mylib}'), {
        mylib: broken,
      }) ?? '',
      /^Citation "patten_information_1963" is in mylib\.bib, but BibTeX could not read that entry: Unbalanced braces \(line \d+\)\.$/
    );
  });

  test('matching is case-insensitive, like BibTeX', () => {
    assert.match(
      message(doc('\\bibliographystyle{plainnat}\\bibliography{references}'), {
        references: bib,
        mylib: PATTEN.replace(
          'patten_information_1963',
          'Patten_Information_1963'
        ),
      }) ?? '',
      /is in mylib\.bib/
    );
  });

  test('a key that is nowhere is reported as before', () => {
    assert.strictEqual(
      message(doc('\\bibliographystyle{plainnat}\\bibliography{references}'), {
        references: bib,
      }),
      'Citation "patten_information_1963" is undefined: it is not in any .bib file in the references library.'
    );
  });
});

describe('undefined citations come with a quick fix', () => {
  const PATTEN =
    '@article{patten_information_1963, title = {T}, year = {1963}}';
  const diagnostic = (src: string, bibFiles: Record<string, string>) =>
    renderDocument(src, { bibFiles, bstStyles }).diagnostics.find(
      (d) => d.code === 'ref/undefined-citation'
    );
  const apply = (src: string, d: ReturnType<typeof diagnostic>) => {
    const [fix] = d?.fixes ?? [];
    assert.ok(fix, 'a fix');
    let out = src;
    for (const e of [...fix.edits].sort(
      (a, b) => b.range.start - a.range.start
    ))
      out = out.slice(0, e.range.start) + e.text + out.slice(e.range.end);
    return { title: fix.title, out };
  };

  test('a file \\bibliography does not list: add it', () => {
    const src =
      '\\documentclass{article}\\usepackage{natbib}\\begin{document}\\citet{patten_information_1963}\\bibliographystyle{plainnat}\\bibliography{references}\\end{document}';
    const { title, out } = apply(
      src,
      diagnostic(src, { references: bib, mylib: PATTEN })
    );
    assert.strictEqual(title, 'Add mylib to \\bibliography');
    assert.match(out, /\\bibliography\{references,mylib\}\\end\{document\}$/);
    // Applying it resolves the citation.
    assert.strictEqual(
      diagnostic(out, { references: bib, mylib: PATTEN }),
      undefined
    );
  });

  test('no \\bibliography: add one before \\end{document}', () => {
    const src =
      '\\documentclass{article}\\usepackage{natbib}\\begin{document}\n\\citet{patten_information_1963}\n\\end{document}\n';
    const { title, out } = apply(src, diagnostic(src, { mylib: PATTEN }));
    assert.strictEqual(title, 'Add \\bibliography{mylib}');
    assert.strictEqual(
      out,
      '\\documentclass{article}\\usepackage{natbib}\\begin{document}\n\\citet{patten_information_1963}\n\\bibliographystyle{plainnat}\n\\bibliography{mylib}\n\\end{document}\n'
    );
    assert.strictEqual(diagnostic(out, { mylib: PATTEN }), undefined);
  });

  test('no fix when the key is nowhere or unreadable', () => {
    const src =
      '\\documentclass{article}\\usepackage{natbib}\\begin{document}\\citet{nope}\\bibliographystyle{plainnat}\\bibliography{references}\\end{document}';
    assert.strictEqual(diagnostic(src, { references: bib })?.fixes, undefined);
  });
});

describe('bibliographyFiles', () => {
  test('the files a document’s \\bibliography lists', async () => {
    const { bibliographyFiles } = await import('./bibliography.ts');
    assert.deepStrictEqual(
      bibliographyFiles(
        '\\begin{document}x\\bibliography{refs, more.bib}\\end{document}'
      ),
      ['refs', 'more']
    );
    assert.deepStrictEqual(bibliographyFiles('no bibliography'), []);
  });
});
