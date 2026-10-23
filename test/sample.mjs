import { makeProjection } from '../src/geo.js';
// A five-corner plot near Hyderabad, roughly 18 m x 25 m with one bent side.
export function sampleProject() {
  const P = makeProjection(17.4065, 78.4772);
  const xy = [[0, 0], [18.3, 0.4], [18.9, 14.2], [17.6, 25.1], [-0.2, 24.6]];
  const accs = [3.2, 4.1, 2.8, 5.6, 3.9];
  return {
    id: 'ptest', version: 1, name: 'Plot 42, Kondapur Layout', surveyNo: '123/4A', village: 'Kondapur', owner: 'K. Ramesh', notes: 'Boundary stones found at P1, P2 and P4. Gate on the road side.',
    points: xy.map(([x, y], i) => { const q = P.toLatLng(x, y); return { id: 'c' + i, lat: q.lat, lng: q.lng, acc: accs[i], n: 9 + i, method: i === 3 ? 'moved' : 'gps', t: Date.UTC(2026, 9, 23, 5, i) }; }),
    roadSide: 0,
    photos: [
      (() => { const q = P.toLatLng(9, -1); return { id: 'ph1', lat: q.lat, lng: q.lng, acc: 4, t: Date.UTC(2026, 9, 23, 5, 10), caption: 'Gate and road', pointId: null, thumb: '' }; })(),
      (() => { const q = P.toLatLng(0.3, 0.2); return { id: 'ph2', lat: q.lat, lng: q.lng, acc: 3, t: Date.UTC(2026, 9, 23, 5, 12), caption: 'Boundary stone', pointId: 'c0', thumb: '' }; })(),
    ],
    createdAt: Date.UTC(2026, 9, 23), updatedAt: Date.UTC(2026, 9, 23),
  };
}
