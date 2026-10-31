/**
 * Tiny per-browser preferences in localStorage. Every access is guarded:
 * storage can be unavailable (private mode, blocked site data).
 */
const PREFIX = 'latex-emulator:';

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}
