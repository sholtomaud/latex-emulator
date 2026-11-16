/**
 * The app's one vault (vault.ts): the browser's password manager where
 * there is one, else encrypted on this device (secret-store.ts, in its own
 * IndexedDB database). Covered by e2e, like the other browser wiring.
 */
import { Vault, encryptedBackend } from './vault.ts';
import { passwordManagerBackend } from './password-manager.ts';
import { SecretStore } from './secret-store.ts';
import { secretDb } from './secret-db.ts';

export const appVault = new Vault(
  passwordManagerBackend() ??
    (globalThis.crypto?.subtle && globalThis.indexedDB
      ? encryptedBackend(new SecretStore(secretDb, crypto.subtle))
      : null)
);
