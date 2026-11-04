/**
 * elsarticle.cls (Elsevier's article class), the parts the emulator needs
 * as data: its options and its front matter. Pure: AST in, model out; the
 * renderer lays it out. Line references are to elsarticle.cls 3.4.
 */
import type { EnvironmentNode, Node } from '../ast/nodes.ts';
import { parse } from '../parser/parser.ts';
import { keyText, toLatex } from '../ast/to-latex.ts';
import { parseKeyval } from '../keyval.ts';
import type { Paper, PointSize } from './article.ts';

export interface ElsOptions {
  /** preprint (the default), review (1.5 line spacing), final, 1p, 3p, 5p. */
  mode: 'preprint' | 'review' | 'final' | '1p' | '3p' | '5p';
  size: PointSize;
  paper: Paper;
  /** natbib's options (the class loads it), or null with nonatbib. */
  natbib: string[] | null;
}

/**
 * \ExecuteOptions{a4paper,10pt,oneside,onecolumn,number,preprint,…}, then
 * the options given. a4paper is never declared by the class, so executing
 * it does nothing and article's letterpaper stays unless the document asks.
 */
export function elsOptions(options: string[]): ElsOptions {
  const out: ElsOptions = {
    mode: 'preprint',
    size: 10,
    paper: 'letterpaper',
    natbib: ['numbers'],
  };
  for (const o of options) {
    if (o === '10pt' || o === '11pt' || o === '12pt')
      out.size = Number(o.slice(0, 2)) as PointSize;
    else if (
      o === 'a4paper' ||
      o === 'letterpaper' ||
      o === 'a5paper' ||
      o === 'b5paper' ||
      o === 'legalpaper' ||
      o === 'executivepaper'
    )
      out.paper = o as Paper;
    else if (o === 'authoryear') out.natbib = ['round', 'authoryear'];
    else if (o === 'number' || o === 'numbers') out.natbib = ['numbers'];
    else if (o === 'nonatbib') out.natbib = null;
    else if (
      o === 'preprint' ||
      o === 'review' ||
      o === 'final' ||
      o === '1p' ||
      o === '3p' ||
      o === '5p'
    )
      out.mode = o;
  }
  return out;
}

export interface ElsAuthor {
  name: Node[];
  /** Superscripts in elsarticle's order: affiliations, \fnref, \corref. */
  marks: string[];
}

export interface ElsAddress {
  /** Its letter (\theaffn), or null for an unlabelled address. */
  mark: string | null;
  text: Node[];
}

export interface ElsNote {
  kind: 'tnote' | 'cortext' | 'fntext';
  mark: string;
  text: Node[];
}

export interface ElsFrontmatter {
  title: Node[];
  authors: ElsAuthor[];
  addresses: ElsAddress[];
  /** Title-page notes in \printFirstPageNotes order (e-mails go between). */
  notes: ElsNote[];
  emails: { address: string; author: Node[] }[];
  urls: { address: string; author: Node[] }[];
  abstract?: Node[];
  keywords?: Node[][];
}

/** \cortext: ∗, ∗∗; \tnotetext: ⋆, ⋆⋆ (elsarticle.cls \ifcase lists). */
const STARS = ['∗', '∗∗'];
const TNOTES = ['⋆', '⋆⋆'];

const alph = (n: number) => {
  let s = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26))
    s = String.fromCharCode(97 + ((k - 1) % 26)) + s;
  return s;
};

/** The affiliation keys in the order written, "value," then a space. */
const AFFILIATION_KEYS: Record<string, string> = {
  organization: 'org',
  or: 'org',
  o: 'org',
  addressline: 'org',
  ad: 'org',
  a: 'org',
  city: 'org',
  ci: 'org',
  c: 'org',
  postcode: 'org',
  po: 'org',
  p: 'org',
  state: 'org',
  st: 'org',
  s: 'org',
  country: 'country',
  cy: 'country',
};

/** \affiliation{organization=…, city=…}: elsarticle's punctuation. */
function affiliationText(nodes: Node[]): Node[] {
  const parts: string[] = [];
  for (const [key, value] of parseKeyval(toLatex(nodes))) {
    const kind = AFFILIATION_KEYS[key];
    if (!kind || value === null) continue;
    parts.push(kind === 'country' ? value : `${value},`);
  }
  // \caaffitempostskip is a space; a trailing comma stays when the last
  // item is not the country, as in pdflatex.
  return parse(parts.join(' ')).root.children;
}

const optional = (c: { args: { optional: boolean; children: Node[] }[] }) =>
  c.args.find((a) => a.optional);
const mandatory = (c: { args: { optional: boolean; children: Node[] }[] }) =>
  c.args.filter((a) => !a.optional);
const labels = (nodes: Node[] | undefined) =>
  keyText(nodes ?? [])
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

