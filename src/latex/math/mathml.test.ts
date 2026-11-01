import { describe, test } from 'node:test';
import assert from 'node:assert';
import { parse } from '../parser/parser.ts';
import { alignmentRows, mathToMathML } from './mathml.ts';
import type { MChild } from './mathml.ts';

/** Compact MathML for assertions: <tag attr="v">children</tag>. */
const ser = (c: MChild): string =>
  typeof c === 'string'
    ? c
    : `<${c.tag}${Object.entries(c.attrs)
        .map(([k, v]) => ` ${k}="${v}"`)
        .join('')}>${c.children.map(ser).join('')}</${c.tag}>`;

/** Inner MathML of $…$ (the <math> wrapper's children). */
function inline(tex: string) {
  const [m] = parse(`$${tex}$`).root.children;
  assert.ok(m.kind === 'math');
  const r = mathToMathML(m.children, { display: false });
  return { mathml: r.math.children.map(ser).join(''), r };
}
const tr = (tex: string) => inline(tex).mathml;

describe('mathToMathML: tokens', () => {
  test('letters are separate identifiers, digits numbers, operators mo', () => {
    assert.strictEqual(
      tr('E = mc'),
      '<mi>E</mi><mo>=</mo><mi>m</mi><mi>c</mi>'
    );
    assert.strictEqual(
      tr('3.14x - 2'),
      '<mn>3.14</mn><mi>x</mi><mo>−</mo><mn>2</mn>'
    );
    assert.strictEqual(
      tr('f(x), [a]'),
      '<mi>f</mi><mo form="prefix" stretchy="false">(</mo><mi>x</mi><mo form="postfix" stretchy="false">)</mo><mo>,</mo><mo form="prefix" stretchy="false">[</mo><mi>a</mi><mo form="postfix" stretchy="false">]</mo>'
    );
  });

  test('the <math> element: inline, or display style for displays', () => {
    assert.deepStrictEqual(inline('x').r.math.attrs, {});
    const [m] = parse('$x$').root.children;
    assert.ok(m.kind === 'math');
    assert.deepStrictEqual(
      mathToMathML(m.children, { display: true }).math.attrs,
      {
        displaystyle: 'true',
      }
    );
  });

  test('Greek, symbols, relations and arrows', () => {
    assert.strictEqual(
      tr('\\alpha + \\Gamma \\leq \\infty \\to \\nabla'),
      '<mi>α</mi><mo>+</mo><mi mathvariant="normal">Γ</mi><mo>≤</mo><mi mathvariant="normal">∞</mi><mo>→</mo><mi mathvariant="normal">∇</mi>'
    );
    assert.strictEqual(
      tr('a \\cdot b \\times c \\pm d'),
      '<mi>a</mi><mo>⋅</mo><mi>b</mi><mo>×</mo><mi>c</mi><mo>±</mo><mi>d</mi>'
    );
    assert.strictEqual(
      tr('\\{x\\}'),
      '<mo form="prefix" stretchy="false">{</mo><mi>x</mi><mo form="postfix" stretchy="false">}</mo>'
    );
  });

  test('functions are upright and apply to their argument', () => {
    assert.strictEqual(tr('\\sin x'), '<mi>sin</mi><mo>⁡</mo><mi>x</mi>');
    assert.strictEqual(
      tr('\\operatorname{tr} A'),
      '<mi>tr</mi><mo>⁡</mo><mi>A</mi>'
    );
  });
});

