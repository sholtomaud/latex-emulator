import { parse } from '../latex/parser/parser.ts';
import { analyzeDocument, plainText } from '../latex/document/structure.ts';
import type { DocumentStructure } from '../latex/document/structure.ts';
import { articleGeometry, classOptions } from '../latex/classes/article.ts';
import type { ArticleGeometry } from '../latex/classes/article.ts';
import { lookupCommand } from '../latex/commands/registry.ts';
import type {
  ArgNode,
  CommandNode,
  EnvironmentNode,
  MathNode,
  Node,
} from '../latex/ast/nodes.ts';
import type { Diagnostic } from '../latex/diagnostics.ts';
import type { Range } from '../latex/source.ts';
import { h } from './hnode.ts';
import type { HChild, HElement } from './hnode.ts';
import { applyAccent, formatToday, typesetText } from './typeset-text.ts';
import {
  CITE_COMMANDS,
  buildBibliography,
  citeKeys,
  natbibPackageOptions,
  scanCitations,
  styleName,
} from './bibliography.ts';
import type { Bibliography } from './bibliography.ts';
import { formatCitation, natbibOptions } from './natbib.ts';
import type { CitationMode, NatbibOptions } from './natbib.ts';
import { keyText, toLatex } from '../latex/ast/to-latex.ts';
import { alignmentRows, mathToMathML } from '../latex/math/mathml.ts';
import type { AlignmentRow, MathLabel } from '../latex/math/mathml.ts';

export interface RenderOptions {
  /** Date used for \today (defaults to now). */
  today?: Date;
  /** The references library: .bib sources by name, read by \bibliography. */
  bibFiles?: Record<string, string>;
  /** Available .bst styles by name, e.g. { plainnat: '…' }. */
  bstStyles?: Record<string, string>;
}

export interface RenderResult {
  /** <article class="latex-document"> … */
  tree: HElement;
  structure: DocumentStructure;
  geometry: ArticleGeometry;
  /** Parse, structure and render diagnostics, in that order. */
  diagnostics: Diagnostic[];
  /** Plain-text title, e.g. for the PDF file name. */
  title: string;
}

/** Text-font commands → CSS class (or element). */
const TEXT_COMMANDS: Record<string, string> = {
  textbf: 'bf',
  textit: 'it',
  textsl: 'sl',
  textsc: 'sc',
  texttt: 'tt',
  textrm: 'rm',
  textsf: 'sf',
  textup: 'up',
  textmd: 'md',
  textnormal: 'normalfont',
};

/** Declarations → CSS class ('em' becomes an <em> element). */
const DECLARATIONS: Record<string, string> = {
  bfseries: 'bf',
  mdseries: 'md',
  itshape: 'it',
  slshape: 'sl',
  upshape: 'up',
  scshape: 'sc',
  ttfamily: 'tt',
  rmfamily: 'rm',
  sffamily: 'sf',
  normalfont: 'normalfont',
  em: 'em',
  centering: 'centering',
  raggedright: 'raggedright',
  raggedleft: 'raggedleft',
  tiny: 'size-tiny',
  scriptsize: 'size-scriptsize',
  footnotesize: 'size-footnotesize',
  small: 'size-small',
  normalsize: 'size-normalsize',
  large: 'size-large',
  Large: 'size-Large',
  LARGE: 'size-LARGE',
  huge: 'size-huge',
  Huge: 'size-Huge',
};

const SYMBOLS: Record<string, string> = {
  '%': '%',
  $: '$',
  '&': '&',
  '#': '#',
  _: '_',
  '{': '{',
  '}': '}',
  ' ': ' ',
  ',': ' ',
  '-': '­',
  '/': '',
  '@': '',
  ldots: '…',
  dots: '…',
  textellipsis: '…',
  textbackslash: '\\',
  textendash: '–',
  textemdash: '—',
  textbullet: '•',
  textquoteleft: '‘',
  textquoteright: '’',
  textquotedblleft: '“',
  textquotedblright: '”',
  S: '§',
  P: '¶',
  dag: '†',
  ddag: '‡',
  copyright: '©',
  textregistered: '®',
  texttrademark: '™',
  pounds: '£',
  ss: 'ß',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  o: 'ø',
  O: 'Ø',
  aa: 'å',
  AA: 'Å',
  l: 'ł',
  L: 'Ł',
  i: 'ı',
  j: 'ȷ',
};

