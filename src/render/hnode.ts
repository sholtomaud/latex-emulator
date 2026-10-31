/**
 * A minimal, pure description of the DOM the renderer wants. Keeping the
 * renderer DOM-free lets it run (and be unit-tested) under Node; `to-dom.ts`
 * turns it into real elements with createElement/textContent/setAttribute only.
 */
export interface HElement {
  tag: string;
  attrs: Record<string, string>;
  children: HChild[];
}

export type HChild = HElement | string;

export function h(
  tag: string,
  attrs: Record<string, string> = {},
  children: HChild[] = []
): HElement {
  return { tag, attrs, children };
}

const VOID = new Set(['br', 'hr', 'col', 'wbr']);

const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** HTML serialisation, for tests and debugging only (never fed to innerHTML). */
export function serialize(node: HChild): string {
  if (typeof node === 'string') return escape(node);
  const attrs = Object.entries(node.attrs)
    .map(([k, v]) => ` ${k}="${escape(v)}"`)
    .join('');
  if (VOID.has(node.tag)) return `<${node.tag}${attrs}>`;
  return `<${node.tag}${attrs}>${node.children.map(serialize).join('')}</${node.tag}>`;
}
