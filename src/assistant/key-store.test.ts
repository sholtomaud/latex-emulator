import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { KeyStore } from './key-store.ts';
import type { PasswordManager } from './key-store.ts';

/** A browser password manager holding one saved password for the site. */
function fakeManager(saved: string | null = null) {
  const calls: string[] = [];
  const manager: PasswordManager & { saved: string | null; calls: string[] } = {
    saved,
    calls,
    async load() {
      calls.push('load');
      return manager.saved;
    },
    async save(password: string) {
      calls.push('save');
      manager.saved = password;
    },
  };
  return manager;
}

describe('KeyStore', () => {
  test('without a password manager, keys last for the session only', async () => {
    const keys = new KeyStore(null);
    assert.equal(keys.canRemember, false);
    await keys.set('anthropic', 'sk-1', true);
    assert.equal(keys.get('anthropic'), 'sk-1');
    assert.equal(keys.get('gemini'), '');
    await keys.set('anthropic', '', false);
    assert.equal(keys.get('anthropic'), '');
  });

  test('remembered keys are saved together as one password, never others', async () => {
    const m = fakeManager();
    const keys = new KeyStore(m);
    assert.equal(keys.canRemember, true);
    await keys.set('anthropic', 'sk-1', true);
    await keys.set('openrouter', 'or-1', false);
    await keys.set('gemini', 'g-1', true);
    assert.deepEqual(JSON.parse(m.saved!), {
      anthropic: 'sk-1',
      gemini: 'g-1',
    });
    assert.equal(keys.remembered('gemini'), true);
    assert.equal(keys.remembered('openrouter'), false);
    // Forgetting one saves the rest.
    await keys.set('gemini', 'g-1', false);
    assert.deepEqual(JSON.parse(m.saved!), { anthropic: 'sk-1' });
    assert.equal(keys.get('gemini'), 'g-1');
  });

  test('saved keys are read from the password manager once, on request', async () => {
    const m = fakeManager('{"anthropic":"sk-saved","x":"ignored","gemini":4}');
    const keys = new KeyStore(m);
    assert.equal(keys.get('anthropic'), '');
    assert.equal(await keys.unlock(), true);
    assert.equal(await keys.unlock(), true);
    assert.deepEqual(m.calls, ['load']);
    assert.equal(keys.get('anthropic'), 'sk-saved');
    assert.equal(keys.get('gemini'), '');
    assert.equal(keys.remembered('anthropic'), true);
    // A key typed this session wins over the saved one.
    await keys.set('anthropic', 'sk-new', true);
    assert.equal(keys.get('anthropic'), 'sk-new');
  });

  test('nothing saved, garbage saved, or a refusal: no keys, no crash', async () => {
    for (const saved of [null, 'not json', '[1]']) {
      const keys = new KeyStore(fakeManager(saved));
      assert.equal(await keys.unlock(), saved !== null, String(saved));
      assert.equal(keys.get('anthropic'), '');
    }
    const refusing: PasswordManager = {
      load: async () => {
        throw new Error('NotAllowedError');
      },
      save: async () => {
        throw new Error('NotAllowedError');
      },
    };
    const keys = new KeyStore(refusing);
    assert.equal(await keys.unlock(), false);
    await assert.rejects(keys.set('anthropic', 'k', true), /NotAllowedError/);
    // The key still works for this session.
    assert.equal(keys.get('anthropic'), 'k');
  });

  test('the change event fires on every change', async () => {
    const keys = new KeyStore(null);
    let n = 0;
    keys.addEventListener('change', () => n++);
    await keys.set('local', 'k', false);
    assert.equal(n, 1);
  });
});
