/**
 * The browser's password manager as a key vault (ADR 0023), through the
 * Credential Management API. Chromium (Chrome, Edge) has PasswordCredential;
 * Firefox and Safari don't, so there keys last for the session only.
 */
import type { PasswordManager } from './key-store.ts';

/** The one saved "password": every remembered key, as JSON. */
const ID = 'latex-emulator-assistant-keys';

interface PasswordCredentialLike extends Credential {
  password?: string;
}
type PasswordCredentialCtor = new (data: {
  id: string;
  password: string;
  name: string;
}) => Credential;

export function browserPasswordManager(): PasswordManager | null {
  const Ctor = (globalThis as { PasswordCredential?: PasswordCredentialCtor })
    .PasswordCredential;
  if (!Ctor || !navigator.credentials || !window.isSecureContext) return null;
  return {
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
        new Ctor({ id: ID, password, name: 'LaTeX Emulator assistant keys' })
      );
    },
  };
}
