import { fileNameFor } from './names.ts';
import { bibliographyFiles, citedKeys } from '../render/bibliography.ts';
import { parseBibCached } from '../latex/bibtex/bib-cache.ts';

/**
 * What the Explorer shows under the open document (ADR 0022): the files of
 * its project folder (ADR 0015), so what you see is what gets saved. Its
 * .tex, and each .bib its \bibliography lists with how many of that file's
 * entries the document cites: the generated subset (ADR 0020). Images come
 * from the image library. Pure.
 */

export interface BibNode {
  file: string;
  /** Entries of the file the document cites (all of them for \nocite{*}). */
  cited: number;
  total: number;
  inLibrary: boolean;
}

export interface DocumentFiles {
  tex: string;
  bibs: BibNode[];
}

export function documentFiles(
  name: string,
  source: string,
  library: Record<string, string>
): DocumentFiles {
  const cited = new Set(citedKeys(source).map((k) => k.toLowerCase()));
  const bibs = [...new Set(bibliographyFiles(source))].map((file) => {
    const text = library[file];
    if (text === undefined)
      return { file: `${file}.bib`, cited: 0, total: 0, inLibrary: false };
    const keys = parseBibCached(text).entries.map((e) => e.key.toLowerCase());
    return {
      file: `${file}.bib`,
      cited: cited.has('*')
        ? keys.length
        : keys.filter((k) => cited.has(k)).length,
      total: keys.length,
      inLibrary: true,
    };
  });
  return { tex: fileNameFor(name), bibs };
}