describe('mathToMathML: structure', () => {
  test('scripts take one token or a group', () => {
    assert.strictEqual(tr('x^2'), '<msup><mi>x</mi><mn>2</mn></msup>');
    assert.strictEqual(
      tr('x^23'),
      '<msup><mi>x</mi><mn>2</mn></msup><mn>3</mn>'
    );
    assert.strictEqual(
      tr('x_{i+1}^2'),
      '<msubsup><mi>x</mi><mrow><mi>i</mi><mo>+</mo><mn>1</mn></mrow><mn>2</mn></msubsup>'
    );
    assert.strictEqual(tr("f'"), '<msup><mi>f</mi><mo>′</mo></msup>');
    assert.strictEqual(
      tr("f''(x)"),
      '<msup><mi>f</mi><mo>″</mo></msup><mo form="prefix" stretchy="false">(</mo><mi>x</mi><mo form="postfix" stretchy="false">)</mo>'
    );
    assert.strictEqual(
      tr('e^{i\\pi}'),
      '<msup><mi>e</mi><mrow><mi>i</mi><mi>π</mi></mrow></msup>'
    );
  });

  test('fractions, roots and binomials', () => {
    assert.strictEqual(
      tr('\\frac{a}{b}'),
      '<mfrac><mi>a</mi><mi>b</mi></mfrac>'
    );
    assert.strictEqual(tr('\\frac12'), '<mfrac><mn>1</mn><mn>2</mn></mfrac>');
    assert.strictEqual(
      tr('\\dfrac{a}{b}'),
      '<mstyle displaystyle="true"><mfrac><mi>a</mi><mi>b</mi></mfrac></mstyle>'
    );
    assert.strictEqual(tr('\\sqrt{x}'), '<msqrt><mi>x</mi></msqrt>');
    assert.strictEqual(
      tr('\\sqrt[3]{x}'),
      '<mroot><mi>x</mi><mn>3</mn></mroot>'
    );
    assert.strictEqual(
      tr('\\binom{n}{k}'),
      '<mrow><mo>(</mo><mfrac linethickness="0"><mi>n</mi><mi>k</mi></mfrac><mo>)</mo></mrow>'
    );
  });

  test('big operators take limits (class "limits": TeX’s \\bigopspacing5 kern, in CSS); integrals take scripts', () => {
    assert.strictEqual(
      tr('\\sum_{k=1}^{n} k'),
      '<munderover class="limits"><mo>∑</mo><mrow><mi>k</mi><mo>=</mo><mn>1</mn></mrow><mi>n</mi></munderover><mi>k</mi>'
    );
    assert.strictEqual(
      tr('\\int_0^1'),
      '<msubsup><mo>∫</mo><mn>0</mn><mn>1</mn></msubsup>'
    );
    assert.strictEqual(
      tr('\\lim_{x\\to 0}'),
      '<munder class="limits"><mi>lim</mi><mrow><mi>x</mi><mo>→</mo><mn>0</mn></mrow></munder>'
    );
    assert.strictEqual(
      tr('\\sum\\nolimits_i'),
      '<msub><mo movablelimits="false">∑</mo><mi>i</mi></msub>'
    );
  });

  test('\\left … \\right fences stretch; \\big sizes are fixed', () => {
    assert.strictEqual(
      tr('\\left( \\frac{a}{b} \\right]'),
      '<mrow><mo fence="true" stretchy="true">(</mo><mfrac><mi>a</mi><mi>b</mi></mfrac><mo fence="true" stretchy="true">]</mo></mrow>'
    );
    assert.strictEqual(
      tr('\\left. x \\middle| y \\right\\}'),
      '<mrow><mi>x</mi><mo stretchy="true">|</mo><mi>y</mi><mo fence="true" stretchy="true">}</mo></mrow>'
    );
    assert.strictEqual(
      tr('\\Big('),
      '<mo minsize="1.8em" maxsize="1.8em">(</mo>'
    );
  });

  test('text, fonts and accents', () => {
    assert.strictEqual(tr('\\text{if } x'), '<mtext>if </mtext><mi>x</mi>');
    assert.strictEqual(
      tr('\\mathbb{R}^n'),
      '<msup><mi>ℝ</mi><mi>n</mi></msup>'
    );
    assert.strictEqual(
      tr('\\mathbf{v} \\mathcal{L} \\mathfrak{g}'),
      '<mi>𝐯</mi><mi>ℒ</mi><mi>𝔤</mi>'
    );
    assert.strictEqual(
      tr('\\mathrm{d}x'),
      '<mi mathvariant="normal">d</mi><mi>x</mi>'
    );
    assert.strictEqual(tr('\\mathrm{max}'), '<mi>max</mi>');
    assert.strictEqual(
      tr('\\hat{x} \\vec v'),
      '<mover accent="true"><mi>x</mi><mo>^</mo></mover><mover accent="true"><mi>v</mi><mo>→</mo></mover>'
    );
    assert.strictEqual(
      tr('\\overline{AB}'),
      '<mover accent="true"><mrow><mi>A</mi><mi>B</mi></mrow><mo stretchy="true">‾</mo></mover>'
    );
  });

  test('spacing and dots', () => {
    assert.strictEqual(
      tr('a\\,b\\quad c'),
      '<mi>a</mi><mspace width="0.1667em"></mspace><mi>b</mi><mspace width="1em"></mspace><mi>c</mi>'
    );
    assert.strictEqual(
      tr('1, \\ldots, n'),
      '<mn>1</mn><mo>,</mo><mo>…</mo><mo>,</mo><mi>n</mi>'
    );
  });

  test('matrices and cases', () => {
    const [m] = parse('$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$').root
      .children;
    assert.ok(m.kind === 'math');
    assert.strictEqual(
      ser(mathToMathML(m.children, { display: false }).math.children[0]),
      '<mrow><mo>(</mo><mtable><mtr><mtd><mi>a</mi></mtd><mtd><mi>b</mi></mtd></mtr><mtr><mtd><mi>c</mi></mtd><mtd><mi>d</mi></mtd></mtr></mtable><mo>)</mo></mrow>'
    );
    const [c] = parse(
      '$\\begin{cases} 1 & x>0 \\\\ 0 & \\text{otherwise} \\end{cases}$'
    ).root.children;
    assert.ok(c.kind === 'math');
    assert.match(
      ser(mathToMathML(c.children, { display: false }).math.children[0]),
      /^<mrow><mo>\{<\/mo><mtable columnalign="left left">/
    );
  });

  test('unknown commands are shown and reported where they are', () => {
    const { mathml, r } = inline('a + \\frob b');
    assert.strictEqual(
      mathml,
      '<mi>a</mi><mo>+</mo><merror><mtext>\\frob</mtext></merror><mi>b</mi>'
    );
    assert.strictEqual(r.diagnostics.length, 1);
    assert.strictEqual(r.diagnostics[0].code, 'math/unsupported-command');
    assert.deepStrictEqual(r.diagnostics[0].range, { start: 5, end: 10 });
  });
});

describe('alignmentRows', () => {
  test('rows at \\\\, cells at &, with labels, \\nonumber and \\tag', () => {
    const [env] = parse(
      '\\begin{align} f(x) &= x^2 \\label{eq:f} \\\\ &= y \\nonumber \\\\ g &= h \\tag{*} \\end{align}'
    ).root.children;
    assert.ok(env.kind === 'environment');
    const rows = alignmentRows(env.children);
    assert.deepStrictEqual(
      rows.map((r) => ({
        cells: r.cells.length,
        labels: r.labels.map((l) => l.key),
        numbered: r.numbered,
        tag: r.tag,
      })),
      [
        { cells: 2, labels: ['eq:f'], numbered: true, tag: undefined },
        { cells: 2, labels: [], numbered: false, tag: undefined },
        { cells: 2, labels: [], numbered: false, tag: '*' },
      ]
    );
  });

  test('a trailing \\\\ makes no empty row', () => {
    const [env] = parse('\\begin{align} a &= b \\\\ \\end{align}').root
      .children;
    assert.ok(env.kind === 'environment');
    assert.strictEqual(alignmentRows(env.children).length, 1);
  });
});

describe('mathToMathML: generic parsing', () => {
  test('a symbol followed by a group keeps the group (the parser attaches it)', () => {
    assert.strictEqual(tr('\\alpha{x}'), '<mi>α</mi><mi>x</mi>');
    assert.strictEqual(
      tr('\\hat{x}{y}'),
      '<mover accent="true"><mi>x</mi><mo>^</mo></mover><mi>y</mi>'
    );
  });
});

describe('mathToMathML: less common constructs', () => {
  test('\\text keeps text-mode content: ties, escapes, nested math', () => {
    assert.strictEqual(tr('\\text{a~b \\% $x$}'), '<mtext>a b % x</mtext>');
    assert.strictEqual(tr('\\mbox{\\emph{y}}'), '<mtext>y</mtext>');
  });

  test('negation, stacking and braces', () => {
    assert.strictEqual(
      tr('a \\not= b \\not\\in c \\not\\prec d'),
      '<mi>a</mi><mo>≠</mo><mi>b</mi><mo>∉</mo><mi>c</mi><mo>⊀</mo><mi>d</mi>'
    );
    assert.strictEqual(
      tr('\\overset{!}{=} \\underset{x}{\\max}'),
      '<mover><mo>=</mo><mo>!</mo></mover><munder><mi>max</mi><mi>x</mi></munder>'
    );
    assert.strictEqual(
      tr('\\stackrel{d}{\\to}'),
      '<mover><mo>→</mo><mi>d</mi></mover>'
    );
    assert.strictEqual(
      tr('\\overbrace{a+b}^{n} \\underbrace{c}_{m}'),
      '<mover class="limits"><mover><mrow><mi>a</mi><mo>+</mo><mi>b</mi></mrow><mo stretchy="true">⏞</mo></mover><mi>n</mi></mover><munder class="limits"><munder><mi>c</mi><mo stretchy="true">⏟</mo></munder><mi>m</mi></munder>'
    );
    assert.strictEqual(
      tr('\\underline{x}'),
      '<munder accentunder="true"><mi>x</mi><mo stretchy="true">_</mo></munder>'
    );
  });

  test('styles, upright text and alphabets', () => {
    assert.strictEqual(
      tr('a \\displaystyle b'),
      '<mi>a</mi><mstyle displaystyle="true"><mi>b</mi></mstyle>'
    );
    assert.strictEqual(
      tr('\\tfrac{1}{2}'),
      '<mstyle displaystyle="false"><mfrac><mn>1</mn><mn>2</mn></mfrac></mstyle>'
    );
    assert.strictEqual(
      tr('\\mathrm{d}x\\,\\mathrm{dt+1}'),
      '<mi mathvariant="normal">d</mi><mi>x</mi><mspace width="0.1667em"></mspace><mrow><mi>dt</mi><mo>+</mo><mn>1</mn></mrow>'
    );
    assert.strictEqual(
      tr(
        '\\mathbb{Z}_2 \\mathbf{1} \\mathsf{A} \\mathtt{a} \\mathit{h} \\bm{x} \\mathscr{B}'
      ),
      '<msub><mi>ℤ</mi><mn>2</mn></msub><mn>𝟏</mn><mi>𝖠</mi><mi>𝚊</mi><mi>ℎ</mi><mi>𝒙</mi><mi>ℬ</mi>'
    );
    assert.strictEqual(
      tr('\\mathfrak{R} \\mathcal{\\alpha}'),
      '<mi>ℜ</mi><mi>α</mi>'
    );
  });

  test('scripts with no base, \\limits, and \\lim with \\sin', () => {
    assert.strictEqual(tr('^2'), '<msup><mrow></mrow><mn>2</mn></msup>');
    assert.strictEqual(
      tr('\\sum\\limits^n'),
      '<mover class="limits"><mo movablelimits="false">∑</mo><mi>n</mi></mover>'
    );
    assert.strictEqual(
      tr('\\sin^2 x'),
      '<msup><mi>sin</mi><mn>2</mn></msup><mo>⁡</mo><mi>x</mi>'
    );
    assert.strictEqual(tr('x^'), '<msup><mi>x</mi><mrow></mrow></msup>');
  });

  test('fences: unmatched \\left, lone \\right, \\big with a command delimiter', () => {
    assert.strictEqual(
      tr('\\left[ x'),
      '<mrow><mo fence="true" stretchy="true">[</mo><mi>x</mi></mrow>'
    );
    assert.strictEqual(tr('x \\right)'), '<mi>x</mi><mo>)</mo>');
    assert.strictEqual(
      tr('\\bigl\\langle x \\bigr\\rangle'),
      '<mo minsize="1.2em" maxsize="1.2em">⟨</mo><mi>x</mi><mo minsize="1.2em" maxsize="1.2em">⟩</mo>'
    );
    assert.strictEqual(
      tr('\\left\\lfloor x \\right\\rfloor'),
      '<mrow><mo fence="true" stretchy="true">⌊</mo><mi>x</mi><mo fence="true" stretchy="true">⌋</mo></mrow>'
    );
    assert.strictEqual(
      tr('a ~ b'),
      '<mi>a</mi><mspace width="0.3333em"></mspace><mi>b</mi>'
    );
  });

  test('aligned inside an equation, array column specs, an unknown environment', () => {
    const env = (tex: string) => {
      const [x] = parse(`\\begin{equation}${tex}\\end{equation}`).root.children;
      assert.ok(x.kind === 'environment');
      return mathToMathML(x.children, { display: true });
    };
    assert.match(
      ser(
        env('\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}').math
          .children[0]
      ),
      /^<mtable columnalign="right left" displaystyle="true"><mtr><mtd><mi>a<\/mi><\/mtd><mtd><mo>=<\/mo><mi>b<\/mi><\/mtd>/
    );
    assert.match(
      ser(env('\\begin{array}{lc|r} 1 & 2 & 3 \\end{array}').math.children[0]),
      /^<mtable columnalign="left center right">/
    );
    const odd = env('\\begin{weird} x \\end{weird}');
    assert.strictEqual(odd.diagnostics.length, 1);
    assert.match(
      odd.diagnostics[0].message,
      /weird environment is not supported/
    );
    const tagged = env('x \\label{eq:x} \\tag{A} \\notag');
    assert.deepStrictEqual(
      {
        labels: tagged.labels.map((l) => l.key),
        tag: tagged.tag,
        nonumber: tagged.nonumber,
      },
      { labels: ['eq:x'], tag: 'A', nonumber: true }
    );
    const vmatrix = env(
      '\\begin{vmatrix} a \\end{vmatrix} \\begin{matrix} b \\end{matrix}'
    );
    assert.match(
      ser(vmatrix.math),
      /<mo>\|<\/mo><mtable><mtr><mtd><mi>a<\/mi><\/mtd><\/mtr><\/mtable><mo>\|<\/mo><\/mrow><mtable>/
    );
  });

  test('nested math and groups', () => {
    assert.strictEqual(
      tr('{a}{bc}'),
      '<mi>a</mi><mrow><mi>b</mi><mi>c</mi></mrow>'
    );
    assert.strictEqual(
      tr('\\binom{n}{2}'),
      '<mrow><mo>(</mo><mfrac linethickness="0"><mi>n</mi><mn>2</mn></mfrac><mo>)</mo></mrow>'
    );
  });
});
