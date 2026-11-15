import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import { editorReady, setSource } from '../support/editor.ts';

/**
 * Save to a folder on this computer (ADR 0015 phase B). Playwright can't
 * drive the browser's folder picker, so showDirectoryPicker is replaced by
 * one returning a folder in the origin-private file system: real
 * FileSystemDirectoryHandles, written through the same API.
 *
 * Run it in the pinned image (npm run e2e): some hosts' Chromium builds
 * close the page when an OPFS handle is read back from IndexedDB (ADR 0015).
 */

const panel = (page: Page) => page.getByRole('region', { name: 'Storage' });

/** The picker returns OPFS folder `name` (created on demand). */
async function fakePicker(page: Page, name = 'Papers') {
  await page.addInitScript((name) => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () =>
        (await navigator.storage.getDirectory()).getDirectoryHandle(
          (window as unknown as { pickName?: string }).pickName ?? name,
          { create: true }
        ),
    });
  }, name);
}

/** A file's text in the fake disk, or null. */
function readDisk(page: Page, path: string) {
  return page.evaluate(async (path) => {
    let dir = await navigator.storage.getDirectory();
    const parts = path.split('/');
    try {
      for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
      const f = await dir.getFileHandle(parts.at(-1)!);
      return await (await f.getFile()).text();
    } catch {
      return null;
    }
  }, path);
}

function writeDisk(page: Page, path: string, data: string | number[]) {
  return page.evaluate(
    async ([path, data]) => {
      let dir = await navigator.storage.getDirectory();
      const parts = (path as string).split('/');
      for (const p of parts.slice(0, -1))
        dir = await dir.getDirectoryHandle(p, { create: true });
      const f = await dir.getFileHandle(parts.at(-1)!, { create: true });
      const w = await f.createWritable();
      await w.write(
        typeof data === 'string' ? data : new Uint8Array(data as number[])
      );
      await w.close();
    },
    [path, data] as const
  );
}

async function openExplorer(page: Page) {
  await page.goto('/');
  await editorReady(page);
  await page.getByRole('button', { name: 'Toggle documents' }).click();
}

const SOURCE = [
  '\\documentclass{article}',
  '\\usepackage{graphicx}',
  '\\begin{document}',
  '\\includegraphics{plot}',
  '\\bibliography{references}',
  '\\end{document}',
].join('\n');

test('Save to folder writes the project folder, then only what changed', async ({
  page,
}) => {
  await fakePicker(page);
  await openExplorer(page);
  await page
    .locator('image-panel .add-image-input')
    .setInputFiles('fixtures/figure-basic/images/plot.png');
  await expect(page.locator('image-panel .image-item')).toHaveCount(1);
  await setSource(page, SOURCE);

  await panel(page).getByRole('button', { name: 'Save to folder…' }).click();
  await expect(panel(page)).toContainText(
    'Saved to a-short-example/ in “Papers”: 3 files written.'
  );
  expect(
    await readDisk(page, 'Papers/a-short-example/a-short-example.tex')
  ).toBe(SOURCE);
  expect(
    await readDisk(page, 'Papers/a-short-example/references.bib')
  ).toContain('@');
  expect(
    await readDisk(page, 'Papers/a-short-example/plot.png')
  ).not.toBeNull();
  await expect(panel(page)).toContainText('a-short-example/ in “Papers”');

  await setSource(
    page,
    SOURCE.replace('\\end{document}', 'More.\n\\end{document}')
  );
  await panel(page).getByRole('button', { name: 'Save to folder' }).click();
  await expect(panel(page)).toContainText('1 file written.');
});

