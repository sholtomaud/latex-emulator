import './styles/app.css';
import { Router } from './core/router/router.ts';

// Setup BASE_URL for the router, unless the page hosting the app already
// set one (e.g. a preview served from a sub-path).
if (!window.BOBA_BASE_URL) {
  const isGitHubPages = window.location.hostname.endsWith('.github.io');
  const pathSegments = window.location.pathname.split('/');
  const repoName =
    isGitHubPages && pathSegments.length > 1 && pathSegments[1]
      ? pathSegments[1]
      : null;
  window.BOBA_BASE_URL = repoName ? `/${repoName}/` : '/';
}

const router = Router.getInstance();
router.registerRoute({ path: '/', component: 'app-shell' });

router.navigate(router.getAppPath());