/** Collect the frontmatter environment's title, authors, notes, abstract… */
export function elsFrontmatter(env: EnvironmentNode): ElsFrontmatter {
  const out: ElsFrontmatter = {
    title: [],
    authors: [],
    addresses: [],
    notes: [],
    emails: [],
    urls: [],
  };
  // First pass, like the .aux: which label gets which letter or number.
  const affLetters = new Map<string, string>();
  const corNumbers = new Map<string, number>();
  const fnNumbers = new Map<string, number>();
  const tNumbers = new Map<string, number>();
  for (const n of env.children) {
    if (n.kind !== 'command') continue;
    const label = labels(optional(n)?.children)[0];
    if ((n.name === 'address' || n.name === 'affiliation') && label)
      affLetters.set(label, alph(affLetters.size + 1));
    else if (n.name === 'cortext' && label)
      corNumbers.set(label, corNumbers.size + 1);
    else if (n.name === 'fntext' && label)
      fnNumbers.set(label, fnNumbers.size + 1);
    else if (n.name === 'tnotetext' && label)
      tNumbers.set(label, tNumbers.size + 1);
  }

  /** Strip \corref/\fnref/\tnoteref from a name, keeping their marks. */
  const marked = (nodes: Node[]) => {
    const fn: string[] = [];
    let cor: string | null = null;
    const kept: Node[] = [];
    for (const n of nodes) {
      if (n.kind === 'command' && n.name === 'corref') {
        const k = corNumbers.get(
          keyText(mandatory(n)[0]?.children ?? []).trim()
        );
        cor = k ? (STARS[k - 1] ?? '') : '';
      } else if (n.kind === 'command' && n.name === 'fnref') {
        for (const l of labels(mandatory(n)[0]?.children))
          fn.push(String(fnNumbers.get(l) ?? 1));
      } else if (n.kind === 'command' && n.name === 'tnoteref') {
        for (const l of labels(mandatory(n)[0]?.children)) {
          const k = tNumbers.get(l);
          if (k) fn.push(TNOTES[k - 1] ?? '');
        }
      } else kept.push(n);
    }
    return { kept, fn, cor };
  };

  let lastAuthor: Node[] = [];
  const emails: { tag: 'email' | 'url'; address: string; author: Node[] }[] =
    [];
  for (const n of env.children) {
    if (n.kind === 'environment') {
      if (n.name === 'abstract') out.abstract = n.children;
      else if (n.name === 'keyword') {
        const groups: Node[][] = [[]];
        for (const c of n.children)
          if (c.kind === 'command' && c.name === 'sep') groups.push([]);
          else groups.at(-1)!.push(c);
        out.keywords = groups;
      }
      continue;
    }
    if (n.kind !== 'command') continue;
    const arg = mandatory(n)[0]?.children ?? [];
    const label = labels(optional(n)?.children)[0];
    switch (n.name) {
      case 'title': {
        const { kept, fn } = marked(arg);
        out.title = fn.length
          ? [
              ...kept,
              ...parse(`\\textsuperscript{${fn.join(',')}}`).root.children,
            ]
          : kept;
        break;
      }
      case 'author': {
        const { kept, fn, cor } = marked(arg);
        const aff = labels(optional(n)?.children).map(
          (l) => affLetters.get(l) ?? '1'
        );
        out.authors.push({
          name: kept,
          marks: [...aff, ...fn, ...(cor ? [cor] : [])],
        });
        lastAuthor = kept;
        break;
      }
      case 'address':
        out.addresses.push({
          mark: label ? affLetters.get(label)! : null,
          text: arg,
        });
        break;
      case 'affiliation':
        out.addresses.push({
          mark: label ? affLetters.get(label)! : null,
          text: affiliationText(arg),
        });
        break;
      case 'ead': {
        const kind = keyText(optional(n)?.children ?? []).trim();
        emails.push({
          tag: kind === 'url' ? 'url' : 'email',
          address: keyText(arg).trim(),
          author: lastAuthor,
        });
        break;
      }
      case 'cortext':
        if (label)
          out.notes.push({
            kind: 'cortext',
            mark: STARS[corNumbers.get(label)! - 1] ?? '',
            text: arg,
          });
        break;
      case 'fntext':
        if (label)
          out.notes.push({
            kind: 'fntext',
            mark: String(fnNumbers.get(label)),
            text: arg,
          });
        break;
      case 'tnotetext':
        if (label)
          out.notes.push({
            kind: 'tnote',
            mark: TNOTES[tNumbers.get(label)! - 1] ?? '',
            text: arg,
          });
        break;
    }
  }
  out.emails = emails
    .filter((e) => e.tag === 'email')
    .map(({ address, author }) => ({ address, author }));
  out.urls = emails
    .filter((e) => e.tag === 'url')
    .map(({ address, author }) => ({ address, author }));
  // \printFirstPageNotes: \tnotes, then \cornotes, (e-mails, URLs,) \fnotes.
  const order = { tnote: 0, cortext: 1, fntext: 2 } as const;
  out.notes.sort((a, b) => order[a.kind] - order[b.kind]);
  return out;
}
