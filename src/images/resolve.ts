/**
 * How graphicx finds the file for \includegraphics{name}: pdftex.def's
 * \DeclareGraphicsExtensions order when the name has no known extension,
 * trying the document's folder and then each \graphicspath directory
 * (\Ginput@path) for every extension.
 */
export const GRAPHICS_EXTENSIONS = [
  '.pdf',
  '.png',
  '.jpg',
  '.mps',
  '.jpeg',
  '.jbig2',
  '.jb2',
  '.PDF',
  '.PNG',
  '.JPG',
  '.JPEG',
  '.JBIG2',
  '.JB2',
] as const;

/** The stored name `arg` refers to, or null if there is none. */
export function resolveGraphic(
  arg: string,
  names: readonly string[],
  graphicsPath: readonly string[] = []
): string | null {
  const have = new Set(names);
  const base = arg.trim().replace(/^(\.\/)+/, '');
  const dirs = [
    '',
    ...graphicsPath.map((d) =>
      d.replace(/^(\.\/)+/, '').replace(/([^/])$/, '$1/')
    ),
  ];
  const known = GRAPHICS_EXTENSIONS.some((ext) => base.endsWith(ext));
  const candidates = known ? [''] : GRAPHICS_EXTENSIONS;
  for (const ext of candidates)
    for (const dir of dirs) {
      const name = dir + base + ext;
      if (have.has(name)) return name;
    }
  return null;
}
