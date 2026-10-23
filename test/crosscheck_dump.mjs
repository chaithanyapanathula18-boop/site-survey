import { measure, toUTM } from '../src/geo.js';
// Deterministic pseudo-random generator
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const out = { utm: [], polys: [] };
for (let i = 0; i < 300; i++) {
  const lat = 8 + rnd() * 29;   // India 8N..37N
  const lng = 68 + rnd() * 29;  // 68E..97E
  out.utm.push({ lat, lng, ...toUTM(lat, lng) });
}
for (let k = 0; k < 40; k++) {
  const lat0 = 8 + rnd() * 29, lng0 = 68 + rnd() * 29;
  const n = 3 + Math.floor(rnd() * 6);
  const R = 10 + rnd() * 400; // metres
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI + rnd() * 0.3;
    const r = R * (0.6 + 0.4 * rnd());
    pts.push({ lat: lat0 + (r * Math.sin(a)) / 110574, lng: lng0 + (r * Math.cos(a)) / (111320 * Math.cos(lat0 * Math.PI / 180)) });
  }
  const m = measure(pts);
  out.polys.push({ pts, area: m.area, perimeter: m.perimeter, sides: m.sides.map((s) => s.length), bearings: m.sides.map((s) => s.bearing) });
}
process.stdout.write(JSON.stringify(out));
