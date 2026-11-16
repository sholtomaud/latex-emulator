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

/** The system prompt, with the document only when it may be read. */
export function systemPrompt(
  document: { name: string; source: string } | null
): string {
  if (!document) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}

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