const SECTIONS: Record<string, { level: number; tag: string }> = {
  section: { level: 1, tag: 'h2' },
  subsection: { level: 2, tag: 'h3' },
  subsubsection: { level: 3, tag: 'h4' },
};
const RUN_IN = new Set(['paragraph', 'subparagraph']);
const BLOCK_COMMANDS = new Set([
  ...Object.keys(SECTIONS),
  ...RUN_IN,
  'maketitle',
  'tableofcontents',
  'bibliography',
  'par',
  'newpage',
  'clearpage',
  'noindent',
]);
const IGNORED = new Set([
  'documentclass',
  'usepackage',
  'title',
  'author',
  'date',
  'indent',
  'item',
  'thanks',
  'and',
  'bibliographystyle',
  'nocite',
  'bibitem',
]);

const ITEMIZE_LABELS = ['•', '–', '∗', '·'];
const LIST_TAGS: Record<string, string> = {
  itemize: 'ul',
  enumerate: 'ol',
  description: 'ul',
};
const MATH_ENVS = new Set([
  'equation',
  'equation*',
  'displaymath',
  'math',
  'align',
  'align*',
  'gather',
  'gather*',
  'multline',
  'multline*',
]);
/** Most cells in one display row the CSS grid supports (cols-1 … cols-8). */
const MAX_CELLS = 8;

/** A \section entry for \tableofcontents (collected in the first pass). */
interface TocEntry {
  level: number;
  number: string;
  title: HChild[];
}

/** What the first pass learnt, like LaTeX's .aux file. */
interface Aux {
  labels: Map<string, string>;
  toc: TocEntry[];
}

interface Context {
  typewriter: boolean;
  listDepth: { itemize: number; enumerate: number; total: number };
}

/** Where we are relative to the previous block, for LaTeX's indentation rules. */
type After = 'start' | 'heading' | 'block' | 'par';

export function renderDocument(
  src: string,
  options: RenderOptions = {}
): RenderResult {
  const parsed = parse(src);
  const structure = analyzeDocument(parsed.root);
  const geometry = articleGeometry(
    classOptions(structure.documentClass?.options ?? [])
  );
  const natbib = natbibPackageOptions(parsed.root.children);
  const scan = scanCitations(structure.body);
  const docEnv = parsed.root.children.find(
    (n) => n.kind === 'environment' && n.name === 'document'
  );
  const bibliography = buildBibliography(scan, {
    ...options,
    // \end{document} is the last 14 characters of the environment.
    endOfDocument: docEnv
      ? docEnv.range.end - '\\end{document}'.length
      : undefined,
  });
  const punctuation = natbibOptions(natbib ?? [], styleName(scan));
  // natbib switches the whole document to numerical citations as soon as one
  // \bibitem has no author–year label.
  if ([...bibliography.labels.values()].some((l) => l.numeric))
    punctuation.numbers = true;
  const citations: Citations = {
    bibliography,
    mode: natbib ? 'natbib' : 'classic',
    natbib: punctuation,
  };
  const today = options.today ?? new Date();
  // Two passes, like LaTeX and its .aux file: the first learns where every
  // \label points and what the table of contents holds; the second renders
  // with them (forward references included). Only its diagnostics count.
  const first = new Renderer(structure, today, citations, {
    labels: new Map(),
    toc: [],
  });
  first.renderBlocks(structure.body, first.rootContext());
  const renderer = new Renderer(structure, today, citations, {
    labels: first.labelsOut,
    toc: first.tocOut,
  });
  const blocks = renderer.renderBlocks(structure.body, renderer.rootContext());
  if (renderer.footnotes.length)
    blocks.push(h('section', { class: 'footnotes' }, renderer.footnotes));
  return {
    tree: h('article', { class: 'latex-document' }, blocks),
    structure,
    geometry,
    diagnostics: [
      ...parsed.diagnostics,
      ...structure.diagnostics,
      ...bibliography.diagnostics,
      ...renderer.diagnostics,
    ],
    title: plainText(structure.metadata.title ?? []).trim(),
  };
}

interface Citations {
  bibliography: Bibliography;
  mode: CitationMode;
  natbib: NatbibOptions;
}

