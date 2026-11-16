import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { editorReady, setSource } from '../support/editor.ts';
import { chooseDownload } from '../support/download.ts';
import { unzip } from '../support/unzip.ts';

/**
 * Download project (.zip) (ADR 0015, phase A): the open document as the
 * folder pdflatex needs, with the .bib files its \bibliography lists and its
 * Images next to the .tex.
 */

const SOURCE = [
  '\\documentclass{article}',
  '\\usepackage{graphicx}',
  '\\usepackage{natbib}',
  '\\begin{document}',
  'See \\citet{odum_environmental_1996}.',
  '\\includegraphics{plot}',
  '\\bibliographystyle{plainnat}',
  '\\bibliography{references}',
  '\\end{document}',
].join('\n');

test('Download project saves the .tex, its .bib file and its images as a zip', async ({
  page,
}) => {
  await page.goto('/');
  await editorReady(page);
  await page.getByRole('button', { name: 'Toggle documents' }).click();
  await page
    .locator('image-panel .add-image-input')
    .setInputFiles('fixtures/figure-basic/images/plot.png');
  await expect(page.locator('image-panel .image-item')).toHaveCount(1);
  await setSource(page, SOURCE);

  const downloadPromise = page.waitForEvent('download');
  await chooseDownload(page, 'Download project (.zip)');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('a-short-example.zip');

  const files = unzip(fs.readFileSync((await download.path())!));
  expect([...files.keys()]).toEqual([
    'a-short-example/a-short-example.tex',
    'a-short-example/references.bib',
    'a-short-example/plot.png',
  ]);
  expect(files.get('a-short-example/a-short-example.tex')!.toString()).toBe(
    SOURCE
  );
  expect(files.get('a-short-example/references.bib')!.toString()).toContain(
    'odum_environmental_1996'
  );
  // Only what the document cites (ADR 0020): the rest of the library stays out.
  expect(files.get('a-short-example/references.bib')!.toString()).not.toContain(
    'knuth_texbook_1984'
  );
  expect(
    files
      .get('a-short-example/plot.png')!
      .equals(fs.readFileSync('fixtures/figure-basic/images/plot.png'))
  ).toBe(true);
});
