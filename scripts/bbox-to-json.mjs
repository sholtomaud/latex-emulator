// Convert `pdftotext -bbox-layout` XHTML into a compact JSON list of pages and
// text lines: { pages: [{ width, height, lines: [{ text, xMin, yMin, xMax, yMax, words }] }] }
// where words is [{ text, xMin, xMax }].
// Coordinates are PDF points (1/72 in) from the page's top-left corner.
import fs from 'node:fs';

const html = fs.readFileSync(process.argv[2], 'utf8');
const num = (s) => Math.round(Number(s) * 100) / 100;
const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const pages = [];
for (const page of html.matchAll(
  /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g
)) {
  const lines = [];
  for (const line of page[3].matchAll(
    /<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/line>/g
  )) {
    const words = [
      ...line[5].matchAll(
        /<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)" yMax="[\d.]+">([\s\S]*?)<\/word>/g
      ),
    ].map((w) => ({ text: decode(w[3]), xMin: num(w[1]), xMax: num(w[2]) }));
    lines.push({
      text: words.map((w) => w.text).join(' '),
      xMin: num(line[1]),
      yMin: num(line[2]),
      xMax: num(line[3]),
      yMax: num(line[4]),
      words,
    });
  }
  pages.push({ width: num(page[1]), height: num(page[2]), lines });
}
process.stdout.write(JSON.stringify({ pages }, null, 2) + '\n');