class Renderer {
  structure: DocumentStructure;
  today: Date;
  citations: Citations;
  diagnostics: Diagnostic[] = [];
  footnotes: HElement[] = [];
  aux: Aux;
  /** Labels defined in this pass (the first wins, as in LaTeX). */
  labelsOut = new Map<string, string>();
  tocOut: TocEntry[] = [];
  /** What \label refers to here: LaTeX's \@currentlabel. */
  currentRef = '';
  counters = {
    section: 0,
    subsection: 0,
    subsubsection: 0,
    footnote: 0,
    equation: 0,
  };

  constructor(
    structure: DocumentStructure,
    today: Date,
    citations: Citations,
    aux: Aux
  ) {
    this.structure = structure;
    this.today = today;
    this.citations = citations;
    this.aux = aux;
  }

  /** \label{key} at the current counter. */
  defineLabel(key: string, range: Range) {
    if (this.labelsOut.has(key)) {
      this.warn(
        range,
        'ref/duplicate-label',
        `Label "${key}" is defined more than once; references use the first.`,
        'warning',
        'ref'
      );
      return;
    }
    this.labelsOut.set(key, this.currentRef);
  }

  rootContext(): Context {
    return {
      typewriter: false,
      listDepth: { itemize: 0, enumerate: 0, total: 0 },
    };
  }

  warn(
    range: Range,
    code: string,
    message: string,
    severity: Diagnostic['severity'] = 'warning',
    source: Diagnostic['source'] = 'syntax'
  ) {
    this.diagnostics.push({ range, code, message, severity, source });
  }

  // ------------------------------------------------------------ blocks

  isBlock(n: Node): boolean {
    switch (n.kind) {
      case 'parbreak':
      case 'environment':
      case 'verbatim':
        return true;
      case 'math':
        return n.display;
      case 'command':
        return BLOCK_COMMANDS.has(n.name);
      case 'group':
        return n.children.some((c) => this.isBlock(c));
      default:
        return false;
    }
  }

  /**
   * Render a list of nodes in vertical mode: paragraphs and block elements.
   * `after` carries the indentation state in from the caller.
   */
  renderBlocks(
    nodes: Node[],
    ctx: Context,
    after: After = 'start'
  ): HElement[] {
    const blocks: HElement[] = [];
    let inline: HChild[] = [];
    let noindent = false;
    let runIn: HElement | undefined;

    const flush = () => {
      const content = tidy(inline);
      inline = [];
      if (!content.length && !runIn) return;
      const children = runIn ? [runIn, ...content] : content;
      const unindented = noindent || after === 'heading' || after === 'block';
      const cls = runIn ? 'runin' : unindented ? 'noindent' : '';
      blocks.push(h('p', cls ? { class: cls } : {}, children));
      noindent = false;
      runIn = undefined;
      after = 'par';
    };

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];

      if (n.kind === 'command' && DECLARATIONS[n.name] !== undefined) {
        // Applies to the rest of this list: the current paragraph's remainder
        // inline, then any following blocks wrapped in a block element.
        const cls = DECLARATIONS[n.name];
        const rest = nodes.slice(i + 1);
        const breakAt = rest.findIndex((r) => this.isBlock(r));
        const inlinePart = breakAt === -1 ? rest : rest.slice(0, breakAt);
        const blockPart = breakAt === -1 ? [] : rest.slice(breakAt);
        const inlineContent = tidy(this.renderInline(inlinePart, ctx));
        if (inlineContent.length) inline.push(wrap(cls, inlineContent));
        if (blockPart.length) {
          const pending = tidy(inline).length > 0;
          flush();
          const inner = this.renderBlocks(
            blockPart,
            ctx,
            pending ? 'par' : after
          );
          blocks.push(
            h(
              cls === 'em' ? 'div' : 'div',
              { class: cls === 'em' ? 'em' : cls },
              inner
            )
          );
        }
        break;
      }

      if (!this.isBlock(n)) {
        inline.push(...this.renderInline([n], ctx));
        continue;
      }

      switch (n.kind) {
        case 'parbreak':
          flush();
          if (after !== 'heading') after = 'par';
          continue;
        case 'group':
          flush();
          blocks.push(...this.renderBlocks(n.children, ctx, after));
          after = 'block';
          continue;
        case 'verbatim':
          flush();
          blocks.push(h('pre', { class: 'verbatim' }, [n.value]));
          after = 'block';
          continue;
        case 'math':
          flush();
          blocks.push(
            this.renderDisplay('displaymath', [
              { cells: [n.children], labels: [], numbered: false },
            ])
          );
          after = 'block';
          continue;
        case 'environment': {
          // Started in vertical mode (after a blank line, at the start, or right
          // after another environment): LaTeX adds \partopsep.
          const vertical = tidy(inline).length === 0;
          flush();
          blocks.push(...this.renderEnvironment(n, ctx, vertical));
          after = 'block';
          continue;
        }
        case 'command':
          break;
        default:
          continue;
      }