test('a file changed in the folder is not overwritten without asking', async ({
  page,
}) => {
  await fakePicker(page);
  await openExplorer(page);
  await setSource(page, 'first');
  await panel(page).getByRole('button', { name: 'Save to folder…' }).click();
  await expect(panel(page)).toContainText('1 file written.');

  await writeDisk(page, 'Papers/a-short-example/a-short-example.tex', 'theirs');
  await setSource(page, 'second');
  await panel(page).getByRole('button', { name: 'Save to folder' }).click();
  await expect(panel(page)).toContainText(
    'a-short-example.tex changed in the folder since the last save.'
  );
  expect(
    await readDisk(page, 'Papers/a-short-example/a-short-example.tex')
  ).toBe('theirs');

  await panel(page).getByRole('button', { name: 'Overwrite' }).click();
  await expect(panel(page)).toContainText('1 file written.');
  expect(
    await readDisk(page, 'Papers/a-short-example/a-short-example.tex')
  ).toBe('second');
});

test('“Save there as I type” keeps the folder up to date, and the folder is remembered', async ({
  page,
}) => {
  await fakePicker(page);
  await openExplorer(page);
  await setSource(page, 'one');
  await panel(page).getByRole('button', { name: 'Save to folder…' }).click();
  await expect(panel(page)).toContainText('1 file written.');
  await panel(page).getByLabel('Save there as I type').check();

  await setSource(page, 'two');
  await expect
    .poll(() => readDisk(page, 'Papers/a-short-example/a-short-example.tex'), {
      timeout: 10_000,
    })
    .toBe('two');

  await page.reload();
  await editorReady(page);
  await expect(panel(page)).toContainText('a-short-example/ in “Papers”');
  await expect(panel(page).getByLabel('Save there as I type')).toBeChecked();

  await panel(page)
    .getByRole('button', { name: 'Stop saving to this folder' })
    .click();
  await expect(
    panel(page).getByRole('button', { name: 'Save to folder…' })
  ).toBeVisible();
  // The files stay.
  expect(
    await readDisk(page, 'Papers/a-short-example/a-short-example.tex')
  ).toBe('two');
});

test('Open folder reads a project into a new document, with its images and .bib file', async ({
  page,
}) => {
  await fakePicker(page, 'thesis');
  await openExplorer(page);
  const main = [
    '\\documentclass{article}',
    '\\usepackage{graphicx}',
    '\\graphicspath{{figs/}}',
    '\\begin{document}',
    '\\includegraphics{plot}',
    '\\bibliography{thesis-refs}',
    '\\end{document}',
  ].join('\n');
  await writeDisk(page, 'thesis/main.tex', main);
  await writeDisk(page, 'thesis/main.pdf', '%PDF-1.5 output');
  await writeDisk(page, 'thesis/thesis-refs.bib', '@misc{t, title={T}}');
  await writeDisk(page, 'thesis/figs/plot.png', [
    ...fs.readFileSync('fixtures/figure-basic/images/plot.png'),
  ]);

  await panel(page).getByRole('button', { name: 'Open folder…' }).click();
  await expect(panel(page)).toContainText('Opened main.tex from thesis/.');
  const docs = page.getByRole('navigation', { name: 'Documents' });
  await expect(
    docs.getByRole('button', { name: 'main', exact: true })
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            document.querySelector('latex-editor') as unknown as {
              value: string;
            }
          ).value
      )
    )
    .toBe(main);
  await expect(page.locator('image-panel .image-item')).toHaveCount(1);
  await expect(page.locator('image-panel .image-item')).toContainText(
    'figs/plot.png'
  );
  await expect(
    page.getByRole('region', { name: 'Bibliography' })
  ).toContainText('thesis-refs.bib');

  // It saves back into the same folder, under the folder's own .tex name.
  await setSource(
    page,
    main.replace('\\end{document}', 'Edited.\n\\end{document}')
  );
  await panel(page).getByRole('button', { name: 'Save to folder' }).click();
  await expect(panel(page)).toContainText('Saved to thesis/: 1 file written.');
  expect(await readDisk(page, 'thesis/main.tex')).toContain('Edited.');
});

test('without the File System Access API the panel points to the zip download', async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showDirectoryPicker?: unknown })
      .showDirectoryPicker;
  });
  await openExplorer(page);
  await expect(panel(page)).toContainText(
    'Saving to a folder needs Chrome or Edge. Use Download .zip instead.'
  );
  await expect(
    panel(page).getByRole('button', { name: 'Save to folder…' })
  ).toHaveCount(0);
});
