/**
 * The assistant's chat (ADR 0023): which provider and model, whether the
 * open document may be read, the conversation per document, and sending
 * with a streamed reply. Everything it touches outside itself (fetch,
 * storage, preferences, keys) is passed in, so it is tested in Node; the
 * browser wiring is `assistant-service.ts`.
 */
import { Store } from '../core/store.ts';
import { fetchModels, streamChat, streamReply } from './chat-client.ts';
import {
  parseAssistantSettings,
  systemPrompt,
  withExcerpt,
} from './context.ts';
import type { AssistantSettings, Excerpt } from './context.ts';
import type { KeyStore } from './key-store.ts';
import {
  PROVIDERS,
  baseUrlProblem,
  buildChatRequest,
  buildModelsRequest,
} from './providers.ts';
import type {
  ChatMessage,
  ProviderConfig,
  ProviderId,
  ToolCall,
  ToolDef,
} from './providers.ts';

/** Where conversations are kept, per document. */
export interface ChatStore {
  get(documentId: string): Promise<ChatMessage[] | undefined>;
  put(documentId: string, messages: ChatMessage[]): Promise<void>;
  delete(documentId: string): Promise<void>;
}

export class MemoryChats implements ChatStore {
  private chats = new Map<string, ChatMessage[]>();
  async get(id: string) {
    return this.chats.get(id);
  }
  async put(id: string, messages: ChatMessage[]) {
    this.chats.set(id, messages);
  }
  async delete(id: string) {
    this.chats.delete(id);
  }
}

export interface AssistantDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  chats: ChatStore;
  keys: KeyStore;
  readPref: (key: string) => string | null;
  writePref: (key: string, value: string) => void;
  /** The tools the model may call (ADR 0025); none if left out. */
  tools?: {
    definitions(): ToolDef[];
    run(call: ToolCall): Promise<{ content: string; isError?: true }>;
  };
}

/** Rounds of tool calls in one answer, at most. */
const MAX_ROUNDS = 10;

/** Every tool call answered, as Claude's API requires of a conversation. */
function answerOpenCalls(history: ChatMessage[], why: string): ChatMessage[] {
  const out = [...history];
  for (let i = out.length - 1; i >= 0; i--) {
    const m = out[i];
    if (m.role !== 'assistant') continue;
    const answered = new Set(
      out
        .slice(i + 1)
        .filter((x) => x.role === 'tool')
        .map((x) => (x as { callId: string }).callId)
    );
    for (const call of m.toolCalls ?? [])
      if (!answered.has(call.id))
        out.push({
          role: 'tool',
          callId: call.id,
          name: call.name,
          content: why,
          isError: true,
        });
    break;
  }
  return out;
}

export interface AssistantState {
  settings: AssistantSettings;
  documentId: string | null;
  documentName: string;
  messages: ChatMessage[];
  /** A reply is arriving. */
  streaming: boolean;
  /** Why the last send failed ('' when it didn't). */
  error: string;
  /** A question that wasn't answered, to put back in the composer. */
  draft: string;
  /** The open document may be sent to the model. */
  mayRead: boolean;
  /** Selected lines to send with the next question. */
  attachment: Excerpt | null;
}

const SETTINGS = 'assistant-settings';
/** An error, with what to do when it is a known one. */
const withHint = (error: string) =>
  /jinja/i.test(error)
    ? `${error} Start llama-server with --jinja and a model that calls tools, or turn tools off for it in Assistant setup.`
    : error;

const needsKey = (p: ProviderId) =>
  `${PROVIDERS[p].name} needs an API key. Add one in Assistant setup.`;

export class AssistantController {
  readonly store: Store<AssistantState>;
  private deps: AssistantDeps;
  private abort: AbortController | null = null;

  constructor(deps: AssistantDeps) {
    this.deps = deps;
    this.store = new Store<AssistantState>({
      settings: parseAssistantSettings(deps.readPref(SETTINGS)),
      documentId: null,
      documentName: '',
      messages: [],
      streaming: false,
      error: '',
      draft: '',
      mayRead: false,
      attachment: null,
    });
    // A key added after "needs an API key" clears the message.
    deps.keys.addEventListener('change', () => {
      const { error, settings } = this.store.getState();
      if (error === needsKey(settings.provider))
        this.store.setState({ error: '' });
    });
  }

