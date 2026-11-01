import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { editorReady, setSource } from '../support/editor.ts';

const PLOT = 'fixtures/figure-basic/images/plot.png'; // 600 × 300 px, 300 dpi
const BARS = 'fixtures/figure-basic/images/bars.jpg'; // 800 × 400 px, 150 dpi

const toggle = (page: Page) =>
  page.getByRole('button', { name: 'Toggle documents' });
const images = (page: Page) => page.getByRole('region', { name: 'Images' });
const imageList = (page: Page) =>
  page.getByRole('list', { name: 'This document’s images' });
const preview = (page: Page) => page.frameLocator('latex-preview iframe');
const doc = (body: string) =>
  `\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n${body}\n\\end{document}`;

async function openExplorer(page: Page) {
  if ((await toggle(page).getAttribute('aria-expanded')) !== 'true')
    await toggle(page).click();
  await expect(images(page)).toBeVisible();
}

async function addFiles(page: Page, files: string[]) {
  await images(page).locator('.add-image-input').setInputFiles(files);
}

test.describe('images', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await editorReady(page);
  });

  test('an added image is listed and drawn at pdfTeX’s natural size', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openExplorer(page);
    await expect(images(page)).toContainText('No images in this document');
    await addFiles(page, [PLOT, BARS]);
    await expect(imageList(page).getByRole('listitem')).toHaveText([
      /bars\.jpg\s*JPEG · 800 × 400 px · 150 dpi/,
      /plot\.png\s*PNG · 600 × 300 px · 300 dpi/,
    ]);
    await expect(images(page)).toContainText('Added plot.png, bars.jpg.');
    await setSource(page, doc('\\includegraphics{plot}'));
    const img = preview(page).locator('img.graphic');
    await expect(img).toHaveAttribute('alt', 'plot.png');
    await expect(img).toHaveAttribute('src', /^blob:/);
    // Decoded (the CSP allows blob: images) at 2in × 1in = 192 × 96 CSS px.
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBe(600);
    expect(
      await img.evaluate((el: HTMLElement) => [el.offsetWidth, el.offsetHeight])
    ).toEqual([192, 96]);
    expect(errors).toEqual([]);
  });

  test('a file pdflatex can’t include is refused with a reason', async ({
    page,
  }) => {
    await openExplorer(page);
    await images(page)
      .locator('.add-image-input')
      .setInputFiles({
        name: 'anim.gif',
        mimeType: 'image/gif',
        buffer: Buffer.from('GIF89a\x01\x00\x01\x00'),
      });
    await expect(images(page)).toContainText(
      'anim.gif isn’t an image pdflatex can include: use PNG, JPEG or PDF.'
    );
    await expect(imageList(page).getByRole('listitem')).toHaveCount(0);
  });

  test('a missing image is a framed box and an error marker', async ({
    page,
  }) => {
    await setSource(page, doc('\\includegraphics[width=2in]{nowhere}'));
    const box = preview(page).locator('.graphic.placeholder');
    await expect(box).toHaveText('nowhere');
    expect(await box.evaluate((el) => (el as HTMLElement).offsetWidth)).toBe(
      192
    );
    await expect(page.locator('latex-editor .squiggly-error')).toHaveCount(1);
  });

  test('pasting an image adds it to the open document', async ({ page }) => {
    await openExplorer(page);
    const png = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(4, 2);
      canvas.getContext('2d')!.fillRect(0, 0, 4, 2);
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const data = new DataTransfer();
      data.items.add(new File([blob], 'image.png', { type: 'image/png' }));
      document.body.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true })
      );
      return blob.size;
    });
    expect(png).toBeGreaterThan(0);
    await expect(imageList(page).getByRole('listitem')).toHaveText([
      /pasted-image\.png\s*PNG · 4 × 2 px/,
    ]);
  });

  test('images belong to their document; another document can reuse them', async ({
    page,
  }) => {
    await openExplorer(page);
    await addFiles(page, [PLOT]);
    await expect(imageList(page).getByRole('listitem')).toHaveCount(1);
    await page.getByRole('button', { name: 'New document' }).click();
    await expect(imageList(page).getByRole('listitem')).toHaveCount(0);
    await images(page).getByText('Reuse from another document').click();
    await images(page)
      .getByRole('button', { name: 'Add plot.png to this document' })
      .click();
    await expect(imageList(page).getByRole('listitem')).toHaveText([
      /plot\.png/,
    ]);
    // Deleting the first document leaves the reused image in this one.
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Delete A Short Example' }).click();
    await expect(imageList(page).getByRole('listitem')).toHaveText([
      /plot\.png/,
    ]);
    await page.reload();
    await editorReady(page);
    await openExplorer(page);
    await expect(imageList(page).getByRole('listitem')).toHaveText([
      /plot\.png/,
    ]);
  });

  test('renaming an image changes the name \\includegraphics uses', async ({
    page,
  }) => {
    await openExplorer(page);
    await addFiles(page, [PLOT]);
    await setSource(page, doc('\\includegraphics{energy}'));
    await expect(preview(page).locator('.placeholder')).toHaveText('energy');
    await images(page).getByRole('button', { name: 'Rename plot.png' }).click();
    const input = images(page).getByRole('textbox', { name: 'Image name' });
    await input.fill('energy');
    await input.press('Enter');
    await expect(imageList(page).getByRole('listitem')).toHaveText([
      /energy\.png/,
    ]);
    await expect(preview(page).locator('img.graphic')).toHaveAttribute(
      'alt',
      'energy.png'
    );
  });
});
