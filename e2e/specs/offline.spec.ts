import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import fs from 'node:fs';
import { editorReady, setSource } from '../support/editor.ts';

/**
 * Offline-first (ADR 0021): after one visit the app starts and works with
 * no network, and a new release waits for the user to reload.
 */

// The service worker is registered by production builds only.
// Serial: one test publishes a new release by rewriting dist/sw.js (so
// repeat this file with --workers=1, or parallel repeats swap it at once).
test.describe.configure({ mode: 'serial' });
test.beforeEach(() => {
  test.skip(
    test.info().project.name !== 'functional-prod',
    'production build only'
  );
});

const preview = (page: Page) =>
  page.frameLocator('latex-preview iframe').locator('.latex-page');

/** Load once and wait until the service worker controls the page. */
async function install(page: Page) {
  await page.goto('/');
  await editorReady(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return;
    await new Promise((resolve) =>
      navigator.serviceWorker.addEventListener('controllerchange', resolve, {
        once: true,
      })
    );
  });
}

function failedRequests(context: BrowserContext) {
  const failed: string[] = [];
  context.on('requestfailed', (r) => failed.push(r.url()));
  return failed;
}

test('after one visit the app starts, edits and previews with no network', async ({
  page,
  context,
}) => {
  await install(page);
  await context.setOffline(true);
  const failed = failedRequests(context);

  await page.reload();
  await editorReady(page);
  await expect(preview(page)).toContainText('A Short Example');
  await setSource(
    page,
    '\\documentclass{article}\n\\begin{document}\nWritten offline.\n\\end{document}\n'
  );
  await expect(preview(page)).toContainText('Written offline.');
  // The Latin Modern fonts came from the cache too.
  const fontsLoaded = await page
    .frameLocator('latex-preview iframe')
    .locator('body')
    .evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((f) => f.status === 'loaded').length;
    });
  expect(fontsLoaded).toBeGreaterThan(0);
  expect(failed).toEqual([]);
});

test('the build is cached once, under its version', async ({ page }) => {
  await install(page);
  const sw = fs.readFileSync('dist/sw.js', 'utf8');
  const version = /"version":"([0-9a-f]{16})"/.exec(sw)![1];
  expect(await page.evaluate(() => caches.keys())).toEqual([
    `latex-emulator-${version}`,
  ]);
});

test('a new release waits for the user, then Reload switches to it', async ({
  page,
}) => {
  await install(page);
  const banner = page.getByRole('status').filter({
    hasText: 'A new version of LaTeX Emulator is ready.',
  });
  await expect(banner).toBeHidden();

  // The server now has a new release: same files, a new worker version.
  // (context.route doesn't see a worker's update check, so the file the
  // production server serves is replaced, and restored afterwards.)
  const [before] = await page.evaluate(() => caches.keys());
  const original = fs.readFileSync('dist/sw.js', 'utf8');
  // A different size too: the test server's ETag is size + mtime, and a
  // same-size file rewritten within a second would look unchanged (304).
  // A version of its own: other tests may load the app while the file is
  // swapped, and must not share this release's cache name.
  const version = `00${Date.now().toString(16).padStart(14, '0')}`.slice(-16);
  const released =
    original.replace(/"version":"[0-9a-f]{16}"/, `"version":"${version}"`) +
    `\n// test release ${version}\n`;
  fs.writeFileSync('dist/sw.js', released);
  try {
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg!.update();
    });
    // The new release caches every file (~5 MB) before it is offered.
    await expect(banner).toBeVisible({ timeout: 20_000 });
    // Still on the old release until asked: both caches exist.
    expect((await page.evaluate(() => caches.keys())).sort()).toEqual(
      [before, `latex-emulator-${version}`].sort()
    );
  } finally {
    fs.writeFileSync('dist/sw.js', original);
  }

  const reloaded = page.waitForEvent('load');
  await banner.getByRole('button', { name: 'Reload' }).click();
  await reloaded;
  await editorReady(page);
  await expect
    .poll(() => page.evaluate(() => caches.keys()))
    .toEqual([`latex-emulator-${version}`]);
  await expect(banner).toBeHidden();
});

test('the app can be installed: a manifest with its icons, relative to where it is served', async ({
  page,
}) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('manifest.webmanifest');
  const manifest = await page.evaluate(async (href) => {
    const r = await fetch(href!);
    return r.json();
  }, href);
  expect(manifest).toMatchObject({
    name: 'LaTeX Emulator',
    short_name: 'LaTeX',
    start_url: './',
    scope: './',
    display: 'standalone',
  });
  const sizes = await page.evaluate(
    async (icons: { src: string; sizes: string; type: string }[]) =>
      Promise.all(
        icons
          .filter((i) => i.type === 'image/png')
          .map(async (i) => {
            const bitmap = await createImageBitmap(
              await (await fetch(i.src)).blob()
            );
            return `${i.sizes}=${bitmap.width}x${bitmap.height}`;
          })
      ),
    manifest.icons
  );
  expect(sizes).toEqual([
    '192x192=192x192',
    '512x512=512x512',
    '512x512=512x512',
  ]);
  expect(
    manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')
  ).toBe(true);
});
