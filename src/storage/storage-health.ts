/**
 * What to tell the user about where their documents live (ADR 0019): are
 * they protected from the browser's automatic clean-up, how full is the
 * storage, and how long since the last workspace backup. Pure: the browser
 * facts (navigator.storage, the backup time) are gathered elsewhere.
 */

export interface StorageFacts {
  /** navigator.storage.persisted(); null when the browser can't say. */
  persisted: boolean | null;
  /** navigator.storage.estimate(), in bytes; null when unknown. */
  usage: number | null;
  quota: number | null;
  /** When the last workspace backup was downloaded (ms since the epoch). */
  lastBackupAt: number | null;
  /** The most recent document edit, null with no documents. */
  lastEditAt: number | null;
  /** The oldest document's creation. */
  firstCreatedAt: number | null;
  now: number;
}

export interface StorageHealth {
  /** 'warn' when the user should back up or free space now. */
  level: 'ok' | 'warn';
  protection: string;
  /** '' when the browser gives no estimate. */
  usage: string;
  backup: string;
}

const DAY = 24 * 60 * 60 * 1000;
/** Edits this old with no backup newer than them earn a warning. */
const BACKUP_DUE = 7 * DAY;
const NEARLY_FULL = 0.8;

export function formatBytes(bytes: number): string {
  const units = ['KB', 'MB', 'GB'];
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function daysAgo(then: number, now: number): string {
  const days = Math.floor((now - then) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function storageHealth(f: StorageFacts): StorageHealth {
  const protection =
    f.persisted === true
      ? 'Protected from the browser’s automatic clean-up.'
      : f.persisted === false
        ? 'Not protected: the browser may clear it to free space. Back up often.'
        : 'This browser can’t protect it from clean-up. Back up often.';

  let usage = '';
  let full = false;
  if (f.usage !== null && f.quota) {
    full = f.usage / f.quota >= NEARLY_FULL;
    usage = `Using ${formatBytes(f.usage)} of ${formatBytes(f.quota)}${full ? ': nearly full' : ''}.`;
  }

  const backup =
    f.lastBackupAt === null
      ? 'No backup yet.'
      : `Last backup ${daysAgo(f.lastBackupAt, f.now)}.`;
  // Unsaved work at risk: edits newer than the last backup, which (or the
  // first document, if there was never one) is more than a week old.
  const since = f.lastBackupAt ?? f.firstCreatedAt;
  const due =
    f.lastEditAt !== null &&
    since !== null &&
    f.lastEditAt > (f.lastBackupAt ?? -Infinity) &&
    f.now - since > BACKUP_DUE;

  return { level: full || due ? 'warn' : 'ok', protection, usage, backup };
}
