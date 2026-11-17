import type { Page } from '@playwright/test';

export type ViewName =
  | 'Explorer'
  | 'Versions'
  | 'References'
  | 'Storage'
  | 'Comments'
  | 'Assistant setup';

/**
 * Show a view in the primary side bar (ADR 0022), opening the side bar if
 * needed and leaving it open if the view already shows. The Storage tab's
 * name gains "(needs attention)" when it warns, hence the prefix match.
 */
export async function openView(page: Page, name: ViewName) {
  const tab = page
    .getByRole('tablist', { name: 'Side bar views' })
    .getByRole('tab', { name: new RegExp(`^${name}\\b`) });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
}
