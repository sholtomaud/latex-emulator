import { test, expect } from '@playwright/test';
import { editorReady, setSource } from '../support/editor.ts';

const SOURCE = String.raw`\documentclass[preprint,12pt]{elsarticle}
\journal{Ecological Modelling}
\date{4 November 2026}
\begin{document}
\begin{frontmatter}
\title{Energy flows}
\author[a]{Ada Lovelace\corref{cor1}}
\ead{ada@example.org}
\cortext[cor1]{Corresponding author}
\address[a]{Dept A}
\begin{abstract}
We measure.
\end{abstract}
\begin{keyword}
emergy \sep estuary
\end{keyword}
\end{frontmatter}
\section{Introduction}
Text.
\end{document}`;

test.describe('elsarticle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await editorReady(page);
  });

  test('the frontmatter is typeset as elsarticle’s title block, with no class warning', async ({
    page,
  }) => {
    await setSource(page, SOURCE);
    const doc = page.frameLocator('latex-preview iframe');
    await expect(doc.locator('.els-title')).toHaveText('Energy flows');
    await expect(doc.locator('.els-authors')).toHaveText('Ada Lovelacea,∗');
    await expect(doc.locator('.els-keywords')).toHaveText(
      'Keywords:  emergy, estuary'
    );
    await expect(doc.getByRole('heading', { level: 2 })).toHaveText(
      '1.Introduction'
    );
    await expect(doc.locator('section.footnotes p')).toHaveText([
      '∗Corresponding author',
      'Email address: ada@example.org (Ada Lovelace)',
    ]);
    await expect(page.locator('latex-editor .squiggly-warning')).toHaveCount(0);
  });

  test('the first printed page gets "Preprint submitted to …" and the date', async ({
    page,
  }) => {
    await setSource(page, SOURCE);
    const frame = page.frameLocator('latex-preview iframe');
    await expect(frame.locator('.els-title')).toHaveText('Energy flows');
    const css = await frame
      .locator('style')
      .evaluateAll((styles) => styles.map((s) => s.textContent).join('\n'));
    expect(css).toMatch(
      /@page :first \{[\s\S]*@bottom-left \{[^}]*content: "Preprint submitted to Ecological Modelling";[\s\S]*@bottom-right \{[^}]*content: "4 November 2026";/
    );
  });
});
