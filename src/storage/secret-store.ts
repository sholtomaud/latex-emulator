/**
 * Secrets the app holds for the user, such as the Zotero plugin's token
 * (ADR 0024): kept in memory for this session, or, if the user opts in,
 * remembered on this device encrypted with AES-GCM under a key the browser
 * will not export. The encrypted copy and its key live in IndexedDB
 * (secret-db.ts), never in localStorage, and never in backups.
 *
 * What this protects against: the token being read out of storage, a
 * backup or a copied profile as text. What it doesn't: code running in
 * this app's own origin, which can use the key (but not export it).
 */
export interface SealedSecret {
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  data: ArrayBuffer;
}

export interface SecretKv {
  get(name: string): Promise<SealedSecret | undefined>;
  put(name: string, value: SealedSecret): Promise<void>;
  delete(name: string): Promise<void>;
}

export class SecretStore {
  #kv: SecretKv;
  #subtle: SubtleCrypto;
  #session = new Map<string, string>();

  constructor(kv: SecretKv, subtle: SubtleCrypto) {
    this.#kv = kv;
    this.#subtle = subtle;
  }

  /** This session's copy, else the remembered one, else null. */
  async get(name: string): Promise<string | null> {
    const held = this.#session.get(name);
    if (held !== undefined) return held;
    const sealed = await this.#kv.get(name).catch(() => undefined);
    if (!sealed) return null;
    try {
      const plain = await this.#subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.iv },
        sealed.key,
        sealed.data
      );
      const value = new TextDecoder().decode(plain);
      this.#session.set(name, value);
      return value;
    } catch {
      await this.#kv.delete(name).catch(() => {});
      return null;
    }
  }

  /** Hold `value`; with `remember`, also store it encrypted on this device. */
  async set(name: string, value: string, remember: boolean): Promise<void> {
    this.#session.set(name, value);
    if (!remember) {
      await this.#kv.delete(name).catch(() => {});
      return;
    }
    const key = await this.#subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await this.#subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(value)
    );
    await this.#kv.put(name, { key, iv, data });
  }

  async remembered(name: string): Promise<boolean> {
    return (await this.#kv.get(name).catch(() => undefined)) !== undefined;
  }

  async forget(name: string): Promise<void> {
    this.#session.delete(name);
    await this.#kv.delete(name).catch(() => {});
  }
}
