/**
 * The browser's password manager as the vault's backend (vault.ts), through
 * the Credential Management API. Chromium (Chrome, Edge, Brave) has
 * PasswordCredential; Firefox and Safari don't, and there the vault falls
 * back to encrypted storage on this device.
 */
import type { VaultBackend } from './vault.ts';

/**
 * The one saved "password": every remembered secret, as JSON. The ID is
 * the assistant's original one (ADR 0023), so keys saved before the vault
 * held other secrets are still found, and no second entry appears.
 */
const ID = 'latex-emulator-assistant-keys';

interface PasswordCredentialLike extends Credential {
  password?: string;
}
type PasswordCredentialCtor = new (data: {
  id: string;
  password: string;
  name: string;
}) => Credential;

export function passwordManagerBackend(): VaultBackend | null {
  const Ctor = (globalThis as { PasswordCredential?: PasswordCredentialCtor })
    .PasswordCredential;
  if (!Ctor || !navigator.credentials || !window.isSecureContext) return null;
  return {
    kind: 'password-manager',
    async load() {
      // 'optional': returned at once when allowed, otherwise the browser
      // asks the user to pick the saved entry.
      const c = (await navigator.credentials.get({
        password: true,
        mediation: 'optional',
      } as CredentialRequestOptions)) as PasswordCredentialLike | null;
      return c && c.type === 'password' && c.id === ID
        ? (c.password ?? null)
        : null;
    },
    async save(password: string) {
      await navigator.credentials.store(
        new Ctor({ id: ID, password, name: 'LaTeX Emulator keys' })
      );
    },
  };
}
