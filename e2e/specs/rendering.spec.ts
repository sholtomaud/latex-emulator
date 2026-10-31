import { test, expect } from '@playwright/test';
import { setSource } from '../support/editor.ts';

test.describe('LaTeX rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('the sample renders as a typeset article', async ({ page }) => {
    const doc = page.frameLocator('latex-preview iframe');
    await expect(doc.locator('header.maketitle .title')).toHaveText(
      'A Short Example'
    );
    await expect(doc.locator('header.maketitle .author')).toHaveText(
      'Ada Lovelace'
    );
    await expect(doc.getByRole('heading', { level: 2 }).first()).toHaveText(
      '1Introduction'
    );
    await expect(doc.locator('h3.subsection .secnum')).toHaveText('1.1');
    await expect(doc.locator('ul.itemize > li')).toHaveCount(3);
    await expect(doc.locator('ol.enumerate .item-label').first()).toHaveText(
      '1.'
    );
    // No raw LaTeX leaks into the page.
    await expect(doc.locator('article')).not.toContainText('\\section');
    await expect(doc.locator('article')).not.toContainText('\\maketitle');
  });

  test('Latin Modern fonts are loaded and used', async ({ page }) => {
    const iframe = page.locator('latex-preview iframe');
    await expect(
      page.frameLocator('latex-preview iframe').locator('article p').first()
    ).toBeVisible();
    const frame = (await (await iframe.elementHandle())!.contentFrame())!;
    await expect
      .poll(() =>
        frame.evaluate(async () => {
          await document.fonts.ready;
          return document.fonts.check('11pt "LM Roman 10"');
        })
      )
      .toBe(true);
    const family = await frame.evaluate(
      () => getComputedStyle(document.querySelector('article p')!).fontFamily
    );
    expect(family).toContain('LM Roman 10');
  });

  test('edits re-render the document', async ({ page }) => {
    await setSource(page, '\\section{Fresh}\nText with \\emph{emphasis}.');
    const doc = page.frameLocator('latex-preview iframe');
    await expect(doc.getByRole('heading', { level: 2 })).toHaveCount(1);
    await expect(doc.getByRole('heading', { level: 2 })).toHaveText('1Fresh');
    await expect(doc.locator('article em')).toHaveText('emphasis');
  });
});

test.describe('preview scaling', () => {
  /** Text of each visual line's first word, in document order. */
  const lineStarts = async (page: import('@playwright/test').Page) => {
    const frame = (await (await page
      .locator('latex-preview iframe')
      .elementHandle())!.contentFrame())!;
    return frame.evaluate(async () => {
      await document.fonts.ready;
      const starts: string[] = [];
      for (const para of document.querySelectorAll('article p')) {
        const walker = document.createTreeWalker(para, NodeFilter.SHOW_TEXT);
        let lastTop: number | null = null;
        for (let n = walker.nextNode(); n; n = walker.nextNode())
          for (const m of n.textContent!.matchAll(/\S+/g)) {
            const r = document.createRange();
            r.setStart(n, m.index!);
            r.setEnd(n, m.index! + 1);
            const rect = r.getClientRects()[0];
            if (lastTop === null || rect.top > lastTop + rect.height / 2)
              starts.push(m[0]);
            lastTop = rect.top;
          }
      }
      return starts;
    });
  };

  test('a scaled-down preview breaks lines exactly like the full-size page', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1900, height: 1000 });
    await page.goto('/');
    await expect(
      page.frameLocator('latex-preview iframe').locator('.date')
    ).toBeVisible();
    const full = await lineStarts(page);
    await page.setViewportSize({ width: 1000, height: 1000 });
    await page.waitForTimeout(300);
    expect(await lineStarts(page)).toEqual(full);
  });
});
