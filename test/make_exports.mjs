import fs from 'node:fs';
import sharp from 'sharp';
import { sampleProject } from './sample.mjs';
import { buildDxf } from '../src/export/dxf.js';
import { buildKml, buildCsv } from '../src/export/text.js';
import { buildPdf } from '../src/export/pdf.js';
const out = process.argv[2];
const p = sampleProject();
fs.writeFileSync(`${out}/plot_utm.dxf`, buildDxf(p, { coords: 'utm' }));
fs.writeFileSync(`${out}/plot_local.dxf`, buildDxf(p, { coords: 'local' }));
fs.writeFileSync(`${out}/plot.kml`, buildKml(p));
fs.writeFileSync(`${out}/plot.csv`, buildCsv(p));
// a test photo
const jpg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 120, g: 160, b: 90 } } }).jpeg({ quality: 70 }).toBuffer();
const dataUrl = 'data:image/jpeg;base64,' + jpg.toString('base64');
const pdf = await buildPdf(p, { getImage: async () => ({ dataUrl, w: 1600, h: 1200 }) });
fs.writeFileSync(`${out}/plot.pdf`, Buffer.from(pdf));
console.log('ok');
