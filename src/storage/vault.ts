/**
 * Every secret the user asks the app to remember, in one place (ADR 0024,
 * agreed November 2026): the assistant's API keys (ADR 0023) and the
 * Zotero plugin's token.
 *
 * - Secrets last for the session unless the user ticks Remember.
 * - Remembered secrets go to the browser's password manager where the
 *   browser has one (Chromium's PasswordCredential): kept by the browser
 *   with the user's other passwords.
 * - Without one (Firefox, Safari), they are stored encrypted on this
 *   device instead (secret-store.ts: AES-GCM, a non-exportable key, in
 *   their own IndexedDB database).
 *
 * The password manager hands back one saved password per site (and asks
 * the user to choose if there are several), so all remembered secrets are
 * one JSON object saved as one password.
 */
import type { SecretStore } from './secret-store.ts';

export interface VaultBackend {
  kind: 'password-manager' | 'encrypted';
  /** The saved blob, or null. A password manager may ask the user first. */
  load(): Promise<string | null>;
  save(text: string): Promise<void>;
}

export class Vault {
  #backend: VaultBackend | null;
  #entries: Promise<Map<string, string>> | null = null;
  /** The entries once read, for cached(). */
  #read: Map<string, string> | null = null;

  constructor(backend: VaultBackend | null) {
    this.#backend = backend;
  }

  /** How remembered secrets are kept here, or null if they can't be. */
  get how(): VaultBackend['kind'] | null {
    return this.#backend?.kind ?? null;
  }

  get canRemember(): boolean {
    return this.#backend !== null;
  }

  /** The remembered secrets, read once (a failed read is tried again). */
  entries(): Promise<Map<string, string>> {
    if (!this.#entries) {
      const backend = this.#backend;
      this.#entries = backend
        ? backend.load().then(
            (text) => (this.#read = parse(text)),
            () => {
              this.#entries = null;
              return new Map<string, string>();
            }
          )
        : Promise.resolve((this.#read = new Map()));
    }
    return this.#entries;
  }

  /**
   * From what has already been read, without reading: undefined if the
   * vault hasn't been read yet. For callers that must never make the
   * password manager ask (the citation typeahead runs while typing).
   */
  cached(name: string): string | null | undefined {
    return this.#read ? (this.#read.get(name) ?? null) : undefined;
  }

  async get(name: string): Promise<string | null> {
    return (await this.entries()).get(name) ?? null;
  }

  /** Remember `value` under `name`, or forget it (null). Others are kept. */
  put(name: string, value: string | null): Promise<void> {
    return this.putAll({ [name]: value });
  }

  /** Several changes in one save: each save may make the browser ask. */
  async putAll(changes: Record<string, string | null>): Promise<void> {
    if (!this.#backend) return;
    const entries = await this.entries();
    for (const [name, value] of Object.entries(changes))
      if (value === null) entries.delete(name);
      else entries.set(name, value);
    await this.#backend.save(JSON.stringify(Object.fromEntries(entries)));
  }
}

function parse(text: string | null): Map<string, string> {
  const entries = new Map<string, string>();
  let json: unknown;
  try {
    json = text === null ? null : JSON.parse(text);
  } catch {
    return entries;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    return entries;
  for (const [name, value] of Object.entries(json))
    if (typeof value === 'string' && value) entries.set(name, value);
  return entries;
}

/**
 * A part of the vault for code that saves its secrets as one JSON object
 * (the assistant's KeyStore): it sees and replaces only `names`.
 */
export function vaultSection(vault: Vault, names: readonly string[]) {
  return {
    async load(): Promise<string | null> {
      const entries = await vault.entries();
      const own = Object.fromEntries(
        names.flatMap((n) => (entries.has(n) ? [[n, entries.get(n)!]] : []))
      );
      return Object.keys(own).length ? JSON.stringify(own) : null;
    },
    async save(text: string): Promise<void> {
      const json: unknown = JSON.parse(text);
      if (typeof json !== 'object' || json === null || Array.isArray(json))
        throw new Error('A section saves a JSON object.');
      const values = json as Record<string, unknown>;
      await vault.putAll(
        Object.fromEntries(
          names.map((n) => {
            const v = values[n];
            return [n, typeof v === 'string' && v ? v : null];
          })
        )
      );
    },
  };
}

/** The fallback: the vault's blob encrypted on this device. */
export function encryptedBackend(store: SecretStore): VaultBackend {
  return {
    kind: 'encrypted',
    load: () => store.get('vault'),
    save: (text) => store.set('vault', text, true),
  };
}

/** Where a ticked Remember keeps a secret, for the options' labels. */
export function rememberWhere(how: VaultBackend['kind'] | null): string {
  if (how === 'password-manager') return 'in this browser’s password manager';
  if (how === 'encrypted') return 'on this device (stored encrypted)';
  return '';
}
