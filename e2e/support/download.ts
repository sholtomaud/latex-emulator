import type { Page } from '@playwright/test';

export type DownloadName =
  | 'Download PDF'
  | 'Download Preprint'
  | 'Download project (.zip)'
  | 'Download .tex';

/** Choose a download from the toolbar's Download menu. */
export async function chooseDownload(page: Page, name: DownloadName) {
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Download' })
    .getByRole('menuitem', { name })
    .click();
}
