// Draws the app icons into static/icons. Run once with `npm run icons` after changing the design.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const out = path.resolve('static/icons');
fs.mkdirSync(out, { recursive: true });

// A plot outline with GPS corner dots on the app blue. `pad` shrinks the art for maskable icons.
function svg({ pad = 0, rounded = true } = {}) {
  const s = 512;
  const k = 1 - pad * 2;
  const t = (x, y) => `${(s * pad + x * k).toFixed(1)},${(s * pad + y * k).toFixed(1)}`;
  const corners = [
    [118, 150],
    [380, 118],
    [404, 352],
    [214, 400],
    [104, 300],
  ];
  const poly = corners.map(([x, y]) => t(x, y)).join(' ');
  const dots = corners
    .map(([x, y]) => {
      const [cx, cy] = t(x, y).split(',');
      return `<circle cx="${cx}" cy="${cy}" r="${28 * k}" fill="#ffffff"/><circle cx="${cx}" cy="${cy}" r="${15 * k}" fill="#f97316"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${rounded ? 112 : 0}" fill="#1d4ed8"/>
  <polygon points="${poly}" fill="#ffffff" fill-opacity="0.16" stroke="#ffffff" stroke-width="${18 * k}" stroke-linejoin="round"/>
  ${dots}
</svg>`;
}

const jobs = [
  ['icon-512.png', 512, svg()],
  ['icon-192.png', 192, svg()],
  ['maskable-512.png', 512, svg({ pad: 0.12, rounded: false })],
  ['apple-touch-icon.png', 180, svg({ pad: 0.04, rounded: false })],
  ['favicon-32.png', 32, svg()],
];
for (const [name, size, art] of jobs) {
  await sharp(Buffer.from(art)).resize(size, size).png().toFile(path.join(out, name));
  console.log('wrote', name);
}
fs.writeFileSync(path.join(out, 'icon.svg'), svg());
