/**
 * What the assistant tells the model, and its remembered settings. Pure.
 *
 * The document is sent only for documents the user has allowed (per
 * document, ADR 0023 §3). The fixed instructions come first and never
 * change, so prompt caches (llama.cpp's, Anthropic's) can reuse them.
 */
import { PROVIDER_IDS, PROVIDERS, baseUrlProblem } from './providers.ts';
import type { ProviderId } from './providers.ts';

export const SYSTEM_PROMPT = `You are a writing assistant inside a LaTeX editor. The author writes standard LaTeX that must compile with pdflatex and the CTAN packages it loads.

- Answer about the author's document, LaTeX and academic writing.
- When you suggest LaTeX, give it in a fenced code block, ready to paste, and use only commands from standard packages.
- Quote the author's own words exactly when you refer to them.
- Don't invent citations, references or results. Say when you are unsure.
- Be brief unless asked for more.`;

const attr = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * What the model is told about its tools (ADR 0025), when it has them.
 * Fixed text, after the fixed instructions, so prompt caches keep both.
 */
export const TOOL_GUIDE = `You have tools; use them rather than telling the author to do things by hand.

- The document: document_read (only where the author allowed it). Comments: comments_list, comment_add (on an exact quote), comment_reply, comment_resolve (only threads you opened).
- Zotero: search_items and get_item for references; zettel_list, zettel_search and zettel_get to see the Zettelkasten; zettel_create, zettel_update, zettel_link and zettel_tag to change it.
- A zettel holds one claim of the author's own, not a source's: a declarative title, a short body in the author's words, linked to the sources it draws on (find them with search_items, by citation key or title). Search the Zettelkasten first so you don't repeat a zettel. New zettels are tagged zk/inbox for the author to accept.`;

/** The system prompt: the tool guide if tools are on, the document if allowed. */
export function systemPrompt(
  document: { name: string; source: string } | null,
  tools = false
): string {
  const head = tools ? `${SYSTEM_PROMPT}\n\n${TOOL_GUIDE}` : SYSTEM_PROMPT;
  if (!document) return head;
  return `${head}

The author's current document:

<document name="${attr(document.name)}">
${document.source}
</document>`;
}

export interface AssistantSettings {
  /** The provider the chat uses. */
  provider: ProviderId;
  /** The chosen model, per provider ('' or missing: the default). */
  models: Partial<Record<ProviderId, string>>;
  localBaseUrl: string;
  /** Documents the assistant may read (ids). */
  readDocuments: string[];
  /** Providers whose models get no tools (a local model without them). */
  toolsOff: ProviderId[];
}

/** The remembered `assistant-settings` preference, with safe defaults. */
export function parseAssistantSettings(text: string | null): AssistantSettings {
  let json: unknown = null;
  try {
    json = JSON.parse(text ?? 'null');
  } catch {
    // Use the defaults.
  }
  const o = (typeof json === 'object' && json ? json : {}) as Record<
    string,
    unknown
  >;
  const models: Partial<Record<ProviderId, string>> = {};
  if (typeof o.models === 'object' && o.models && !Array.isArray(o.models))
    for (const id of PROVIDER_IDS) {
      const m = (o.models as Record<string, unknown>)[id];
      if (typeof m === 'string') models[id] = m;
    }
  const url = typeof o.localBaseUrl === 'string' ? o.localBaseUrl : '';
  return {
    provider: PROVIDER_IDS.find((id) => id === o.provider) ?? 'anthropic',
    models,
    localBaseUrl:
      url && !baseUrlProblem('local', url) ? url : PROVIDERS.local.baseUrl,
    readDocuments: Array.isArray(o.readDocuments)
      ? o.readDocuments.filter((d): d is string => typeof d === 'string')
      : [],
    toolsOff: Array.isArray(o.toolsOff)
      ? PROVIDER_IDS.filter((id) => (o.toolsOff as unknown[]).includes(id))
      : [],
  };
}

/** Lines selected in the editor, to ask about. */
export interface Excerpt {
  text: string;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
}

export const excerptLabel = ({ startLine, endLine }: Excerpt) =>
  startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;

/**
 * A question about selected lines: the lines first, quoted as LaTeX in a
 * fence longer than any run of backticks inside them, then the question.
 */
export function withExcerpt(question: string, excerpt: Excerpt): string {
  const longest = Math.max(
    2,
    ...(excerpt.text.match(/`+/g) ?? []).map((run) => run.length)
  );
  const fence = '`'.repeat(longest + 1);
  return `About ${excerptLabel(excerpt)} of my document:

${fence}latex
${excerpt.text.replace(/\r?\n$/, '')}
${fence}

${question}`;
}
