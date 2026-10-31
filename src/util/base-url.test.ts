import { describe, test } from 'node:test';
import assert from 'node:assert';
import { resolveBaseUrl } from './base-url.ts';

describe('resolveBaseUrl', () => {
  test('uses an absolute build base (vite --base /repo/)', () => {
    assert.strictEqual(
      resolveBaseUrl({
        buildBase: '/latex-emulator/',
        hostname: 'localhost',
        pathname: '/latex-emulator/',
      }),
      '/latex-emulator/'
    );
  });

  test('adds a missing trailing slash to the build base', () => {
    assert.strictEqual(
      resolveBaseUrl({
        buildBase: '/latex-emulator',
        hostname: 'localhost',
        pathname: '/',
      }),
      '/latex-emulator/'
    );
  });

  test('infers the repo sub-path on github.io for relative builds', () => {
    assert.strictEqual(
      resolveBaseUrl({
        buildBase: './',
        hostname: 'sholtomaud.github.io',
        pathname: '/latex-emulator/some/route',
      }),
      '/latex-emulator/'
    );
  });

  test('falls back to / at a github.io root', () => {
    assert.strictEqual(
      resolveBaseUrl({
        buildBase: './',
        hostname: 'sholtomaud.github.io',
        pathname: '/',
      }),
      '/'
    );
  });

  test('falls back to / for relative builds elsewhere', () => {
    assert.strictEqual(
      resolveBaseUrl({
        buildBase: './',
        hostname: 'localhost',
        pathname: '/anything',
      }),
      '/'
    );
  });
});
