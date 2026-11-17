/**
 * The assistant's chat (ADR 0023): which provider and model, whether the
 * open document may be read, the conversation per document, and sending
 * with a streamed reply. Everything it touches outside itself (fetch,
 * storage, preferences, keys) is passed in, so it is tested in Node; the
 * browser wiring is `assistant-service.ts`.
 */
import { Store } from '../core/store.ts';
import { fetchModels, streamChat } from './chat-client.ts';
import { answerOpenCalls, runToolLoop, withHint } from './run-tools.ts';
import type { LoopTools } from './run-tools.ts';
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
import type { ChatMessage, ProviderConfig, ProviderId } from './providers.ts';

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
  tools?: LoopTools;
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
  /** "Review as I write" is on for the open document (ADR 0025 §3). */
  reviewing: boolean;
}

const SETTINGS = 'assistant-settings';
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
      reviewing: false,
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
      ...this.permissions(documentId, settings),
    });
  }

  /** What the assistant may do with a document. */
  private permissions(
    documentId: string | null,
    settings = this.store.getState().settings
  ) {
    const mayRead = !!documentId && settings.readDocuments.includes(documentId);
    return {
      mayRead,
      reviewing: mayRead && settings.reviewDocuments.includes(documentId!),
    };
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
      // Reviewing reads the document: it stops when reading does.
      reviewDocuments: allow
        ? settings.reviewDocuments
        : settings.reviewDocuments.filter((d) => d !== documentId),
    });
  }

  /** Why the reviewer can't run now (ADR 0025 §3), or null. */
  reviewProblem(): string | null {
    const { settings, mayRead } = this.store.getState();
    const provider = settings.provider;
    if (!mayRead)
      return 'Let the assistant read this document first: the reviewer reads it.';
    if (PROVIDERS[provider].needsKey && !this.config(provider).apiKey)
      return needsKey(provider);
    if (!this.toolsEnabled(provider))
      return `The reviewer needs tools: turn them on for ${PROVIDERS[provider].name} in Assistant setup.`;
    return null;
  }

  /** Review the open document as the author writes, or stop. */
  setReviewing(on: boolean) {
    const { settings, documentId, mayRead } = this.store.getState();
    if (!documentId || (on && !mayRead)) return;
    const others = settings.reviewDocuments.filter((d) => d !== documentId);
    this.saveSettings({
      ...settings,
      reviewDocuments: on ? [...others, documentId] : others,
    });
  }

  /** Switch to a document's own conversation. */
  async openDocument(documentId: string, name: string) {
    this.stop();
    this.store.setState({
      documentId,
      documentName: name,
      messages: [],
      error: '',
      draft: '',
      attachment: null,
    });
    this.store.setState(this.permissions(documentId));
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
    const system = systemPrompt(
      state.mayRead ? { name: state.documentName, source } : null,
      !!tools
    );
    const abort = new AbortController();
    this.abort = abort;
    const start: ChatMessage[] = [...state.messages, { role: 'user', content }];
    this.store.setState({
      messages: start,
      streaming: true,
      error: '',
      draft: '',
      attachment: null,
    });
    const result = await runToolLoop({
      cfg,
      system,
      history: start,
      tools,
      fetch: this.deps.fetch,
      signal: abort.signal,
      onUpdate: (h, live) =>
        this.store.setState({
          messages: live ? [...h, { role: 'assistant', content: live }] : h,
        }),
    });
    const { toolsRan, error, stopped } = result;
    let history = result.history;
    const show = () => this.store.setState({ messages: history });
    this.abort = null;
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
