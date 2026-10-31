import { describe, test } from 'node:test';
import assert from 'node:assert';
import { MemoryRepository } from './memory-repository.ts';

const doc = (id: string, updatedAt = 1) => ({
  id,
  name: id,
  source: `src ${id}`,
  createdAt: 1,
  updatedAt,
});

describe('MemoryRepository', () => {
  test('put, get, list and delete', async () => {
    const repo = new MemoryRepository();
    await repo.put(doc('a'));
    await repo.put(doc('b'));
    assert.strictEqual((await repo.get('a'))?.source, 'src a');
    assert.deepStrictEqual((await repo.list()).map((d) => d.id).sort(), [
      'a',
      'b',
    ]);
    await repo.delete('a');
    assert.strictEqual(await repo.get('a'), undefined);
    assert.strictEqual((await repo.list()).length, 1);
  });

  test('stores copies, so callers cannot mutate stored documents', async () => {
    const repo = new MemoryRepository();
    const d = doc('a');
    await repo.put(d);
    d.source = 'changed';
    (await repo.get('a'))!.source = 'changed too';
    assert.strictEqual((await repo.get('a'))!.source, 'src a');
  });
});
