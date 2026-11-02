import { test, expect } from '@playwright/test';
import { editorReady, setSource } from '../support/editor.ts';

const preview = (page: import('@playwright/test').Page) =>
  page.frameLocator('latex-preview iframe');
const doc = (body: string) =>
  `\\documentclass{article}\n\\usepackage{listings}\n\\begin{document}\n${body}\n\\end{document}`;

test.describe('listings', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await editorReady(page);
  });

  test('a Python listing: highlighted after the language data loads, with a numbered caption', async ({
    page,
  }) => {
    await setSource(
      page,
      doc(
        'See Listing~\\ref{l}.\n\\begin{lstlisting}[language=Python, caption={A loop.}, label=l]\nfor i in range(3):  # count\n    print("a b")\n\\end{lstlisting}'
      )
    );
    const listing = preview(page).locator('.lstlisting');
    await expect(listing.locator('.lst-line')).toHaveCount(2);
    // Keywords bold (keywordstyle), comments italic (commentstyle).
    await expect(listing.locator('.lst-u.bf').first()).toHaveText('for');
    await expect(listing.locator('.lst-u.it').first()).toHaveText('#');
    // A visible space in the string.
    await expect(listing.locator('.lst-vs')).toHaveCount(1);
    await expect(listing.locator('.caption')).toHaveText(
      'Listing\u00a01: A loop.'
    );
    await expect(preview(page).locator('article p').first()).toHaveText(
      'See Listing\u00a01.'
    );
    // Fixed columns: "for" fills exactly three columns of 0.6em.
    const [width, fontSize] = await listing
      .locator('.lst-u.bf')
      .first()
      .evaluate((el) => [
        // Layout width (the preview is scaled with a transform).
        parseFloat(getComputedStyle(el).width),
        parseFloat(getComputedStyle(el).fontSize),
      ]);
    expect(Math.abs(width - 1.8 * fontSize)).toBeLessThan(0.05);
  });

  test('\\lstinline sits in the paragraph', async ({ page }) => {
    await setSource(page, doc('Call \\lstinline|f(x)| here.'));
    await expect(preview(page).locator('.lstinline')).toHaveCount(1);
    await expect(preview(page).locator('article p')).toHaveText(
      'Call f(x) here.'
    );
  });

  test('options the emulator ignores are warnings in the editor', async ({
    page,
  }) => {
    await setSource(
      page,
      doc('\\begin{lstlisting}[escapeinside=||]\nx\n\\end{lstlisting}')
    );
    await expect(preview(page).locator('.lst-line')).toHaveCount(1);
    await expect(page.locator('latex-editor .squiggly-warning')).toHaveCount(1);
  });
});
