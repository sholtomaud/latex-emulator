/**
 * Times what a large references library costs per keystroke:
 *   node scripts/bench-citations.ts [entries]
 * The library is synthetic (default 10,000 entries, about 2.8 MB, the size
 * that made typing lag; docs/backlog.md). Each preview render is timed
 * after a warm-up, so it measures a keystroke with an unchanged library.
 */
import fs from 'node:fs';
import { renderDocument } from '../src/render/render-document.ts';
import { indexLibrary, matchEntries } from '../src/references/cite-index.ts';
import { citeContextAt } from '../src/language/cite-context.ts';

const N = Number(process.argv[2] ?? 10000);
const words = ['energy', 'systems', 'ecology', 'emergy', 'analysis', 'flow'];
const w = (i: number) => words[i % words.length];
const key = (i: number) => `author${i}_${w(i)}_${1950 + (i % 70)}`;
let bib = '';
for (let i = 0; i < N; i++)
  bib += `@article{${key(i)},\n  author = {Smith${i}, John and M{\\"u}ller, Anna and Doe, Jane},\n  title = {On the {${w(i)}} of ${w(i + 3)} and \\emph{${w(i + 5)}}},\n  journal = {Journal of ${w(i + 1)}},\n  year = {${1950 + (i % 70)}},\n  volume = {${i % 90}},\n  pages = {1--20},\n  doi = {10.1000/x${i}}\n}\n\n`;

const bstDir = new URL('../src/assets/bst/', import.meta.url);
const bstStyles: Record<string, string> = {};
for (const f of fs.readdirSync(bstDir))
  if (f.endsWith('.bst'))
    bstStyles[f.slice(0, -4)] = fs.readFileSync(new URL(f, bstDir), 'utf8');

const prose = (cites: string) =>
  `Some prose ${cites} and more words follow it here.\n\n`.repeat(200);
const doc = (cites: string) =>
  `\\documentclass{article}\\usepackage{natbib}\\begin{document}\n${prose(cites)}\\bibliographystyle{plainnat}\\bibliography{refs}\\end{document}`;

function time(label: string, f: () => unknown, reps = 5) {
  f();
  const start = performance.now();
  for (let r = 0; r < reps; r++) f();
  const ms = (performance.now() - start) / reps;
  console.log(`${label.padEnd(52)} ${ms.toFixed(1).padStart(8)} ms`);
}

console.log(`${N} entries, ${(bib.length / 1e6).toFixed(1)} MB\n`);
const files = { refs: bib };
const valid = doc(`\\citep{${key(12)}, ${key(40)}}`);
time('render, no library', () =>
  renderDocument(valid, { bibFiles: {}, bstStyles })
);
time('render, 200 paragraphs, 400 valid citations', () =>
  renderDocument(valid, { bibFiles: files, bstStyles })
);
time('render, 200 undefined citations (one missing key)', () =>
  renderDocument(doc('\\citep{author12_emergy_1962}'), {
    bibFiles: files,
    bstStyles,
  })
);
time('render, 200 distinct undefined keys', () => {
  let i = 0;
  renderDocument(
    doc('\\citep{missing}').replace(/missing/g, () => `missing${i++}`),
    { bibFiles: files, bstStyles }
  );
});
// Typing a key: the half-typed key changes on every keystroke.
let typed = 0;
time('render while typing a key (a new citation each time)', () =>
  renderDocument(doc(`\\citep{${key(12)}} \\citep{auth${typed++}}`), {
    bibFiles: files,
    bstStyles,
  })
);
time('typeahead index (once per library change)', () => indexLibrary(files), 1);
const entries = indexLibrary(files);
time('typeahead match "author99"', () => matchEntries(entries, 'author99'), 20);
time('typeahead match "energy"', () => matchEntries(entries, 'energy'), 20);
time('cite context (parses the document)', () =>
  citeContextAt(valid, valid.indexOf('citep{') + 8)
);
