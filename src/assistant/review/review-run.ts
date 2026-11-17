/**
 * One paragraph's review (ADR 0025 §3): the paragraph, its neighbours and
 * its threads go to the chat's model with the tools, scoped to that
 * paragraph; the model comments, replies, resolves its own threads and
 * makes zettels; its last line is the summary. Pure: the model, the
 * tools and the threads are passed in.
 */
import { SYSTEM_PROMPT, TOOL_GUIDE } from '../context.ts';
import type { ProviderConfig } from '../providers.ts';
import { runToolLoop, withHint } from '../run-tools.ts';
import type { LoopTools } from '../run-tools.ts';
import type { Thread } from '../../comments/threads.ts';
import { REVIEW_GUIDE, reviewMessage, threadsIn } from './paragraphs.ts';
import type { ReviewJob } from './review-controller.ts';

/** Fixed text, the same for every paragraph, so prompt caches keep it. */
export const REVIEW_SYSTEM = `${SYSTEM_PROMPT}\n\n${TOOL_GUIDE}\n\n${REVIEW_GUIDE}`;

export interface ReviewRunDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The chat's provider and model, with its key. */
  config(): ProviderConfig;
  /** Why the reviewer can't run now (no key, tools off…), or null. */
  problem(): string | null;
  name(): string;
  threads(): Thread[];
  /** The tools, scoped to the paragraph under review. */
  tools(job: ReviewJob): LoopTools;
}

export async function reviewParagraph(
  d: ReviewRunDeps,
  job: ReviewJob,
  signal: AbortSignal
): Promise<string> {
  const problem = d.problem();
  if (problem) throw new Error(problem);
  const content = reviewMessage({
    name: d.name(),
    source: job.source,
    paragraphs: job.paragraphs,
    index: job.index,
    threads: threadsIn(d.threads(), job.paragraphs[job.index]),
  });
  const r = await runToolLoop({
    cfg: d.config(),
    system: REVIEW_SYSTEM,
    history: [{ role: 'user', content }],
    tools: d.tools(job),
    fetch: d.fetch,
    signal,
  });
  if (r.error) throw new Error(withHint(r.error));
  const last = r.history.at(-1);
  const text = last?.role === 'assistant' ? last.content.trim() : '';
  return text.split('\n')[0].trim() || 'Reviewed.';
}
