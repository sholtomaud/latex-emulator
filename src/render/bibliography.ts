/**
 * Pass 1 of citation handling (like LaTeX's .aux): find what is cited, run
 * the BibTeX emulator, and read \bibitem labels from the resulting .bbl or
 * from a hand-written thebibliography. Pure: no DOM.
 */
import { parse } from '../latex/parser/parser.ts';
import { runBibtex } from '../latex/bibtex/bibtex.ts';
import { keyText, toLatex } from '../latex/ast/to-latex.ts';
import { plainText } from '../latex/document/structure.ts';
import type { CommandNode, EnvironmentNode, Node } from '../latex/ast/nodes.ts';
import type { Diagnostic } from '../latex/diagnostics.ts';
import { parseBibitemLabel } from './natbib.ts';
import type { BibLabel } from './natbib.ts';

export const CITE_COMMANDS = new Set([
  'cite',
  'citet',
  'Citet',
  'citep',
  'Citep',
  'citealt',
  'Citealt',
  'citealp',
  'Citealp',
  'citeauthor',
  'Citeauthor',
  'citefullauthor',
  'citeyear',
  'citeyearpar',
  'citenum',
]);

/** Keys of a cite command's last mandatory argument, comma-separated. */
export function citeKeys(c: CommandNode): string[] {
  const arg = c.args.filter((a) => !a.optional).at(-1);
  return keyText(arg?.children ?? [])
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Visit every node, including command arguments, in document order. */
function walk(nodes: Node[], visit: (n: Node) => void) {
  for (const n of nodes) {
    visit(n);
    if (n.kind === 'command') for (const a of n.args) walk(a.children, visit);
    else if (n.kind === 'group' || n.kind === 'environment') {
      if (n.kind === 'environment')
        for (const a of n.args) walk(a.children, visit);
      walk(n.children, visit);
    }
  }
}

/** The name given to \\bibliographystyle, or undefined. */
export function styleName(scan: CitationScan): string | undefined {
  return scan.style
    ? plainText(scan.style.args.find((a) => !a.optional)?.children ?? []).trim()
    : undefined;
}

export interface CitationScan {
  /** Cited keys in order of first citation (\nocite included, "*" kept). */
  keys: string[];
  style?: CommandNode;
  bibliography?: CommandNode;
  /** Hand-written thebibliography environments in the body. */
  environments: EnvironmentNode[];
}

export function scanCitations(body: Node[]): CitationScan {
  const scan: CitationScan = { keys: [], environments: [] };
  const seen = new Set<string>();
  walk(body, (n) => {
    if (n.kind === 'environment' && n.name === 'thebibliography')
      scan.environments.push(n);
    if (n.kind !== 'command') return;
    if (CITE_COMMANDS.has(n.name) || n.name === 'nocite')
      for (const k of citeKeys(n)) {
        if (seen.has(k.toLowerCase())) continue;
        seen.add(k.toLowerCase());
        scan.keys.push(k);
      }
    else if (n.name === 'bibliographystyle') scan.style ??= n;
    else if (n.name === 'bibliography') scan.bibliography ??= n;
  });
  return scan;
}

/** Options of \usepackage[...]{natbib}, or null when natbib isn't loaded. */
export function natbibPackageOptions(nodes: Node[]): string[] | null {
  for (const n of nodes) {
    if (n.kind === 'environment' && n.name === 'document') break;
    if (n.kind !== 'command' || n.name !== 'usepackage') continue;
    const mandatory = n.args.find((a) => !a.optional);
    const names = plainText(mandatory?.children ?? [])
      .split(',')
      .map((p) => p.trim());
    if (!names.includes('natbib')) continue;
    const optional = n.args.find((a) => a.optional);
    return optional
      ? plainText(optional.children)
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
      : [];
  }
  return null;
}

/**
 * Make a .bbl renderable: drop what precedes \begin{thebibliography}, the
 * \providecommand set-up before the first \bibitem, and \penalty0 (a line
 * break opportunity, which the browser finds by itself).
 */
export function cleanBbl(bbl: string): string {
  const begin = bbl.search(/\\begin\{thebibliography\}\{[^}]*\}/);
  if (begin === -1) return '';
  const head = /^\\begin\{thebibliography\}\{[^}]*\}/.exec(
    bbl.slice(begin)
  )![0];
  const rest = bbl.slice(begin + head.length);
  const first = rest.search(/\\bibitem\b/);
  const body =
    first === -1
      ? rest.replace(/^[\s\S]*?(?=\\end\{thebibliography\})/, '')
      : rest.slice(first);
  return (head + '\n' + body).replace(/\\penalty0 ?/g, '');
}

