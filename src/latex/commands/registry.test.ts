import { describe, test } from 'node:test';
import assert from 'node:assert';
import {
  commandNames,
  environmentNames,
  lookupCommand,
  lookupEnvironment,
  parseSignature,
} from './registry.ts';

describe('command registry', () => {
  test('parses xparse-style signatures', () => {
    assert.deepStrictEqual(parseSignature('s o m'), ['s', 'o', 'm']);
    assert.deepStrictEqual(parseSignature(''), []);
  });

  test('knows Tier-1 commands with signatures and docs', () => {
    const section = lookupCommand('section');
    assert.ok(section);
    assert.deepStrictEqual(section.args, ['s', 'o', 'm']);
    assert.ok(section.doc.length > 0);
  });

  test('knows accents and control symbols', () => {
    assert.strictEqual(lookupCommand("'")?.kind, 'accent');
    assert.ok(lookupCommand('%'));
  });

  test('unknown names return undefined', () => {
    assert.strictEqual(lookupCommand('nonsense'), undefined);
    assert.strictEqual(lookupEnvironment('nonsense'), undefined);
  });

  test('knows environments, including math-mode ones', () => {
    assert.strictEqual(lookupEnvironment('itemize')?.math, false);
    assert.strictEqual(lookupEnvironment('equation*')?.math, true);
  });

  test('lists names for completion', () => {
    assert.ok(commandNames().includes('section'));
    assert.ok(environmentNames().includes('itemize'));
  });
});
