import type { HChild } from './hnode.ts';

/** Elements the renderer may produce. Anything else is dropped (defence in depth). */
const ALLOWED_TAGS = new Set([
  'article',
  'header',
  'section',
  'div',
  'p',
  'span',
  'em',
  'u',
  'sup',
  'br',
  'h2',
  'h3',
  'h4',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'table',
  'tbody',
  'tr',
  'td',
]);
const ALLOWED_ATTRS = new Set(['class', 'data-env', 'colspan']);
/** The only inline style the renderer generates: p{…} column widths. */
const SAFE_STYLE = /^width: \d+(\.\d+)?pt$/;

const MATHML = 'http://www.w3.org/1998/Math/MathML';
/** MathML Core elements the math translator produces (src/latex/math). */
const MATH_TAGS = new Set([
  'math',
  'mrow',
  'mi',
  'mn',
  'mo',
  'mtext',
  'mspace',
  'msup',
  'msub',
  'msubsup',
  'munder',
  'mover',
  'munderover',
  'mfrac',
  'msqrt',
  'mroot',
  'mstyle',
  'mtable',
  'mtr',
  'mtd',
  'merror',
]);
const MATH_ATTRS = new Set([
  'class',
  'display',
  'displaystyle',
  'mathvariant',
  'stretchy',
  'form',
  'fence',
  'movablelimits',
  'accent',
  'accentunder',
  'width',
  'linethickness',
  'minsize',
  'maxsize',
  'columnalign',
]);

/**
 * Build real DOM from the renderer's tree using only createElement,
 * setAttribute and text nodes, never innerHTML (AGENTS.md §9).
 */
export function toDom(node: HChild, doc: Document): Node {
  if (typeof node === 'string') return doc.createTextNode(node);
  if (MATH_TAGS.has(node.tag)) {
    const el = doc.createElementNS(MATHML, node.tag);
    for (const [name, value] of Object.entries(node.attrs))
      if (MATH_ATTRS.has(name)) el.setAttribute(name, value);
    for (const child of node.children) el.appendChild(toDom(child, doc));
    return el;
  }
  if (!ALLOWED_TAGS.has(node.tag)) return doc.createTextNode('');
  const el = doc.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs))
    if (ALLOWED_ATTRS.has(name) || (name === 'style' && SAFE_STYLE.test(value)))
      el.setAttribute(name, value);
  for (const child of node.children) el.appendChild(toDom(child, doc));
  return el;
}
