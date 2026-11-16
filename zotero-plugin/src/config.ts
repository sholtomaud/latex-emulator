/**
 * The plugin's settings, kept in Zotero's preferences as text: the paired
 * clients and the extra sites allowed to connect. Everything read back is
 * checked, because preferences can be edited by hand (ADR 0024 §3).
 */
import { MCP_URL, SCOPES } from './protocol.ts';
import type { Scope } from './protocol.ts';
import type { Client, PairingRequest } from './server.ts';

const isScope = (s: unknown): s is Scope =>
  (SCOPES as readonly unknown[]).includes(s);

export function parseClients(raw: unknown): Client[] {
  let list: unknown;
  try {
    list = typeof raw === 'string' ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list.filter((c): c is Client => {
    if (typeof c !== 'object' || c === null) return false;
    const r = c as Record<string, unknown>;
    return (
      typeof r.id === 'string' &&
      typeof r.name === 'string' &&
      r.name.length > 0 &&
      (r.origin === null || typeof r.origin === 'string') &&
      typeof r.token === 'string' &&
      r.token.length >= 20 &&
      Array.isArray(r.scopes) &&
      r.scopes.every(isScope) &&
      typeof r.createdAt === 'number'
    );
  });
}

export const siteOrigin = (site: string) => new URL(site).origin;

/** The app's own origin first, then each valid http(s) origin the user listed. */
export function parseOrigins(raw: unknown, site: string): string[] {
  const origins = [siteOrigin(site)];
  for (const line of typeof raw === 'string' ? raw.split('\n') : []) {
    const value = line.trim();
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || url.origin !== value) continue;
    if (!origins.includes(value)) origins.push(value);
  }
  return origins;
}

/** A token from 32 random bytes (the caller supplies them from a CSPRNG). */
export function tokenFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error('A token needs 32 bytes.');
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const ABILITIES: Record<Scope, string> = {
  read: 'search and read your library',
  'write-notes': 'create and change zettels (notes in your Zettelkasten)',
  'write-items': 'create and change items and collections',
};

/** The text of Zotero's pairing dialog. */
export function pairingPrompt(r: PairingRequest): string {
  const who = r.origin
    ? `“${r.name}” at ${r.origin}`
    : `“${r.name}”, a program on this computer,`;
  return [
    `${who} wants to connect to Zotero.`,
    '',
    `It will be able to: ${r.scopes.map((s) => ABILITIES[s]).join('; ')}.`,
    '',
    `Check that it shows this code: ${r.code.split('').join(' ')}`,
    '',
    'Allow it only if you just clicked Connect there.',
  ].join('\n');
}

/** What to paste into a terminal to give Claude Code this library. */
export function mcpCommand(token: string): string {
  return `claude mcp add --transport http zotero ${MCP_URL} --header "Authorization: Bearer ${token}"`;
}
