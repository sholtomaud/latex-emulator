import { parse } from '../latex/parser/parser.ts';
import { keyText } from '../latex/ast/to-latex.ts';
import { analyzeDocument } from '../latex/document/structure.ts';
import type { Node } from '../latex/ast/nodes.ts';

/**
 * The image names a document's \includegraphics commands ask for, in order
 * and without repeats, and its \graphicspath: what graphicx would look up
 * (resolve.ts). Opening a project folder imports just these files
 * (ADR 0015 phase B). Pure.
 */
export function graphicReferences(src: string): {
  names: string[];
  graphicsPath: string[];
} {
  const root = parse(src).root;
  const names: string[] = [];
  const visit = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.kind === 'command') {
        if (n.name === 'includegraphics') {
          const arg = [...n.args].reverse().find((a) => !a.optional);
          const name = arg ? keyText(arg.children).trim() : '';
          if (name && !names.includes(name)) names.push(name);
        }
        for (const a of n.args) visit(a.children);
      } else if (n.kind === 'environment') {
        for (const a of n.args) visit(a.children);
        visit(n.children);
      } else if (n.kind === 'group') visit(n.children);
    }
  };
  visit(root.children);
  return { names, graphicsPath: analyzeDocument(root).graphicsPath };
}