  /** The request settings for a provider, with its key for this session. */
  config(provider: ProviderId): ProviderConfig {
    const { settings } = this.store.getState();
    return {
      provider,
      baseUrl:
        provider === 'local'
          ? settings.localBaseUrl
          : PROVIDERS[provider].baseUrl,
      model: settings.models[provider] || PROVIDERS[provider].defaultModel,
      apiKey: this.deps.keys.get(provider) || undefined,
    };
  }

  private saveSettings(settings: AssistantSettings) {
    this.deps.writePref(SETTINGS, JSON.stringify(settings));
    const { documentId } = this.store.getState();
    this.store.setState({
      settings,
      mayRead: !!documentId && settings.readDocuments.includes(documentId),
    });
  }

  setProvider(provider: ProviderId) {
    this.saveSettings({ ...this.store.getState().settings, provider });
    this.store.setState({ error: '' });
  }

  setModel(provider: ProviderId, model: string) {
    const { settings } = this.store.getState();
    this.saveSettings({
      ...settings,
      models: { ...settings.models, [provider]: model.trim() },
    });
  }

  /** Why the address can't be used, or null once it is saved. */
  setLocalBaseUrl(url: string): string | null {
    const problem = baseUrlProblem('local', url.trim());
    if (!problem)
      this.saveSettings({
        ...this.store.getState().settings,
        localBaseUrl: url.trim(),
      });
    return problem;
  }

  /** Let the model read the open document, or stop it. */
  allowReading(allow: boolean) {
    const { settings, documentId } = this.store.getState();
    if (!documentId) return;
    const others = settings.readDocuments.filter((d) => d !== documentId);
    this.saveSettings({
      ...settings,
      readDocuments: allow ? [...others, documentId] : others,
    });
  }

  /** Switch to a document's own conversation. */
  async openDocument(documentId: string, name: string) {
    this.stop();
    const { settings } = this.store.getState();
    this.store.setState({
      documentId,
      documentName: name,
      messages: [],
      error: '',
      draft: '',
      attachment: null,
      mayRead: settings.readDocuments.includes(documentId),
    });
    const messages = (await this.deps.chats.get(documentId)) ?? [];
    if (this.store.getState().documentId === documentId)
      this.store.setState({ messages });
  }

  /**
   * Ask the next question about these lines (null: don't). With `focus`,
   * the pane is asked to put the caret in the composer.
   */
  attach(excerpt: Excerpt | null, { focus = false } = {}) {
    this.store.setState({
      attachment: excerpt && excerpt.text.trim() ? excerpt : null,
    });
    if (focus) this.store.dispatchEvent(new Event('focus-composer'));
  }

  /** Rename the open document (its chat stays). */
  renameDocument(name: string) {
    this.store.setState({ documentName: name });
  }

  async clear() {
    this.stop();
    const { documentId } = this.store.getState();
    this.store.setState({ messages: [], error: '', draft: '' });
    if (documentId) await this.deps.chats.delete(documentId);
  }

  stop() {
    this.abort?.abort();
  }

  /** Tools on for this provider (ADR 0025)? On unless turned off. */
  toolsEnabled(provider: ProviderId): boolean {
    return (
      !!this.deps.tools &&
      !this.store.getState().settings.toolsOff.includes(provider)
    );
  }

  setToolsEnabled(provider: ProviderId, on: boolean) {
    const { settings } = this.store.getState();
    const rest = settings.toolsOff.filter((p) => p !== provider);
    this.saveSettings({
      ...settings,
      toolsOff: on ? rest : [...rest, provider],
    });
  }

