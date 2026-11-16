import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  Vault,
  encryptedBackend,
  rememberWhere,
  vaultSection,
} from './vault.ts';
import type { VaultBackend } from './vault.ts';
import { SecretStore } from './secret-store.ts';
import type { SealedSecret, SecretKv } from './secret-store.ts';

function memoryBackend(
  kind: VaultBackend['kind'],
  initial: string | null = null
): VaultBackend & { text: string | null; loads: number; saves: number } {
  const b = {
    kind,
    text: initial,
    loads: 0,
    saves: 0,
    async load() {
      b.loads++;
      return b.text;
    },
    async save(text: string) {
      b.saves++;
      b.text = text;
    },
  };
  return b;
}

describe('Vault', () => {
  test('one blob holds every remembered secret; saving one keeps the others', async () => {
    const backend = memoryBackend(
      'password-manager',
      JSON.stringify({ anthropic: 'sk-1' })
    );
    const vault = new Vault(backend);
    await vault.put('zotero-plugin-token', 'tok');
    assert.deepStrictEqual(JSON.parse(backend.text!), {
      anthropic: 'sk-1',
      'zotero-plugin-token': 'tok',
    });
    assert.strictEqual(await vault.get('anthropic'), 'sk-1');
    await vault.put('anthropic', null);
    assert.deepStrictEqual(JSON.parse(backend.text!), {
      'zotero-plugin-token': 'tok',
    });
  });

  test('the backend is read once (it may ask the user), then cached', async () => {
    const backend = memoryBackend(
      'password-manager',
      JSON.stringify({ a: '1' })
    );
    const vault = new Vault(backend);
    await Promise.all([vault.get('a'), vault.get('b'), vault.entries()]);
    await vault.get('a');
    assert.strictEqual(backend.loads, 1);
  });

  test('cached() answers only from what was already read, never asking', async () => {
    const backend = memoryBackend(
      'password-manager',
      JSON.stringify({ a: '1' })
    );
    const vault = new Vault(backend);
    assert.strictEqual(vault.cached('a'), undefined); // not read yet
    assert.strictEqual(backend.loads, 0);
    await vault.get('a');
    assert.strictEqual(vault.cached('a'), '1');
    assert.strictEqual(vault.cached('b'), null);
    await vault.put('b', '2');
    assert.strictEqual(vault.cached('b'), '2');
    assert.strictEqual(backend.loads, 1);
  });

  test('says how it remembers, or that it can’t', () => {
    assert.strictEqual(
      new Vault(memoryBackend('password-manager')).how,
      'password-manager'
    );
    assert.strictEqual(new Vault(memoryBackend('encrypted')).how, 'encrypted');
    const none = new Vault(null);
    assert.strictEqual(none.how, null);
    assert.strictEqual(none.canRemember, false);
  });

  test('without a backend nothing is stored, and nothing fails', async () => {
    const vault = new Vault(null);
    await vault.put('x', 'y');
    assert.strictEqual(await vault.get('x'), null);
  });

  test('garbage, non-string values or a refused read: treated as empty, never trusted', async () => {
    for (const text of [
      '{broken',
      '[1,2]',
      '"str"',
      JSON.stringify({ a: 5, b: 'ok' }),
    ]) {
      const vault = new Vault(memoryBackend('encrypted', text));
      assert.strictEqual(await vault.get('a'), null, text);
    }
    assert.strictEqual(
      await new Vault(
        memoryBackend('encrypted', JSON.stringify({ a: 5, b: 'ok' }))
      ).get('b'),
      'ok'
    );
    const refusing: VaultBackend = {
      kind: 'password-manager',
      load: async () => {
        throw new Error('NotAllowedError');
      },
      save: async () => {},
    };
    assert.strictEqual(await new Vault(refusing).get('a'), null);
  });

  test('a failed read is retried next time (the user may have dismissed the prompt)', async () => {
    let fail = true;
    const backend: VaultBackend = {
      kind: 'password-manager',
      load: async () => {
        if (fail) throw new Error('dismissed');
        return JSON.stringify({ a: '1' });
      },
      save: async () => {},
    };
    const vault = new Vault(backend);
    assert.strictEqual(await vault.get('a'), null);
    fail = false;
    assert.strictEqual(await vault.get('a'), '1');
  });
});

describe('vaultSection: the assistant’s keys as one part of the vault', () => {
  test('load gives only its names; save replaces only its names', async () => {
    const backend = memoryBackend(
      'password-manager',
      JSON.stringify({ anthropic: 'sk-1', 'zotero-plugin-token': 'tok' })
    );
    const vault = new Vault(backend);
    const section = vaultSection(vault, ['anthropic', 'gemini']);
    assert.deepStrictEqual(JSON.parse((await section.load())!), {
      anthropic: 'sk-1',
    });
    await section.save(JSON.stringify({ gemini: 'g-1' }));
    assert.deepStrictEqual(JSON.parse(backend.text!), {
      gemini: 'g-1',
      'zotero-plugin-token': 'tok',
    });
  });

  test('a section save writes once (each write may make the browser ask)', async () => {
    const backend = memoryBackend('password-manager');
    const section = vaultSection(new Vault(backend), ['a', 'b', 'c']);
    await section.save(JSON.stringify({ a: '1', b: '2' }));
    assert.strictEqual(backend.saves, 1);
  });

  test('nothing of its own saved reads as nothing (null)', async () => {
    const vault = new Vault(
      memoryBackend('encrypted', JSON.stringify({ other: 'x' }))
    );
    assert.strictEqual(await vaultSection(vault, ['anthropic']).load(), null);
  });

  test('a section save that is not an object is refused', async () => {
    const section = vaultSection(new Vault(memoryBackend('encrypted')), ['a']);
    await assert.rejects(section.save('[1]'), /object/);
  });
});

describe('encryptedBackend: the fallback without a password manager', () => {
  test('stores the blob through SecretStore, encrypted', async () => {
    const rows = new Map<string, SealedSecret>();
    const kv: SecretKv = {
      get: async (n) => rows.get(n),
      put: async (n, v) => void rows.set(n, v),
      delete: async (n) => void rows.delete(n),
    };
    const backend = encryptedBackend(new SecretStore(kv, crypto.subtle));
    assert.strictEqual(backend.kind, 'encrypted');
    assert.strictEqual(await backend.load(), null);
    await backend.save('{"a":"1"}');
    assert.strictEqual(rows.size, 1);
    // A new session decrypts it.
    assert.strictEqual(
      await encryptedBackend(new SecretStore(kv, crypto.subtle)).load(),
      '{"a":"1"}'
    );
  });
});

test('the Remember options say where the secret will be kept', () => {
  assert.strictEqual(
    rememberWhere('password-manager'),
    'in this browser’s password manager'
  );
  assert.strictEqual(
    rememberWhere('encrypted'),
    'on this device (stored encrypted)'
  );
  assert.strictEqual(rememberWhere(null), '');
});
