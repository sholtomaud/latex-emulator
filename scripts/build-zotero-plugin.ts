// Build the Zotero plugin (ADR 0024) into <out>/zotero/:
//   latex-emulator-zotero.xpi  what "Get the Zotero plugin" downloads
//   updates.json               Zotero's update manifest (manifest update_url)
//   node scripts/build-zotero-plugin.ts <out dir>
// The .xpi is a zip of manifest.json, bootstrap.js, the bundled plugin and
// its settings pane. Vite (library mode, IIFE) bundles; no new dependency.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { zip } from '../src/util/zip.ts';

const out = process.argv[2];
if (!out)
  throw new Error('usage: node scripts/build-zotero-plugin.ts <out dir>');

const root = path.resolve(import.meta.dirname, '..');
const pluginDir = path.join(root, 'zotero-plugin');
const meta = JSON.parse(
  fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8')
) as {
  id: string;
  name: string;
  version: string;
  description: string;
  site: string;
  zotero: { min: string; max: string };
};
const xpiUrl = new URL('zotero/latex-emulator-zotero.xpi', meta.site).href;
const updatesUrl = new URL('zotero/updates.json', meta.site).href;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zotero-plugin-'));
async function bundle(entry: string, name: string, file: string) {
  await build({
    configFile: false,
    logLevel: 'warn',
    define: {
      __PLUGIN__: JSON.stringify({
        id: meta.id,
        version: meta.version,
        site: meta.site,
      }),
    },
    build: {
      outDir: tmp,
      emptyOutDir: false,
      minify: false,
      // Zotero 10 runs on Firefox 140 ESR.
      target: 'firefox128',
      lib: {
        entry: path.join(pluginDir, 'src/zotero', entry),
        name,
        formats: ['iife'],
        fileName: () => file,
      },
    },
  });
  return fs.readFileSync(path.join(tmp, file));
}

const manifest = {
  manifest_version: 2,
  name: meta.name,
  version: meta.version,
  description: meta.description,
  homepage_url: meta.site,
  applications: {
    zotero: {
      id: meta.id,
      update_url: updatesUrl,
      strict_min_version: meta.zotero.min,
      strict_max_version: meta.zotero.max,
    },
  },
};

// Zotero calls these; the plugin's own code is in plugin.js.
const bootstrap = `var LatexEmulatorZotero;

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  Services.scriptloader.loadSubScript(rootURI + 'plugin.js');
  LatexEmulatorZotero.startup({ id, version, rootURI });
}

function shutdown() {
  if (LatexEmulatorZotero) LatexEmulatorZotero.shutdown();
  LatexEmulatorZotero = undefined;
}

function install() {}
function uninstall() {}
`;

const text = (s: string) => new TextEncoder().encode(s);
const files = [
  {
    path: 'manifest.json',
    bytes: text(JSON.stringify(manifest, null, 2) + '\n'),
  },
  { path: 'bootstrap.js', bytes: text(bootstrap) },
  {
    path: 'plugin.js',
    bytes: await bundle('main.ts', 'LatexEmulatorZotero', 'plugin.js'),
  },
  {
    path: 'preferences.js',
    bytes: await bundle(
      'preferences.ts',
      'LatexEmulatorPreferences',
      'preferences.js'
    ),
  },
  {
    path: 'preferences.xhtml',
    bytes: fs.readFileSync(
      path.join(pluginDir, 'src/zotero/preferences.xhtml')
    ),
  },
];
fs.rmSync(tmp, { recursive: true, force: true });

const updates = {
  addons: {
    [meta.id]: {
      updates: [
        {
          version: meta.version,
          update_link: xpiUrl,
          applications: { zotero: { strict_min_version: meta.zotero.min } },
        },
      ],
    },
  },
};

const dest = path.join(out, 'zotero');
fs.mkdirSync(dest, { recursive: true });
fs.writeFileSync(
  path.join(dest, 'latex-emulator-zotero.xpi'),
  await zip(files)
);
fs.writeFileSync(
  path.join(dest, 'updates.json'),
  JSON.stringify(updates, null, 2) + '\n'
);
console.log(`Zotero plugin ${meta.version} built in ${dest}`);
