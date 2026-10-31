import { describe, test, mock } from 'node:test';
import assert from 'node:assert';
import { debounce } from './debounce.ts';

describe('debounce', () => {
  test('calls once with the latest arguments after the wait', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const calls: number[] = [];
      const debounced = debounce((n: number) => calls.push(n), 100);
      debounced(1);
      debounced(2);
      mock.timers.tick(99);
      assert.deepStrictEqual(calls, []);
      debounced(3);
      mock.timers.tick(100);
      assert.deepStrictEqual(calls, [3]);
    } finally {
      mock.timers.reset();
    }
  });
});
