// Render the app icons from public/favicon.svg (ADR 0021):
//   node scripts/make-icons.ts
// Writes public/icon-192.png, icon-512.png and icon-maskable-512.png (the
// glyph inside the maskable safe zone, the middle 80%, on a full square).
import fs from 'node:fs';
import { chromium } from 'playwright';

const svg = fs.readFileSync('public/favicon.svg', 'utf8');
const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
const page = await browser.newPage({ colorScheme: 'light' });

async function render(file: string, size: number, maskable: boolean) {
  const inner = maskable ? Math.round(size * 0.8) : size;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;
      width:${size}px;height:${size}px;display:grid;place-items:center;
      background:${maskable ? '#0f172a' : 'transparent'}">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"
      width="${inner}" height="${inner}"></body></html>`);
  await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
  await page.screenshot({ path: file, omitBackground: !maskable });
  console.log(`wrote ${file}`);
}

await render('public/icon-192.png', 192, false);
await render('public/icon-512.png', 512, false);
await render('public/icon-maskable-512.png', 512, true);
await browser.close();
