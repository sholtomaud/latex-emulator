/** Semantic versions and content hashes for document snapshots. */

export type Bump = 'patch' | 'minor' | 'major';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseVersion(v: string): [number, number, number] | null {
  const m = SEMVER.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function bumpVersion(v: string, bump: Bump): string {
  const p = parseVersion(v);
  if (!p) throw new Error(`Not a semantic version: ${v}`);
  const [major, minor, patch] = p;
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * The version after `latest`. The first one counts from 0.0.0, so it
 * follows the bump asked for: patch 0.0.1, minor 0.1.0, major 1.0.0.
 */
export function nextVersion(latest: string | undefined, bump: Bump): string {
  return bumpVersion(latest ?? '0.0.0', bump);
}

/** What saving a version did, in words for the Versions panel. */
export function versionSavedMessage(
  saved: { version: string; created: boolean },
  bump: Bump
): string {
  if (saved.created) return `Saved version ${saved.version}.`;
  // Only a patch reuses a version: unchanged text has nothing to patch.
  return `No changes since ${saved.version}, so there is nothing new to save as a ${bump}. To mark the same text as a new release, choose Minor or Major.`;
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? [0, 0, 0];
  const pb = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** SHA-256 of the UTF-8 bytes of `text`, as lower-case hex (= `shasum -a 256`). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
}

/** The first 16 hex digits (64 bits), shown where the full hash won't fit. */
export function shortHash(sha256: string): string {
  return sha256.slice(0, 16);
}
