import os from 'node:os';
import { test, expect } from '@playwright/test';

/** This machine's own non-loopback IPv4 address: "outside localhost" that
 * needs no internet, so the guard is testable anywhere. */
const lanAddress = Object.values(os.networkInterfaces())
  .flat()
  .find((a) => a?.family === 'IPv4' && !a.internal)?.address;

/**
 * The test browser is unsandboxed in containers and runs a Chromium that
 * may lag behind security fixes, so it must never load content from the
 * internet. Every request outside localhost goes to a dead proxy
 * (playwright.config.ts). Tests that talk to doi.org or Zotero mock those
 * calls with page.route, which answers before the proxy.
 */
test.describe('network guard', () => {
  test('a server on a non-loopback address cannot be reached', async ({
    page,
  }) => {
    expect(lanAddress, 'a non-loopback IPv4 interface').toBeDefined();
    // The production build is served on all interfaces at port 3000.
    await expect(page.goto(`http://${lanAddress}:3000/`)).rejects.toThrow();
  });

  test('pages outside localhost cannot be opened', async ({ page }) => {
    await expect(page.goto('https://example.com/')).rejects.toThrow();
    // An IP literal needs no DNS, so it must be blocked too.
    await expect(page.goto('http://1.1.1.1/')).rejects.toThrow();
  });

  test('the app cannot reach an outside host its CSP allows', async ({
    page,
  }) => {
    await page.goto('/');
    const outcome = await page.evaluate(async () => {
      try {
        await fetch('https://doi.org/10.1000/182', { mode: 'no-cors' });
        return 'reached';
      } catch {
        return 'blocked';
      }
    });
    expect(outcome).toBe('blocked');
  });

  test('page.route mocks still answer', async ({ page }) => {
    await page.route('https://doi.org/**', (route) =>
      route.fulfill({ status: 200, body: 'mocked' })
    );
    await page.goto('/');
    const body = await page.evaluate(async () =>
      (await fetch('https://doi.org/10.1000/182')).text()
    );
    expect(body).toBe('mocked');
  });
});
