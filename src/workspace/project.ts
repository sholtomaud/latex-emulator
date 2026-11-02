import { bibliographyFiles } from '../render/bibliography.ts';
import { fileNameFor } from './names.ts';
import type { ZipFile } from '../util/zip.ts';

/**
 * A document as the folder pdflatex needs (ADR 0015): its .tex, the .bib
 * files its \bibliography lists, and its Images next to the .tex at the
 * names \includegraphics uses, which is where ADR 0013 resolves them. The
 * folder compiles with pdflatex + bibtex as it is (checked in CI by
 * scripts/check-projects.sh). The shipped .bst styles are TeX Live's own,
 * so they are not copied. Pure: the zip download and, later, the folder
 * and cloud-drive saves all write this list.
 */

export interface ProjectInput {
  /** The document's name, e.g. "A Short Example". */
  name: string;
  source: string;
  /** The references library: .bib sources by name (without .bib). */
  bibFiles: Record<string, string>;
  /** The document's Images, by stored name. */
  images: { name: string; bytes: Uint8Array }[];
}

export interface Project {
  /** "a-short-example" */
  folder: string;
  /** "a-short-example.zip" */
  fileName: string;
  files: ZipFile[];
  /** Listed in \bibliography but not in the library, so not written. */
  missingBibs: string[];
}

/** A relative name with no way out of the folder. */
const SAFE = /^(?!.*(^|\/)\.{1,2}(\/|$))[^\\/][^\\]*$/;

export function buildProject(input: ProjectInput): Project {
  const folder = fileNameFor(input.name, '');
  const encode = (s: string) => new TextEncoder().encode(s);
  const files: ZipFile[] = [
    { path: `${folder}/${folder}.tex`, bytes: encode(input.source) },
  ];
  const missingBibs: string[] = [];
  for (const name of new Set(bibliographyFiles(input.source))) {
    const source = input.bibFiles[name];
    if (source === undefined || !SAFE.test(name)) missingBibs.push(name);
    else files.push({ path: `${folder}/${name}.bib`, bytes: encode(source) });
  }
  const images = [...input.images].sort((a, b) => a.name.localeCompare(b.name));
  for (const image of images)
    files.push({ path: `${folder}/${image.name}`, bytes: image.bytes });
  return { folder, fileName: `${folder}.zip`, files, missingBibs };
}
