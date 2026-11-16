/**
 * Register the service worker (ADR 0021), in production builds only: the
 * Vite dev server serves modules that change on every edit. When a new
 * release has been downloaded in the background, `onUpdate` gets a function
 * that switches to it; the page then reloads once the new worker is in
 * charge. Browser-only wiring; the worker is public/sw.js.
 */
export function registerServiceWorker(
  onUpdate: (apply: () => void) => void
): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  const base = window.BOBA_BASE_URL ?? '/';
  // The first install takes over without a reload (no controller yet);
  // every later change of controller is an update the user asked for.
  let controlled = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  void navigator.serviceWorker
    .register(`${base}sw.js`, { scope: base })
    .then((reg) => {
      const offer = () => {
        const waiting = reg.waiting;
        if (waiting && navigator.serviceWorker.controller)
          onUpdate(() => waiting.postMessage('skip-waiting'));
      };
      offer();
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') offer();
        });
      });
      // Look for a new release whenever the app comes back to the front.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void reg.update();
      });
    })
    .catch((error: unknown) =>
      console.warn('Offline support is unavailable:', error)
    );
}
