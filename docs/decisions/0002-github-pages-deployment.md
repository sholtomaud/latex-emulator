# 0002: Deploy to GitHub Pages with GitHub Actions

## Context

The app is a static, client-only PWA. GitHub Pages hosts project sites under
`/<repo>/`, has no server-side SPA fallback other than `404.html`, and Boba's
router needs to know that base path.

## Decision

- `deploy.yml` runs on every push to `main` (and on demand). It first calls the
  full CI workflow (`ci.yml` is reusable via `workflow_call`), then builds with
  `npm run build:pages` and deploys with the official `upload-pages-artifact` /
  `deploy-pages` actions. A final job reruns the `pages` Playwright suite
  against the live URL.
- The Pages build uses an **absolute** Vite base (`/<repo>/`). The router base
  comes from `import.meta.env.BASE_URL` (`src/util/base-url.ts`) rather than a
  hostname heuristic, so local tests exercise exactly what ships.
- `404.html` is a copy of `index.html`. With an absolute base, a deep link
  loads the app, and the router renders the route or its own 404.
- The `pages` Playwright suite serves the Pages build under `/latex-emulator/`
  with that fallback, so sub-path bugs are caught in PRs, not after deploy.

## Consequences

- Repository Settings → Pages → Source must be **GitHub Actions** (one-time).
- A red CI on `main` blocks deployment.
- The service worker (milestone 8) must scope itself to the base path.