      // Block-level commands.
      const c = n as CommandNode;
      switch (c.name) {
        case 'par':
          flush();
          break;
        case 'noindent':
          flush();
          noindent = true;
          break;
        case 'newpage':
        case 'clearpage':
          flush();
          blocks.push(h('div', { class: 'pagebreak' }));
          // \newpage only ends the paragraph: the next one is indented.
          after = 'par';
          break;
        case 'maketitle':
          flush();
          blocks.push(this.renderTitle(c, ctx));
          after = 'par';
          break;
        case 'tableofcontents':
          flush();
          blocks.push(...this.renderToc(c));
          after = 'block';
          break;
        case 'bibliography': {
          flush();
          const env = this.citations.bibliography.environment;
          if (env) {
            // Nodes from the generated .bbl have ranges in another source:
            // keep render diagnostics from them out of the editor.
            const count = this.diagnostics.length;
            blocks.push(...this.renderBibliography(env, ctx));
            this.diagnostics.length = count;
          }
          after = 'block';
          break;
        }
        default:
          if (RUN_IN.has(c.name)) {
            flush();
            runIn = h(
              'span',
              { class: 'runin-heading' },
              tidy(this.renderArg(lastMandatory(c), ctx))
            );
            // Spaces after a run-in heading are skipped.
            while (nodes[i + 1]?.kind === 'space') i++;
          } else {
            flush();
            blocks.push(this.renderSection(c, ctx));
            after = 'heading';
          }
      }
    }
    flush();
    return blocks;
  }

  renderSection(c: CommandNode, ctx: Context): HElement {
    const { level, tag } = SECTIONS[c.name];
    const title = tidy(this.renderArg(lastMandatory(c), ctx));
    if (c.star) return h(tag, { class: c.name }, title);
    if (level === 1) {
      this.counters.section++;
      this.counters.subsection = 0;
      this.counters.subsubsection = 0;
    } else if (level === 2) {
      this.counters.subsection++;
      this.counters.subsubsection = 0;
    } else this.counters.subsubsection++;
    const { section, subsection, subsubsection } = this.counters;
    const number = [section, subsection, subsubsection]
      .slice(0, level)
      .join('.');
    this.currentRef = number;
    this.tocOut.push({ level, number, title });
    return h(tag, { class: c.name }, [
      h('span', { class: 'secnum' }, [number]),
      ...title,
    ]);
  }

  renderTitle(c: CommandNode, ctx: Context): HElement {
    const { title, author, date } = this.structure.metadata;
    if (!title)
      this.warn(
        c.range,
        'syntax/no-title',
        '\\maketitle needs a \\title first.',
        'error'
      );
    const authors: HChild[][] = [[]];
    for (const n of author ?? []) {
      if (n.kind === 'command' && n.name === 'and') authors.push([]);
      else authors.at(-1)!.push(...this.renderInline([n], ctx));
    }
    const dateContent = date
      ? this.renderInline(date, ctx)
      : [formatToday(this.today)];
    return h('header', { class: 'maketitle' }, [
      h('div', { class: 'title' }, tidy(this.renderInline(title ?? [], ctx))),
      h(
        'div',
        { class: 'authors' },
        authors.map((a) => h('span', { class: 'author' }, tidy(a)))
      ),
      h('div', { class: 'date' }, tidy(dateContent)),
    ]);
  }

  renderEnvironment(
    env: EnvironmentNode,
    ctx: Context,
    vertical = false
  ): HElement[] {
    const cls = vertical ? `${env.name} vmode` : env.name;
    if (LIST_TAGS[env.name]) return [this.renderList(env, ctx, cls)];
    if (MATH_ENVS.has(env.name)) return [this.renderMathEnvironment(env)];
    const body = () => this.renderBlocks(env.children, ctx);
    switch (env.name) {
      case 'document':
        return body();
      case 'center':
      case 'flushleft':
      case 'flushright':
        return [h('div', { class: cls }, body())];
      case 'quote':
      case 'quotation':
        return [h('blockquote', { class: cls }, body())];
      case 'thebibliography':
        return this.renderBibliography(env, ctx);
      case 'abstract':
        return [
          h('div', { class: 'abstract' }, [
            h('div', { class: 'abstract-title' }, ['Abstract']),
            h('div', { class: 'abstract-body' }, body()),
          ]),
        ];
      default:
        return [
          h(
            'div',
            { class: 'unknown-environment', 'data-env': env.name },
            body()
          ),
        ];
    }
  }

  /**
   * thebibliography: \section*{\refname} and a list of entries with a
   * hanging indent (natbib: \bibhang = 1em). Author–year entries have no
   * visible label; numbered ones print [n] like LaTeX's \@biblabel.
   */
  renderBibliography(env: EnvironmentNode, ctx: Context): HElement[] {
    const { mode, natbib, bibliography } = this.citations;
    const items: { item: CommandNode; body: Node[] }[] = [];
    for (const n of env.children) {
      if (n.kind === 'command' && n.name === 'bibitem')
        items.push({ item: n, body: [] });
      else if (items.length) items.at(-1)!.body.push(n);
    }
    let number = 0;
    const lis = items.map(({ item, body }) => {
      number++;
      const key = citeKeys(item)[0] ?? '';
      const label = bibliography.labels.get(key.toLowerCase());
      const shown =
        mode === 'classic'
          ? (label?.text ?? String(number))
          : natbib.numbers
            ? label?.numeric
              ? label.short
              : String(number)
            : null;
      const blocks = this.renderBlocks(body, ctx, 'block').map((b) =>
        b.tag === 'p' ? h('p', {}, b.children) : b
      );
      if (shown !== null) {
        const labelNode = h('span', { class: 'item-label' }, [`[${shown}]`]);
        if (blocks[0]?.tag === 'p')
          blocks[0] = h('p', {}, [labelNode, ...blocks[0].children]);
        else blocks.unshift(h('p', {}, [labelNode]));
      }
      return h('li', {}, blocks);
    });
    // Author–year: natbib's \bibhang. Numbered: \labelwidth is the width
    // of \@biblabel{#1}, which the CSS computes from #1's length.
    const widest = keyText(env.args.find((a) => !a.optional)?.children ?? []);
    const cls =
      mode === 'natbib' && !natbib.numbers
        ? 'thebibliography vmode authoryear'
        : `thebibliography vmode labels-${Math.min(Math.max(widest.trim().length, 1), 6)}`;
    return [
      h('h2', { class: 'section' }, ['References']),
      h('ul', { class: cls }, lis),
    ];
  }

  /** A citation command, built as LaTeX by the natbib formatter and rendered. */
  renderCitation(c: CommandNode, ctx: Context): HChild[] {
    const { mode, natbib, bibliography } = this.citations;
    const result = formatCitation(
      {
        command: c.name,
        star: c.star,
        notes: c.args.filter((a) => a.optional).map((a) => toLatex(a.children)),
        keys: citeKeys(c),
      },
      bibliography.labels,
      mode,
      natbib
    );
    for (const key of result.undefinedKeys) {
      const { message, fixes } = bibliography.explain(key);
      this.warn(c.range, 'ref/undefined-citation', message, 'warning', 'ref');
      if (fixes) this.diagnostics[this.diagnostics.length - 1].fixes = fixes;
    }
    return this.renderInline(parse(result.latex).root.children, ctx);
  }

  renderList(env: EnvironmentNode, ctx: Context, cls: string): HElement {
    const kind = env.name as 'itemize' | 'enumerate' | 'description';
    const depth = { ...ctx.listDepth, total: ctx.listDepth.total + 1 };
    if (kind === 'itemize') depth.itemize++;
    if (kind === 'enumerate') depth.enumerate++;
    const inner: Context = { ...ctx, listDepth: depth };

    // Split the body at \item.
    const items: { item: CommandNode; body: Node[] }[] = [];
    for (const n of env.children) {
      if (n.kind === 'command' && n.name === 'item')
        items.push({ item: n, body: [] });
      else if (items.length) items.at(-1)!.body.push(n);
      else if (
        n.kind !== 'space' &&
        n.kind !== 'comment' &&
        n.kind !== 'parbreak'
      )
        this.warn(
          n.range,
          'syntax/missing-item',
          `Text in ${env.name} before the first \\item is not shown.`
        );
    }

    let counter = 0;
    const lis = items.map(({ item, body }) => {
      const custom = item.args.find((a) => a.optional);
      let label: HChild[];
      if (custom) label = tidy(this.renderInline(custom.children, inner));
      else if (kind === 'itemize')
        label = [ITEMIZE_LABELS[Math.min(depth.itemize, 4) - 1]];
      else if (kind === 'enumerate') {
        label = [enumerateLabel(depth.enumerate, ++counter)];
        // \theenumi is 1, \theenumii is a, with \p@enumii = \theenumi: "1a".
        this.currentRef =
          depth.enumerate === 1
            ? String(counter)
            : `${this.currentRef.replace(/[a-z]+$/, '')}${String.fromCharCode(96 + counter)}`;
      } else label = [];
      const labelNode = h('span', { class: 'item-label' }, label);
      const blocks = this.renderBlocks(body, inner, 'block');
      // The label starts the first paragraph (LaTeX sets it in the first line).
      if (blocks[0]?.tag === 'p') {
        blocks[0] = h('p', {}, [labelNode, ...blocks[0].children]);
        for (let i = 1; i < blocks.length; i++)
          if (blocks[i].tag === 'p') blocks[i] = h('p', {}, blocks[i].children);
      } else blocks.unshift(h('p', {}, [labelNode]));
      return h('li', {}, blocks);
    });
    return h(LIST_TAGS[kind], { class: cls }, lis);
  }

  // ------------------------------------------------------------ inline

  renderInline(nodes: Node[], ctx: Context): HChild[] {
    const out: HChild[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      switch (n.kind) {
        case 'text':
          out.push(typesetText(n.value, { typewriter: ctx.typewriter }));
          break;
        case 'space':
        case 'parbreak':
          out.push(' ');
          break;
        case 'comment':
          break;
        case 'special':
          out.push(n.char === '~' ? ' ' : n.char);
          break;
        case 'verb':
          out.push(h('code', { class: 'verb' }, [n.value]));
          break;
        case 'verbatim':
          out.push(h('code', { class: 'verb' }, [n.value]));
          break;
        case 'math':
          out.push(this.inlineMath(n));
          break;
        case 'group':
          out.push(...this.renderInline(n.children, ctx));
          break;
        case 'environment':
          out.push(...this.renderInline(n.children, ctx));
          break;
        case 'command': {
          const cls = DECLARATIONS[n.name];
          if (cls !== undefined) {
            const rest = this.renderInline(
              nodes.slice(i + 1),
              withFont(ctx, cls)
            );
            out.push(
              wrap(cls, tidy(rest, { trimStart: true, trimEnd: false }))
            );
            return out;
          }
          out.push(...this.renderCommand(n, ctx));
        }
      }
    }
    return out;
  }

  renderArg(arg: ArgNode | undefined, ctx: Context): HChild[] {
    return arg ? this.renderInline(arg.children, ctx) : [];
  }

  renderCommand(c: CommandNode, ctx: Context): HChild[] {
    const arg = () => this.renderArg(lastMandatory(c), ctx);
    if (c.name in SYMBOLS) return [SYMBOLS[c.name]];
    if (c.name in TEXT_COMMANDS) {
      const cls = TEXT_COMMANDS[c.name];
      return [
        h(
          'span',
          { class: cls },
          this.renderArg(lastMandatory(c), withFont(ctx, cls))
        ),
      ];
    }
    if (CITE_COMMANDS.has(c.name)) return this.renderCitation(c, ctx);
    const spec = lookupCommand(c.name);
    if (spec?.kind === 'accent')
      return [
        applyAccent(
          c.name,
          plainText(lastMandatory(c)?.children ?? []).replace(/\\/g, '')
        ) || '',
      ];
    switch (c.name) {
      case 'emph':
        return [h('em', {}, arg())];
      case 'underline':
        return [h('u', {}, arg())];
      case '\\':
      case 'newline':
        return [h('br')];
      case 'today':
        return [formatToday(this.today)];
      case 'newblock':
        // natbib: \hskip .11em plus .33em minus .07em, after the line's space.
        return [h('span', { class: 'newblock' })];
      case 'url':
        return [
          h('span', { class: 'tt' }, [
            keyText(lastMandatory(c)?.children ?? []),
          ]),
        ];
      case 'doi':
        return ['doi: ', ...arg()];
      case 'TeX':
        return [
          h('span', { class: 'logo-tex' }, [
            'T',
            h('span', { class: 'logo-e' }, ['E']),
            'X',
          ]),
        ];
      case 'LaTeX':
        return [
          h('span', { class: 'logo-latex' }, [
            'L',
            h('span', { class: 'logo-a' }, ['A']),
            'T',
            h('span', { class: 'logo-e' }, ['E']),
            'X',
          ]),
        ];
      case 'footnote': {
        const custom = c.args.find((a) => a.optional);
        const number = custom
          ? plainText(custom.children).trim()
          : String(++this.counters.footnote);
        // A \label inside the footnote refers to its number.
        const outer = this.currentRef;
        this.currentRef = number;
        this.footnotes.push(
          h('p', {}, [
            h('sup', { class: 'footnote-mark' }, [number]),
            ...tidy(arg()),
          ])
        );
        this.currentRef = outer;
        return [h('sup', { class: 'footnote-mark' }, [number])];
      }
      case 'label':
        this.defineLabel(
          keyText(lastMandatory(c)?.children ?? []).trim(),
          c.range
        );
        return [];
      case 'ref':
      case 'eqref': {
        const key = keyText(lastMandatory(c)?.children ?? []).trim();
        const value = this.aux.labels.get(key);
        if (value === undefined) {
          this.warn(
            c.range,
            'ref/undefined-reference',
            `Reference "${key}" is undefined: no \\label{${key}} in this document.`,
            'warning',
            'ref'
          );
          return [h('span', { class: 'unresolved' }, ['??'])];
        }
        // amsmath: \eqref is \textup{(\ref{…})}.
        return c.name === 'eqref'
          ? [h('span', { class: 'up' }, [`(${value})`])]
          : [value];
      }
      case 'pageref':
        this.warn(
          c.range,
          'ref/pageref',
          'Page numbers are only known in the printed PDF: \\pageref shows ??.',
          'info',
          'ref'
        );
        return [h('span', { class: 'unresolved' }, ['??'])];
    }
    if (IGNORED.has(c.name) || BLOCK_COMMANDS.has(c.name)) return [];
    // Unknown: keep the content of its mandatory arguments.
    return c.args
      .filter((a) => !a.optional)
      .flatMap((a) => this.renderInline(a.children, ctx));
  }

  inlineMath(m: MathNode): HElement {
    const r = mathToMathML(m.children, { display: false });
    this.diagnostics.push(...r.diagnostics);
    for (const l of r.labels) this.defineLabel(l.key, l.range);
    return r.math;
  }

  /** equation, align, gather, multline and their starred forms. */
  renderMathEnvironment(env: EnvironmentNode): HElement {
    const name = env.name.replace(/\*$/, '');
    const starred =
      env.name.endsWith('*') || name === 'displaymath' || name === 'math';
    if (name === 'equation' || name === 'displaymath' || name === 'math')
      return this.renderDisplay(name, [
        { cells: [env.children], labels: [], numbered: !starred },
      ]);
    const rows = alignmentRows(env.children).map((r) => ({
      ...r,
      numbered: r.numbered && !starred,
    }));
    if (name === 'align') return this.renderDisplay(name, rows);
    // gather and multline: one centred cell per row (an & is ignored).
    const single = rows.map((r) => ({ ...r, cells: [r.cells.flat()] }));
    if (name === 'multline')
      // One number, on the last line.
      single.forEach(
        (r, i) =>
          (r.numbered = r.numbered && i === single.length - 1 && !starred)
      );
    return this.renderDisplay(name, single);
  }

  /**
   * A displayed equation as a CSS grid: one column per cell (so & columns
   * line up across rows), centred between two flexible columns, with the
   * number at the right margin on its row's baseline.
   */
  renderDisplay(kind: string, rows: AlignmentRow[]): HElement {
    const cols = Math.min(
      Math.max(...rows.map((r) => r.cells.length), 1),
      MAX_CELLS
    );
    const rowEls = rows.map((row, i) => {
      const labels: MathLabel[] = [...row.labels];
      let nonumber = false;
      let tag = row.tag;
      const cells = row.cells.slice(0, MAX_CELLS).map((cell, j) => {
        const r = mathToMathML(cell, { display: true });
        this.diagnostics.push(...r.diagnostics);
        labels.push(...r.labels);
        nonumber ||= r.nonumber;
        tag ??= r.tag;
        const position =
          kind === 'multline' && rows.length > 1
            ? i === 0
              ? ' first'
              : i === rows.length - 1
                ? ' last'
                : ''
            : '';
        return h('div', { class: `math-cell c${j + 1}${position}` }, [r.math]);
      });
      const children: HChild[] = [...cells];
      if (tag !== undefined) {
        this.currentRef = tag;
        children.push(h('span', { class: 'eqno' }, [`(${tag})`]));
      } else if (row.numbered && !nonumber) {
        this.currentRef = String(++this.counters.equation);
        children.push(h('span', { class: 'eqno' }, [`(${this.currentRef})`]));
      }
      for (const l of labels) this.defineLabel(l.key, l.range);
      return h('div', { class: 'math-row' }, children);
    });
    const cls = ['math-display', `cols-${cols}`];
    if (kind === 'gather' || kind === 'multline') cls.push(kind);
    return h('div', { class: cls.join(' ') }, rowEls);
  }

  /** \tableofcontents: \section*{\contentsname} and the first pass's entries. */
  renderToc(c: CommandNode): HElement[] {
    this.warn(
      c.range,
      'ref/toc-pages',
      'Page numbers are only known in the printed PDF: the contents show ??.',
      'info',
      'ref'
    );
    const levels = ['', 'section', 'subsection', 'subsubsection'];
    return [
      h('h2', { class: 'section' }, ['Contents']),
      h(
        'div',
        { class: 'toc' },
        this.aux.toc.map((e) =>
          h('p', { class: `toc-${levels[e.level]}` }, [
            h('span', { class: 'toc-num' }, [e.number]),
            ...e.title,
            // article.cls: sections have no dot leaders (\l@section).
            ...(e.level > 1 ? [h('span', { class: 'toc-leaders' })] : []),
            h('span', { class: 'toc-page' }, ['??']),
          ])
        )
      ),
    ];
  }
}

