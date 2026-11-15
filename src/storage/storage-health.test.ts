import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, storageHealth } from './storage-health.ts';
import type { StorageFacts } from './storage-health.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 15, 12);

const facts = (f: Partial<StorageFacts> = {}): StorageFacts => ({
  persisted: true,
  usage: 2_500_000,
  quota: 10_000_000_000,
  lastBackupAt: NOW - DAY / 2,
  lastEditAt: NOW - DAY / 4,
  firstCreatedAt: NOW - 30 * DAY,
  now: NOW,
  ...f,
});

describe('storageHealth', () => {
  test('protected, backed up today: all fine', () => {
    const h = storageHealth(facts());
    assert.equal(h.level, 'ok');
    assert.equal(
      h.protection,
      'Protected from the browser’s automatic clean-up.'
    );
    assert.equal(h.usage, 'Using 2.4 MB of 9.3 GB.');
    assert.equal(h.backup, 'Last backup today.');
  });

  test('says when the browser has not protected the data, or cannot', () => {
    assert.equal(
      storageHealth(facts({ persisted: false })).protection,
      'Not protected: the browser may clear it to free space. Back up often.'
    );
    assert.equal(
      storageHealth(facts({ persisted: null })).protection,
      'This browser can’t protect it from clean-up. Back up often.'
    );
    // Not protected alone isn't a warning: Chrome often says no at first.
    assert.equal(storageHealth(facts({ persisted: false })).level, 'ok');
  });

  test('counts the days since the last backup', () => {
    assert.equal(
      storageHealth(facts({ lastBackupAt: NOW - 1.5 * DAY })).backup,
      'Last backup yesterday.'
    );
    assert.equal(
      storageHealth(facts({ lastBackupAt: NOW - 3.2 * DAY })).backup,
      'Last backup 3 days ago.'
    );
    assert.equal(
      storageHealth(facts({ lastBackupAt: null })).backup,
      'No backup yet.'
    );
  });

  test('warns when edits have gone a week without a backup', () => {
    const stale = facts({ lastBackupAt: NOW - 8 * DAY, lastEditAt: NOW - DAY });
    assert.equal(storageHealth(stale).level, 'warn');
    // Nothing changed since that backup: nothing to lose.
    assert.equal(
      storageHealth({ ...stale, lastEditAt: NOW - 9 * DAY }).level,
      'ok'
    );
    // Never backed up: a week after the first document.
    assert.equal(
      storageHealth(facts({ lastBackupAt: null, firstCreatedAt: NOW - DAY }))
        .level,
      'ok'
    );
    assert.equal(
      storageHealth(
        facts({ lastBackupAt: null, firstCreatedAt: NOW - 8 * DAY })
      ).level,
      'warn'
    );
    assert.equal(
      storageHealth(facts({ lastBackupAt: null, lastEditAt: null })).level,
      'ok'
    );
  });

  test('warns when storage is nearly full, and copes without an estimate', () => {
    const full = storageHealth(facts({ usage: 850, quota: 1000 }));
    assert.equal(full.level, 'warn');
    assert.equal(full.usage, 'Using 850 B of 1000 B: nearly full.');
    assert.equal(storageHealth(facts({ usage: null, quota: null })).usage, '');
    assert.equal(storageHealth(facts({ usage: 5, quota: 0 })).usage, '');
  });
});

describe('formatBytes', () => {
  test('binary units, one decimal from KB up', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1023), '1023 B');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(5 * 1024 ** 3), '5.0 GB');
    assert.equal(formatBytes(3 * 1024 ** 4), '3072.0 GB');
  });
});
