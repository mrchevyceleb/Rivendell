import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const svg = await readFile(join(root, 'public/favicon.svg'));

const targets = [
  { size: 192, file: 'icon-192.png' },
  { size: 512, file: 'icon-512.png' },
  { size: 180, file: 'apple-touch-icon.png' },
  { size: 512, file: 'icon-maskable-512.png', padding: 0.18 },
];

for (const target of targets) {
  const inner = Math.round(target.size * (1 - (target.padding ?? 0) * 2));
  const offset = Math.round((target.size - inner) / 2);
  const rendered = await sharp(svg, { density: 384 })
    .resize(inner, inner, { fit: 'contain', background: { r: 4, g: 5, b: 10, alpha: 1 } })
    .png()
    .toBuffer();
  const composed = await sharp({
    create: {
      width: target.size,
      height: target.size,
      channels: 4,
      background: { r: 4, g: 5, b: 10, alpha: 1 },
    },
  })
    .composite([{ input: rendered, top: offset, left: offset }])
    .png()
    .toBuffer();
  await writeFile(join(root, 'public', target.file), composed);
  console.log(`wrote public/${target.file} (${target.size}x${target.size})`);
}
