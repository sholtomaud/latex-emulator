import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import {
  FIRST_VERSION,
  bumpVersion,
  compareVersions,
  nextVersion,
  parseVersion,
  sha256Hex,
  shortHash,
} from './versions.ts';

describe('semantic versions', () => {
  test('parse and reject invalid versions', () => {
    assert.deepStrictEqual(parseVersion('1.2.3'), [1, 2, 3]);
    assert.strictEqual(parseVersion('1.2'), null);
    assert.strictEqual(parseVersion('v1.2.3'), null);
    assert.strictEqual(parseVersion('01.2.3'), null);
  });

  test('bump patch, minor and major', () => {
    assert.strictEqual(bumpVersion('0.1.0', 'patch'), '0.1.1');
    assert.strictEqual(bumpVersion('0.1.9', 'minor'), '0.2.0');
    assert.strictEqual(bumpVersion('0.4.2', 'major'), '1.0.0');
  });

  test('bumping an invalid version throws', () => {
    assert.throws(() => bumpVersion('x', 'patch'));
  });

  test('the first version is 0.1.0, or 1.0.0 for a major release', () => {
    assert.strictEqual(FIRST_VERSION, '0.1.0');
    assert.strictEqual(nextVersion(undefined, 'patch'), '0.1.0');
    assert.strictEqual(nextVersion(undefined, 'minor'), '0.1.0');
    assert.strictEqual(nextVersion(undefined, 'major'), '1.0.0');
    assert.strictEqual(nextVersion('0.1.0', 'patch'), '0.1.1');
  });

  test('compare orders numerically, not as text', () => {
    assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
    assert.ok(compareVersions('1.0.0', '1.0.0') === 0);
    assert.ok(compareVersions('0.1.2', '0.1.10') < 0);
  });
});

describe('SHA-256', () => {
  test('matches the standard test vector', async () => {
    assert.strictEqual(
      await sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  test('hashes the UTF-8 bytes, exactly as shasum -a 256 does', async () => {
    const text = 'Énergie — \\section{Ü}\n';
    assert.strictEqual(
      await sha256Hex(text),
      createHash('sha256').update(text, 'utf8').digest('hex')
    );
  });

  test('short hashes are the first 16 hex characters', () => {
    assert.strictEqual(
      shortHash('ba7816bf8f01cfea414140de5dae2223'),
      'ba7816bf8f01cfea'
    );
  });
});
