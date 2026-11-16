import './styles/app.css';
import { Router } from './core/router/router.ts';
import { resolveBaseUrl } from './util/base-url.ts';
import { registerServiceWorker } from './pwa/register.ts';
import { updateStore } from './store/update-store.ts';

// Where the app is served from (e.g. /latex-emulator/ on GitHub Pages),
// unless the hosting page already set it.
if (!window.BOBA_BASE_URL) {
  window.BOBA_BASE_URL = resolveBaseUrl({
    buildBase: import.meta.env.BASE_URL,
    hostname: window.location.hostname,
    pathname: window.location.pathname,
  });
}

const router = Router.getInstance();
router.registerRoute({ path: '/', component: 'app-shell' });

router.navigate(router.getAppPath());

// Offline-first (ADR 0021): the app's files are cached by a service worker;
// a release downloaded in the background waits for the user to reload.
registerServiceWorker((apply) => updateStore.setState({ apply }));
