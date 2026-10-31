import type {
  CommandNode,
  EnvironmentNode,
  Node,
  RootNode,
} from '../ast/nodes.ts';
import type { Diagnostic } from '../diagnostics.ts';

export interface DocumentClass {
  name: string;
  options: string[];
}

export interface DocumentMetadata {
  title?: Node[];
  author?: Node[];
  date?: Node[];
}

export interface DocumentStructure {
  documentClass?: DocumentClass;
  packages: string[];
  metadata: DocumentMetadata;
  /** True when the source has \begin{document}. */
  hasDocumentEnvironment: boolean;
  /** What gets typeset: the document environment's body, or everything. */
  body: Node[];
  diagnostics: Diagnostic[];
}

/** Classes whose layout the emulator implements. */
export const SUPPORTED_CLASSES = ['article'];

/** Plain text of argument content (commands contribute their mandatory arguments). */
export function plainText(nodes: Node[]): string {
  return nodes
    .map((n) => {
      if (n.kind === 'text') return n.value;
      if (n.kind === 'space') return ' ';
      if (n.kind === 'group') return plainText(n.children);
      if (n.kind === 'command')
        return n.args
          .filter((a) => !a.optional)
          .map((a) => plainText(a.children))
          .join('');
      return '';
    })
    .join('');
}

export function analyzeDocument(root: RootNode): DocumentStructure {
  const diagnostics: Diagnostic[] = [];
  const packages: string[] = [];
  const metadata: DocumentMetadata = {};
  let documentClass: DocumentClass | undefined;
  let classNode: CommandNode | undefined;

  const docEnv = root.children.find(
    (n): n is EnvironmentNode =>
      n.kind === 'environment' && n.name === 'document'
  );

  const visitCommand = (c: CommandNode) => {
    const mandatory = c.args.filter((a) => !a.optional);
    const optional = c.args.find((a) => a.optional);
    switch (c.name) {
      case 'documentclass':
        classNode = c;
        documentClass = {
          name: plainText(mandatory[0]?.children ?? []).trim(),
          options: optional
            ? plainText(optional.children)
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean)
            : [],
        };
        break;
      case 'usepackage':
        packages.push(
          ...plainText(mandatory[0]?.children ?? [])
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean)
        );
        break;
      case 'title':
      case 'author':
      case 'date':
        metadata[c.name] = mandatory[0]?.children ?? [];
        break;
    }
  };

  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (n.kind === 'command') visitCommand(n);
      else if (n.kind === 'environment' && n.name === 'document')
        walk(n.children);
    }
  };
  walk(root.children);

  if (documentClass && !SUPPORTED_CLASSES.includes(documentClass.name))
    diagnostics.push({
      range: classNode!.range,
      severity: 'warning',
      code: 'syntax/unsupported-class',
      message: `The ${documentClass.name} class is not supported yet; the article layout is used instead.`,
      source: 'syntax',
    });

  let body: Node[];
  if (docEnv) body = docEnv.children;
  else if (documentClass) {
    diagnostics.push({
      range: classNode!.range,
      severity: 'error',
      code: 'syntax/missing-document',
      message:
        'There is no \\begin{document} … \\end{document}; the text after the preamble is shown anyway.',
      source: 'syntax',
    });
    const after = root.children.indexOf(classNode!) + 1;
    body = root.children
      .slice(after)
      .filter(
        (n) =>
          !(
            n.kind === 'command' &&
            ['usepackage', 'title', 'author', 'date'].includes(n.name)
          )
      );
  } else body = root.children;

  return {
    documentClass,
    packages,
    metadata,
    hasDocumentEnvironment: !!docEnv,
    body,
    diagnostics,
  };
}
