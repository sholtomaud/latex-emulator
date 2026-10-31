import './styles/app.css';
import { Router } from './core/router/router.ts';
import { resolveBaseUrl } from './util/base-url.ts';

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
