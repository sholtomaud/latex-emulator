import type { ArgNode, Node } from './nodes.ts';

const CONTROL_WORD = /^[A-Za-z@]+$/;

/**
 * Serialise nodes back to LaTeX source (used to carry labels and citation
 * notes into generated LaTeX). Comments are dropped.
 */
export function toLatex(nodes: Node[]): string {
  let out = '';
  nodes.forEach((n, i) => {
    switch (n.kind) {
      case 'text':
        out += n.value;
        break;
      case 'space':
        out += ' ';
        break;
      case 'parbreak':
        out += '\n\n';
        break;
      case 'comment':
        break;
      case 'special':
        out += n.char;
        break;
      case 'verb':
        out += `\\verb${n.star ? '*' : ''}|${n.value}|`;
        break;
      case 'verbatim':
        out += `\\begin{${n.env}}${n.value}\\end{${n.env}}`;
        break;
      case 'group':
        out += `{${toLatex(n.children)}}`;
        break;
      case 'math':
        out +=
          n.delimiter === '\\('
            ? `\\(${n.source}\\)`
            : n.delimiter === '\\['
              ? `\\[${n.source}\\]`
              : `${n.delimiter}${n.source}${n.delimiter}`;
        break;
      case 'environment':
        out += `\\begin{${n.name}}${args(n.args)}${toLatex(n.children)}\\end{${n.name}}`;
        break;
      case 'command': {
        out += `\\${n.name}${n.star ? '*' : ''}${args(n.args)}`;
        // A control word directly followed by a letter needs a separator.
        const next = nodes[i + 1];
        if (
          n.args.length === 0 &&
          CONTROL_WORD.test(n.name) &&
          next?.kind === 'text' &&
          /^[A-Za-z@]/.test(next.value)
        )
          out += ' ';
      }
    }
  });
  return out;
}

function args(list: ArgNode[]): string {
  return list
    .map((a) =>
      a.optional ? `[${toLatex(a.children)}]` : `{${toLatex(a.children)}}`
    )
    .join('');
}

/** The literal text of a key/label argument (e.g. odum_energy_1996). */
export function keyText(nodes: Node[]): string {
  return nodes
    .map((n) => {
      switch (n.kind) {
        case 'text':
          return n.value;
        case 'special':
          return n.char;
        case 'space':
        case 'parbreak':
          return ' ';
        case 'group':
          return keyText(n.children);
        case 'command':
          return `\\${n.name}`;
        default:
          return '';
      }
    })
    .join('');
}
