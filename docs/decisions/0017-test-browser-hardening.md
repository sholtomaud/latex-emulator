# 0017: Hardening the test browser

## Context

Playwright runs a Chromium build that can lag behind Chrome's security
fixes, and it launches Chromium with its sandbox **off** unless asked
(`chromiumSandbox` defaults to false). A test browser that loaded hostile
web content could then reach the machine it runs on.

Our exposure was already small:
- the suites load only our own app on localhost, and the Pages suite our
  own GitHub Pages site;
- the bibliography, Zotero and typeahead specs mock doi.org and Zotero with
  `page.route`;
- CI runs every suite in the pinned Playwright container.

But nothing *enforced* that a test stays off the internet, and
`npm run e2e`, `e2e:smoke` and `e2e:pages` ran the browser directly on the
developer's machine, unsandboxed.

## Decision

- **Network guard** (`playwright.config.ts`). Every browser request goes
  through a proxy that does not exist (`http://127.0.0.1:1`, which refuses
  connections), except localhost and the live Pages host (from `PAGES_URL`).
  The guard is in the browser's launch options, so no spec can forget it,
  and IP literals and iframes are covered too. `page.route` mocks answer
  before the proxy, so the specs that mock doi.org and Zotero are
  unchanged. `e2e/specs/network-guard.spec.ts` checks it, in dev and prod:
  - a server on this machine's own non-loopback address can't be reached.
    This is the real check: it needs no internet, and it failed before the
    guard;
  - an outside URL and an IP literal can't be opened;
  - the app's `fetch` to doi.org, which its CSP allows, is blocked;
  - a `page.route` mock still answers.
- **Sandbox on where it can be.** `chromiumSandbox` is on unless running as
  root. The CI and Docker containers run as root, where Chromium's sandbox
  cannot start. `PW_CHROMIUM_NO_SANDBOX=1` opts out on hosts that forbid it,
  for example Ubuntu with AppArmor restricting unprivileged user namespaces
  ("No usable sandbox!").
- **Local runs in the container by default.** `npm run e2e`, `e2e:smoke` and
  `e2e:pages` now run in the pinned image through
  `scripts/playwright-docker.sh`, as `e2e:visual` already did. `e2e:host`,
  `e2e:smoke:host` and `e2e:pages:host` run on the host (with the guard and
  the sandbox) for quick iteration. The wrapper now:
  - passes arguments with their quoting intact (`-g "two words"`);
  - forwards `PAGES_URL`;
  - mounts a `NODE_EXTRA_CA_CERTS` bundle for `npm ci` behind TLS-inspecting
    proxies.

  CI is unchanged: it already runs `npx playwright test` inside the pinned
  container.

## Consequences

- No test can depend on the internet. A spec that needs an outside service
  must mock it with `page.route`, and an unmocked call fails visibly. The
  smoke test already fails on any failed request.
- Inside containers the browser is still unsandboxed. The container and the
  network guard are the protection there. Running the container as the
  image's non-root `pwuser` with a seccomp profile that allows the sandbox
  is a possible next step (in `docs/backlog.md`).
- Local e2e needs Docker by default. The `:host` scripts remain for when
  it's unavailable.
- Upgrading Playwright promptly matters most. Track releases that ship a
  patched Chromium, and bump `@playwright/test` and `playwright` together;
  the CI image follows the version in `package.json`.
