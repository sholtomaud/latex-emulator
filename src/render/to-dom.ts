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
]);
const ALLOWED_ATTRS = new Set(['class', 'data-env']);

/**
 * Build real DOM from the renderer's tree using only createElement,
 * setAttribute and text nodes, never innerHTML (AGENTS.md §9).
 */
export function toDom(node: HChild, doc: Document): Node {
  if (typeof node === 'string') return doc.createTextNode(node);
  if (!ALLOWED_TAGS.has(node.tag)) return doc.createTextNode('');
  const el = doc.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs))
    if (ALLOWED_ATTRS.has(name)) el.setAttribute(name, value);
  for (const child of node.children) el.appendChild(toDom(child, doc));
  return el;
}