// ------------------------------------------------------------ helpers

function lastMandatory(c: CommandNode): ArgNode | undefined {
  return c.args.filter((a) => !a.optional).at(-1);
}

function withFont(ctx: Context, cls: string): Context {
  return cls === 'tt'
    ? { ...ctx, typewriter: true }
    : cls === 'rm' || cls === 'sf' || cls === 'normalfont'
      ? { ...ctx, typewriter: false }
      : ctx;
}

function wrap(cls: string, children: HChild[]): HElement {
  return cls === 'em'
    ? h('em', {}, children)
    : h('span', { class: cls }, children);
}

function enumerateLabel(depth: number, n: number): string {
  switch (depth) {
    case 1:
      return `${n}.`;
    case 2:
      return `(${String.fromCharCode(96 + n)})`;
    case 3:
      return `${toRoman(n)}.`;
    default:
      return `${String.fromCharCode(64 + n)}.`;
  }
}

function toRoman(n: number): string {
  const table: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let out = '';
  for (const [value, numeral] of table)
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  return out;
}

/**
 * Normalise inline content: merge adjacent strings, collapse whitespace runs
 * (non-breaking spaces are kept), and trim the ends.
 */
function tidy(
  children: HChild[],
  { trimStart = true, trimEnd = true } = {}
): HChild[] {
  const merged: HChild[] = [];
  for (const c of children) {
    const prev = merged.at(-1);
    if (typeof c === 'string' && typeof prev === 'string')
      merged[merged.length - 1] = prev + c;
    else if (c !== '') merged.push(c);
  }
  const out = merged.map((c) =>
    typeof c === 'string' ? c.replace(/[ \t\r\n]+/g, ' ') : c
  );
  if (trimStart && typeof out[0] === 'string')
    out[0] = (out[0] as string).replace(/^ +/, '');
  if (trimEnd && typeof out.at(-1) === 'string')
    out[out.length - 1] = (out.at(-1) as string).replace(/ +$/, '');
  // Collapse spaces across element boundaries: "a <br> b" → "a<br>b" is CSS's job,
  // but a space before a <br> is never wanted.
  for (let i = 0; i < out.length - 1; i++) {
    const next = out[i + 1];
    if (
      typeof out[i] === 'string' &&
      typeof next !== 'string' &&
      next.tag === 'br'
    )
      out[i] = (out[i] as string).replace(/ +$/, '');
    if (
      typeof next === 'string' &&
      typeof out[i] !== 'string' &&
      (out[i] as HElement).tag === 'br'
    )
      out[i + 1] = next.replace(/^ +/, '');
  }
  return out.filter((c) => c !== '');
}
