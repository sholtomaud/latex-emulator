import { describe, test } from 'node:test';
import assert from 'node:assert';
import { printRequests, requestPrint } from './print-requests.ts';

describe('printRequests', () => {
  test('requestPrint notifies listeners', () => {
    let count = 0;
    const listener = () => count++;
    printRequests.addEventListener('print', listener);
    requestPrint();
    printRequests.removeEventListener('print', listener);
    requestPrint();
    assert.strictEqual(count, 1);
  });
});
