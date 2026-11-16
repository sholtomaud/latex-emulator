// Write the precache list into a build's sw.js (ADR 0021).
//   node scripts/precache.ts <build dir>
import fs from 'node:fs';
import path from 'node:path';
import { injectPrecache, precacheManifest } from '../src/pwa/precache.ts';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node scripts/precache.ts <build dir>');

const files: { path: string; bytes: Uint8Array }[] = [];
const walk = (sub: string) => {
  for (const e of fs.readdirSync(path.join(dir, sub), {
    withFileTypes: true,
  })) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) walk(rel);
    else files.push({ path: rel, bytes: fs.readFileSync(path.join(dir, rel)) });
  }
};
walk('');

const manifest = await precacheManifest(files);
const sw = path.join(dir, 'sw.js');
fs.writeFileSync(sw, injectPrecache(fs.readFileSync(sw, 'utf8'), manifest));
const bytes = files
  .filter((f) => manifest.files.includes(f.path))
  .reduce((n, f) => n + f.bytes.length, 0);
console.log(
  `sw.js: ${manifest.files.length} files (${(bytes / 1024 / 1024).toFixed(1)} MB), version ${manifest.version}`
);
