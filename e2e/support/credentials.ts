import type { Page } from '@playwright/test';

/**
 * The test browser has PasswordCredential but no password manager behind
 * it. This stands one in (Credential Management API, as src/storage/
 * password-manager.ts uses it), keeping the saved password in
 * sessionStorage so it survives a reload. `savedPassword` reads it back.
 */
export async function fakePasswordManager(page: Page) {
  await page.addInitScript(() => {
    const KEY = 'test-password-manager';
    class FakePasswordCredential {
      type = 'password';
      id: string;
      password: string;
      name: string;
      constructor(d: { id: string; password: string; name: string }) {
        this.id = d.id;
        this.password = d.password;
        this.name = d.name;
      }
    }
    Object.defineProperty(window, 'PasswordCredential', {
      value: FakePasswordCredential,
      configurable: true,
    });
    Object.defineProperty(navigator, 'credentials', {
      configurable: true,
      value: {
        store: async (c: FakePasswordCredential) => {
          sessionStorage.setItem(
            KEY,
            JSON.stringify({ id: c.id, password: c.password })
          );
          return c;
        },
        get: async () => {
          const w = window as unknown as { credentialReads?: number };
          w.credentialReads = (w.credentialReads ?? 0) + 1;
          const saved = sessionStorage.getItem(KEY);
          return saved ? { type: 'password', ...JSON.parse(saved) } : null;
        },
      },
    });
  });
}

export async function savedPassword(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const saved = sessionStorage.getItem('test-password-manager');
    return saved ? (JSON.parse(saved) as { password: string }).password : null;
  });
}

/** A browser without the API (Firefox, Safari): the encrypted fallback. */
export async function noPasswordManager(page: Page) {
  await page.addInitScript(() => {
    delete (window as { PasswordCredential?: unknown }).PasswordCredential;
  });
}

/** How often this page asked the (fake) password manager for its password. */
export async function credentialReads(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as unknown as { credentialReads?: number }).credentialReads ?? 0
  );
}
