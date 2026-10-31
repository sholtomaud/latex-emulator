import { test } from 'node:test';
import assert from 'node:assert';
import { diagnosticsStore } from './diagnostics-store.ts';

test('diagnosticsStore starts empty and publishes updates', () => {
  assert.deepStrictEqual(diagnosticsStore.getState(), {
    source: '',
    diagnostics: [],
  });
  let seen = '';
  diagnosticsStore.addEventListener('change', ((e: CustomEvent) => {
    seen = e.detail.source;
  }) as EventListener);
  diagnosticsStore.setState({ source: 'x', diagnostics: [] });
  assert.strictEqual(seen, 'x');
});
