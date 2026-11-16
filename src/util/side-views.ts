/**
 * The primary side bar's views (ADR 0022), and what clicking an activity
 * bar icon does: open that view, or close the side bar if it is the one
 * showing (as in VS Code). Pure.
 */

export const SIDE_VIEWS = [
  'explorer',
  'versions',
  'references',
  'storage',
  // Assistant setup: providers, keys and models (ADR 0023).
  'assistant',
] as const;

export type SideView = (typeof SIDE_VIEWS)[number];

export function parseSideView(value: string | null): SideView {
  return SIDE_VIEWS.find((v) => v === value) ?? 'explorer';
}

export function activateView(
  state: { explorerOpen: boolean; sideView: SideView },
  view: SideView
): { explorerOpen: boolean; sideView: SideView } {
  const showing = state.explorerOpen && state.sideView === view;
  return { explorerOpen: !showing, sideView: view };
}
