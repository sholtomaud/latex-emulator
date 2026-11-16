/**
 * API keys for the assistant's providers (ADR 0023).
 *
 * A key lives in memory for the session. When the user asks to remember
 * it, it goes to the app's vault (src/storage/vault.ts): the browser's own
 * password manager where it has one, else encrypted on this device. Never
 * localStorage, backups or project folders. The keys are saved together
 * as one JSON object, a section of the vault.
 */
import type { ProviderId } from './providers.ts';
import { PROVIDER_IDS } from './providers.ts';

/** Where remembered keys go (a section of the vault), as the store needs it. */
export interface PasswordManager {
  /** The saved password, or null. May ask the user to choose or confirm. */
  load(): Promise<string | null>;
  /** Save (or replace) the password. The browser may ask first. */
  save(password: string): Promise<void>;
}

export class KeyStore extends EventTarget {
  private keys = new Map<ProviderId, string>();
  private saved = new Set<ProviderId>();
  private unlocked = false;
  private manager: PasswordManager | null;

  constructor(manager: PasswordManager | null) {
    super();
    this.manager = manager;
  }

  /** Keys can be remembered (in the password manager or encrypted). */
  get canRemember(): boolean {
    return this.manager !== null;
  }

  get(provider: ProviderId): string {
    return this.keys.get(provider) ?? '';
  }

  remembered(provider: ProviderId): boolean {
    return this.saved.has(provider);
  }

  /**
   * Read the remembered keys (once; the browser may ask the user). Keys
   * typed this session win. True when saved keys were found.
   */
  async unlock(): Promise<boolean> {
    if (!this.manager) return false;
    if (this.unlocked) return true;
    let text: string | null;
    try {
      text = await this.manager.load();
    } catch {
      return false;
    }
    if (text === null) return false;
    this.unlocked = true;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (typeof json === 'object' && json !== null && !Array.isArray(json))
      for (const id of PROVIDER_IDS) {
        const key = (json as Record<string, unknown>)[id];
        if (typeof key !== 'string' || !key) continue;
        this.saved.add(id);
        if (!this.keys.has(id)) this.keys.set(id, key);
      }
    this.changed();
    return true;
  }

  /** Set a key for the session, and remember or forget it. */
  async set(provider: ProviderId, key: string, remember: boolean) {
    if (key) this.keys.set(provider, key);
    else this.keys.delete(provider);
    const wasSaved = this.saved.has(provider);
    if (remember && key) this.saved.add(provider);
    else this.saved.delete(provider);
    this.changed();
    if (this.manager && (remember || wasSaved)) {
      const all: Record<string, string> = {};
      for (const id of PROVIDER_IDS)
        if (this.saved.has(id)) all[id] = this.get(id);
      await this.manager.save(JSON.stringify(all));
    }
  }

  private changed() {
    this.dispatchEvent(new Event('change'));
  }
}
