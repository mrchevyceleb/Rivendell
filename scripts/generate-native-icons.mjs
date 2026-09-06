// Renders the native-shell icons from public/favicon.svg, the one source of
// the TARDIS mark. Run `npm run icons:native` after changing the SVG.
//
//   desktop/build/icon.png                     1024px tile; electron-builder
//                                              derives .ico and .icns from it
//   android/.../mipmap-*/ic_launcher_foreground.png
//                                              adaptive-icon foreground layers:
//                                              the box on a transparent 108dp
//                                              canvas, sized to the 66dp safe zone
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const svg = await readFile(join(root, 'public/favicon.svg'), 'utf8');

const TILE = /<rect width="32" height="32" rx="6" fill="url\(#bg\)" \/>\s*/;
if (!TILE.test(svg)) throw new Error('favicon.svg: tile rect not found; update the pattern in this script');
const boxOnly = svg.replace(TILE, '');

// The SVG is 32 units wide; render at a density that keeps the largest target crisp.
const DENSITY = 2400;

async function renderSquare(source, size) {
  return sharp(Buffer.from(source), { density: DENSITY }).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
}

async function write(relPath, buffer) {
  const target = join(root, relPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buffer);
  console.log(`wrote ${relPath}`);
}

await write('desktop/build/icon.png', await renderSquare(svg, 1024));

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const FOREGROUND_DP = 108;
const SAFE_ZONE_DP = 66;
for (const [bucket, scale] of Object.entries(DENSITIES)) {
  const canvas = Math.round(FOREGROUND_DP * scale);
  const inner = Math.round(SAFE_ZONE_DP * scale * 0.94);
  const offset = Math.round((canvas - inner) / 2);
  const box = await renderSquare(boxOnly, inner);
  const layer = await sharp({
    create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: box, top: offset, left: offset }])
    .png()
    .toBuffer();
  await write(`android/app/src/main/res/mipmap-${bucket}/ic_launcher_foreground.png`, layer);
}
