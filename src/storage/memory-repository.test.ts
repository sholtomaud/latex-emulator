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

  test('versions are stored per document, newest first, and deleted together', async () => {
    const repo = new MemoryRepository();
    const v = (id: string, documentId: string, createdAt: number) => ({
      id,
      documentId,
      version: '0.1.0',
      createdAt,
      sha256: 'x',
      source: 's',
    });
    await repo.addVersion(v('1', 'a', 1));
    await repo.addVersion(v('2', 'a', 5));
    await repo.addVersion(v('3', 'b', 3));
    assert.deepStrictEqual(
      (await repo.listVersions('a')).map((x) => x.id),
      ['2', '1']
    );
    await repo.deleteVersions('a');
    assert.deepStrictEqual(await repo.listVersions('a'), []);
    assert.strictEqual((await repo.listVersions('b')).length, 1);
  });
});
