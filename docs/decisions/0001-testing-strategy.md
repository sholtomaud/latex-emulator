# 0001 — Test-driven development with unit, e2e, smoke and visual suites

## Context

The product promises a PDF that looks like LaTeX output, and live tooling
that must not regress as the LaTeX subset grows. Appearance regressions are
invisible to DOM assertions, and pixel output depends on fonts and on the
browser build.

## Decision

- All work is test-driven (red → green → refactor).
- Four suites: unit (`node --test`, with a ≥ 90 % coverage gate on pure
  modules), functional e2e (Playwright against both dev and production
  builds), smoke (Playwright, production build) and visual snapshots
  (Playwright `toHaveScreenshot`).
- Every Playwright suite in CI runs in the pinned
  `mcr.microsoft.com/playwright:v<version>-noble` image. Visual baselines are
  generated only in that image, locally via `scripts/playwright-docker.sh` or
  remotely via the `visual-baselines.yml` workflow.
- Snapshot paths omit the platform suffix, because only one platform (the
  pinned image) is ever valid.

## Consequences

- Contributors need Docker, or the GitHub workflow, to update visual baselines.
- Bumping `@playwright/test` changes the image, so baselines must be
  regenerated in the same PR.
- Components stay thin; logic moves to unit-testable pure modules.
