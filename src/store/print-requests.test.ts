import { describe, test } from 'node:test';
import assert from 'node:assert';
import { printRequests, requestPrint } from './print-requests.ts';

describe('printRequests', () => {
  test('requestPrint passes the job to listeners', () => {
    let job: unknown;
    const listener = (e: Event) => (job = (e as CustomEvent).detail);
    printRequests.addEventListener('print', listener);
    requestPrint({ title: 't' });
    requestPrint();
    printRequests.removeEventListener('print', listener);
    assert.deepStrictEqual(job, {});
  });

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
