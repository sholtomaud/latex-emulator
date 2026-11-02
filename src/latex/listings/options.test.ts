import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LST,
  applyLstOptions,
  languageKey,
  parseFontStyle,
} from './options.ts';

describe('languageKey', () => {
  test('dialects in brackets, defaults from listings.cfg, case-insensitive', () => {
    assert.equal(languageKey('Python'), 'python');
    assert.equal(languageKey('C'), '[ansi]c');
    assert.equal(languageKey('{[ISO]C++}'), '[iso]c++');
    assert.equal(languageKey('[LaTeX]TeX'), '[latex]tex');
    assert.equal(languageKey('TeX'), '[plain]tex');
  });
});

describe('parseFontStyle', () => {
  test('family, series, shape and size switches; anything else is reported', () => {
    assert.deepEqual(parseFontStyle('\\ttfamily\\small'), {
      family: 'tt',
      size: 'small',
      unsupported: [],
    });
    assert.deepEqual(parseFontStyle('\\bfseries\\color{blue}\\itshape'), {
      series: 'bf',
      shape: 'it',
      unsupported: ['\\color'],
    });
    assert.deepEqual(parseFontStyle(''), { unsupported: [] });
  });
});

describe('applyLstOptions', () => {
  test('listings’ defaults', () => {
    assert.equal(DEFAULT_LST.columns, 'fixed');
    assert.equal(DEFAULT_LST.basewidth, 0.6);
    assert.equal(DEFAULT_LST.tabsize, 8);
    assert.equal(DEFAULT_LST.showstringspaces, true);
    assert.equal(DEFAULT_LST.captionpos, 't');
    assert.equal(DEFAULT_LST.numbers, 'none');
    assert.deepEqual(DEFAULT_LST.keywordstyle, [
      { series: 'bf', unsupported: [] },
    ]);
    // lstmisc.sty: \lst@AddToHook{EmptyStyle}{\let\lst@commentstyle\itshape}
    assert.deepEqual(DEFAULT_LST.commentstyle, {
      shape: 'it',
      unsupported: [],
    });
  });

  test('keys apply in order; style= inserts a named style there', () => {
    const styles = new Map([['mine', 'numbers=left, basicstyle=\\ttfamily']]);
    const s = applyLstOptions(
      DEFAULT_LST,
      'language=Python, style=mine, numbers=right, caption={A [b], c}, label=lst:a',
      styles
    );
    assert.equal(s.language, 'python');
    assert.equal(s.numbers, 'right');
    assert.equal(s.basicstyle.family, 'tt');
    assert.equal(s.caption, 'A [b], c');
    assert.equal(s.label, 'lst:a');
    assert.deepEqual(s.problems, []);
  });

  test('columns, keywordstyle classes, numbers and frames', () => {
    const s = applyLstOptions(
      DEFAULT_LST,
      'columns=[l]fullflexible, keywordstyle=[2]\\itshape, frame=single, framesep=5pt, numbersep=4pt, firstnumber=10, stepnumber=2, tabsize=4, showstringspaces=false, basewidth={0.5em,0.4em}, xleftmargin=2em',
      new Map()
    );
    assert.deepEqual(
      [
        s.columns,
        s.align,
        s.frame,
        s.framesep,
        s.numbersep,
        s.firstnumber,
        s.stepnumber,
        s.tabsize,
        s.showstringspaces,
        s.basewidth,
        s.xleftmargin,
      ],
      ['fullflexible', 'l', 'single', '5pt', '4pt', 10, 2, 4, false, 0.5, '2em']
    );
    assert.deepEqual(s.keywordstyle[1], { shape: 'it', unsupported: [] });
    assert.deepEqual(s.keywordstyle[0], DEFAULT_LST.keywordstyle[0]);
  });

  test('title is an unnumbered caption; caption=[short]{long}', () => {
    assert.equal(
      applyLstOptions(DEFAULT_LST, 'title=Code', new Map()).title,
      'Code'
    );
    assert.equal(
      applyLstOptions(DEFAULT_LST, 'caption=[S]{Long}', new Map()).caption,
      'Long'
    );
  });

  test('unknown keys, styles and values are problems, not failures', () => {
    const s = applyLstOptions(
      DEFAULT_LST,
      'escapeinside={(*}{*)}, style=nope, numbers=middle, frame=shadowbox, commentstyle=\\color{gray}',
      new Map()
    );
    assert.deepEqual(s.problems, [
      'escapeinside',
      'style=nope',
      'numbers=middle',
      'frame=shadowbox',
      'commentstyle: \\color',
    ]);
  });
});

describe('applyLstOptions: more keys', () => {
  test('bare keys, directivestyle, flexiblecolumns, and silently accepted keys', () => {
    const s = applyLstOptions(
      DEFAULT_LST,
      'showstringspaces, directivestyle=\\itshape, flexiblecolumns, float, name=x',
      new Map()
    );
    assert.equal(s.showstringspaces, true);
    assert.deepEqual(s.directivestyle, { shape: 'it', unsupported: [] });
    assert.equal(s.columns, 'flexible');
    assert.deepEqual(s.problems, []);
    assert.equal(
      applyLstOptions(s, 'flexiblecolumns=false', new Map()).columns,
      'fixed'
    );
  });
});
