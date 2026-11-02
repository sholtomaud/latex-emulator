/**
 * Write the project folders the app's "Download project (.zip)" would make
 * (ADR 0015, phase A), for the starter document and every fixture, so
 * scripts/check-projects.sh can compile them with real pdflatex + bibtex:
 *
 *   node scripts/export-projects.ts <out-dir>
 *
 * Each fixture's .bib files become the references library and its images/
 * files become the document's Images at their base names, as importing them
 * in the app does. The folders come from the same buildProject() the app
 * uses, so this checks the app's layout, not a copy of it.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { buildProject } from '../src/workspace/project.ts';
import type { ProjectInput } from '../src/workspace/project.ts';
import { SAMPLE_DOCUMENT } from '../src/store/sample-document.ts';
import { SAMPLE_REFERENCES } from '../src/store/sample-references.ts';

const out = process.argv[2];
if (!out) throw new Error('usage: node scripts/export-projects.ts <out-dir>');

const inputs: ProjectInput[] = [
  {
    name: 'A Short Example',
    source: SAMPLE_DOCUMENT,
    bibFiles: { references: SAMPLE_REFERENCES },
    images: [],
  },
];
for (const name of readdirSync('fixtures').sort()) {
  const dir = join('fixtures', name);
  if (!existsSync(join(dir, 'input.tex'))) continue;
  const files = readdirSync(dir);
  const imageDir = join(dir, 'images');
  inputs.push({
    name: `fixture ${name}`,
    source: readFileSync(join(dir, 'input.tex'), 'utf8'),
    bibFiles: Object.fromEntries(
      files
        .filter((f) => f.endsWith('.bib'))
        .map((f) => [f.slice(0, -4), readFileSync(join(dir, f), 'utf8')])
    ),
    images: existsSync(imageDir)
      ? readdirSync(imageDir)
          .sort()
          .map((f) => ({
            name: basename(f),
            bytes: readFileSync(join(imageDir, f)),
          }))
      : [],
  });
}

let missing = 0;
for (const input of inputs) {
  const project = buildProject(input);
  for (const name of project.missingBibs) {
    console.error(`${project.folder}: ${name}.bib is not in its library`);
    missing++;
  }
  for (const f of project.files) {
    const path = join(out, f.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, f.bytes);
  }
  console.log(`${project.folder}: ${project.files.length} files`);
}
if (missing) process.exit(1);