  /**
   * Ask a question. The reply streams into the conversation; if the model
   * calls tools, each runs, its result goes back, and the answer goes on.
   */
  async send(text: string, source: string) {
    const question = text.trim();
    const state = this.store.getState();
    if (!question || state.streaming) return;
    const provider = state.settings.provider;
    const cfg = this.config(provider);
    if (PROVIDERS[provider].needsKey && !cfg.apiKey) {
      this.store.setState({ error: needsKey(provider), draft: question });
      return;
    }
    const content = state.attachment
      ? withExcerpt(question, state.attachment)
      : question;
    const tools = this.toolsEnabled(provider) ? this.deps.tools! : null;
    const definitions = tools?.definitions() ?? [];
    const system = systemPrompt(
      state.mayRead ? { name: state.documentName, source } : null,
      !!tools
    );
    const abort = new AbortController();
    this.abort = abort;
    let history: ChatMessage[] = [...state.messages, { role: 'user', content }];
    const show = (extra: ChatMessage[] = []) =>
      this.store.setState({ messages: [...history, ...extra] });
    this.store.setState({
      messages: history,
      streaming: true,
      error: '',
      draft: '',
      attachment: null,
    });
    let toolsRan = false;
    let stopped = false;
    let error = '';
    // The reply arriving now, kept if it is cut off.
    let live = '';
    try {
      for (let round = 0; ; round++) {
        live = '';
        const reply = await streamReply(
          provider,
          buildChatRequest(cfg, system, history, definitions),
          { fetch: this.deps.fetch, signal: abort.signal },
          (t) => {
            live += t;
            show([{ role: 'assistant', content: live }]);
          }
        );
        history = [
          ...history,
          {
            role: 'assistant',
            content: reply.text,
            ...(reply.toolCalls.length ? { toolCalls: reply.toolCalls } : {}),
            ...(reply.blocks ? { blocks: reply.blocks } : {}),
          },
        ];
        live = '';
        show();
        if (!tools || !reply.toolCalls.length) break;
        if (round >= MAX_ROUNDS) {
          history = answerOpenCalls(history, 'Not run: too many rounds.');
          history.push({
            role: 'assistant',
            content: `[Stopped after ${MAX_ROUNDS} rounds of tool calls.]`,
          });
          break;
        }
        for (const call of reply.toolCalls) {
          if (abort.signal.aborted) break;
          const result = await tools.run(call);
          toolsRan = true;
          history = [
            ...history,
            {
              role: 'tool',
              callId: call.id,
              name: call.name,
              content: result.content,
              ...(result.isError ? { isError: true } : {}),
            },
          ];
          show();
        }
        if (abort.signal.aborted) break;
      }
    } catch (e) {
      if (!abort.signal.aborted)
        error = e instanceof Error ? e.message : String(e);
    }
    stopped = abort.signal.aborted;
    this.abort = null;
    if (live) history = [...history, { role: 'assistant', content: live }];
    if (error && !toolsRan) {
      // Nothing was done: keep the question for a retry.
      this.store.setState({
        messages: state.messages,
        streaming: false,
        error: withHint(error),
        draft: question,
        attachment: state.attachment,
      });
      return;
    }
    history = answerOpenCalls(
      history,
      stopped ? 'Stopped before running.' : 'Not run.'
    );
    if (stopped) {
      const last = history.at(-1)!;
      if (last.role === 'assistant' && !last.toolCalls?.length)
        history[history.length - 1] = {
          ...last,
          content: last.content
            ? `${last.content}\n\n[Stopped.]`
            : '[Stopped.]',
        };
      else history.push({ role: 'assistant', content: '[Stopped.]' });
    }
    show();
    this.store.setState({ streaming: false, error: withHint(error) });
    if (
      this.store.getState().documentId === state.documentId &&
      state.documentId
    )
      await this.deps.chats.put(
        state.documentId,
        this.store.getState().messages
      );
  }

  /** The models a provider offers (throws with a readable message). */
  loadModels(provider: ProviderId): Promise<string[]> {
    return fetchModels(provider, buildModelsRequest(this.config(provider)), {
      fetch: this.deps.fetch,
    });
  }

  /** A short request to check the address, key and model work together. */
  async testConnection(provider: ProviderId): Promise<string> {
    const cfg = this.config(provider);
    if (PROVIDERS[provider].needsKey && !cfg.apiKey) return needsKey(provider);
    let reply = '';
    try {
      for await (const piece of streamChat(
        provider,
        buildChatRequest(cfg, 'Reply with one word.', [
          { role: 'user', content: 'Say hello.' },
        ]),
        { fetch: this.deps.fetch }
      )) {
        reply += piece;
        if (reply.length > 80) break;
      }
    } catch (e) {
      return `Failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    return `Connected: the model replied “${reply.trim().slice(0, 80)}”.`;
  }
}