/** \bibitem labels of a thebibliography environment, by lower-cased key. */
export function bibitemLabels(
  env: EnvironmentNode,
  labels: Map<string, BibLabel>
) {
  let number = 0;
  for (const n of env.children) {
    if (n.kind !== 'command' || n.name !== 'bibitem') continue;
    number++;
    const optional = n.args.find((a) => a.optional);
    const key = keyText(n.args.find((a) => !a.optional)?.children ?? []).trim();
    const label = optional ? toLatex(optional.children) : undefined;
    if (!labels.has(key.toLowerCase()))
      labels.set(key.toLowerCase(), parseBibitemLabel(label, key, number));
  }
}

export interface BibliographyOptions {
  /** The references library: .bib sources by file name (without .bib). */
  bibFiles?: Record<string, string>;
  bstStyles?: Record<string, string>;
}

export interface Bibliography {
  /** The generated thebibliography environment (from the .bbl), if any. */
  environment?: EnvironmentNode;
  labels: Map<string, BibLabel>;
  diagnostics: Diagnostic[];
}

const FALLBACK_STYLE = 'plainnat';

export function buildBibliography(
  scan: CitationScan,
  options: BibliographyOptions
): Bibliography {
  const labels = new Map<string, BibLabel>();
  const diagnostics: Diagnostic[] = [];
  const ref = (
    c: CommandNode,
    code: string,
    message: string,
    severity: Diagnostic['severity'] = 'warning'
  ) =>
    diagnostics.push({
      range: c.range,
      code,
      message,
      severity,
      source: 'ref',
    });

  let environment: EnvironmentNode | undefined;
  const command = scan.bibliography;
  if (command) {
    const styles = options.bstStyles ?? {};
    let style = styleName(scan) ?? '';
    if (!scan.style)
      ref(
        command,
        'ref/missing-bibliography-style',
        `\\bibliography needs a \\bibliographystyle; ${FALLBACK_STYLE} is used.`
      );
    else if (!styles[style])
      ref(
        scan.style,
        'ref/unknown-bibliography-style',
        `The bibliography style "${style}" is not available; ${FALLBACK_STYLE} is used. Available: ${Object.keys(styles).join(', ') || 'none'}.`
      );
    if (!styles[style]) style = FALLBACK_STYLE;
    const names = plainText(
      command.args.find((a) => !a.optional)?.children ?? []
    )
      .split(',')
      .map((n) => n.trim().replace(/\.bib$/, ''))
      .filter(Boolean);
    const files = options.bibFiles ?? {};
    const sources: string[] = [];
    for (const name of names) {
      if (files[name] !== undefined) sources.push(files[name]);
      else
        ref(
          command,
          'ref/missing-bib-file',
          `${name}.bib is not in the references library: import it, or fix the name.`
        );
    }
    const bib = sources.join('\n');
    if (styles[style]) {
      const { bbl, warnings } = runBibtex({
        bst: styles[style],
        bib,
        citations: scan.keys,
      });
      for (const w of warnings)
        if (!/didn't find a database entry/.test(w))
          ref(command, 'ref/bibtex', `BibTeX: ${w}`, 'info');
      const env = parse(cleanBbl(bbl)).root.children.find(
        (n): n is EnvironmentNode =>
          n.kind === 'environment' && n.name === 'thebibliography'
      );
      if (env) {
        environment = env;
        bibitemLabels(env, labels);
      }
    }
  }
  for (const env of scan.environments) bibitemLabels(env, labels);
  return { environment, labels, diagnostics };
}
