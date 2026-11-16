import { test } from 'node:test';
import assert from 'node:assert';
import { SecretStore } from './secret-store.ts';
import type { SealedSecret, SecretKv } from './secret-store.ts';

function memoryKv(): SecretKv & { rows: Map<string, SealedSecret> } {
  const rows = new Map<string, SealedSecret>();
  return {
    rows,
    get: async (name) => rows.get(name),
    put: async (name, value) => void rows.set(name, value),
    delete: async (name) => void rows.delete(name),
  };
}

test('by default a secret lives for this session only: nothing is written', async () => {
  const kv = memoryKv();
  const store = new SecretStore(kv, crypto.subtle);
  await store.set('zotero-plugin', 'tok-123', false);
  assert.strictEqual(await store.get('zotero-plugin'), 'tok-123');
  assert.strictEqual(kv.rows.size, 0);
  assert.strictEqual(await store.remembered('zotero-plugin'), false);
  // A new session (reload) has forgotten it.
  assert.strictEqual(
    await new SecretStore(kv, crypto.subtle).get('zotero-plugin'),
    null
  );
});

test('remembered secrets are stored encrypted, with a key that cannot be exported', async () => {
  const kv = memoryKv();
  await new SecretStore(kv, crypto.subtle).set(
    'zotero-plugin',
    'tok-123',
    true
  );
  const row = kv.rows.get('zotero-plugin')!;
  assert.ok(row, 'stored');
  assert.strictEqual(row.key.extractable, false);
  assert.strictEqual(row.key.algorithm.name, 'AES-GCM');
  assert.ok(!new TextDecoder().decode(row.data).includes('tok-123'));
  await assert.rejects(crypto.subtle.exportKey('raw', row.key));

  // The next session reads it back.
  const next = new SecretStore(kv, crypto.subtle);
  assert.strictEqual(await next.get('zotero-plugin'), 'tok-123');
  assert.strictEqual(await next.remembered('zotero-plugin'), true);
});

test('choosing not to remember, or forgetting, removes the stored copy', async () => {
  const kv = memoryKv();
  const store = new SecretStore(kv, crypto.subtle);
  await store.set('s', 'one', true);
  await store.set('s', 'two', false);
  assert.strictEqual(kv.rows.size, 0);
  assert.strictEqual(await store.get('s'), 'two');
  await store.set('s', 'three', true);
  await store.forget('s');
  assert.strictEqual(kv.rows.size, 0);
  assert.strictEqual(await store.get('s'), null);
});

test('a stored copy that no longer decrypts is dropped, not trusted', async () => {
  const kv = memoryKv();
  await new SecretStore(kv, crypto.subtle).set('s', 'secret', true);
  const row = kv.rows.get('s')!;
  kv.rows.set('s', {
    ...row,
    data: new Uint8Array(row.data.byteLength).buffer,
  });
  assert.strictEqual(await new SecretStore(kv, crypto.subtle).get('s'), null);
  assert.strictEqual(kv.rows.size, 0);
});

test('storage that fails (private mode, blocked) leaves the session copy working', async () => {
  const failing: SecretKv = {
    get: async () => {
      throw new Error('blocked');
    },
    put: async () => {
      throw new Error('blocked');
    },
    delete: async () => {
      throw new Error('blocked');
    },
  };
  const store = new SecretStore(failing, crypto.subtle);
  await assert.rejects(store.set('s', 'x', true), /blocked/);
  assert.strictEqual(await store.get('s'), 'x');
  assert.strictEqual(
    await new SecretStore(failing, crypto.subtle).get('s'),
    null
  );
  await store.forget('s'); // doesn't throw
  assert.strictEqual(await store.get('s'), null);
  // Not remembering never needs storage either.
  await store.set('t', 'y', false);
  assert.strictEqual(await store.get('t'), 'y');
  assert.strictEqual(await store.remembered('t'), false);
});

test('a stored copy that fails to decrypt is dropped even if deleting fails', async () => {
  const kv = memoryKv();
  await new SecretStore(kv, crypto.subtle).set('s', 'secret', true);
  const row = kv.rows.get('s')!;
  const stuck: SecretKv = {
    get: async () => ({ ...row, iv: new Uint8Array(12) }),
    put: async () => {},
    delete: async () => {
      throw new Error('blocked');
    },
  };
  assert.strictEqual(
    await new SecretStore(stuck, crypto.subtle).get('s'),
    null
  );
});
