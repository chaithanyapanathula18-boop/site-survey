// Measurement maths for Site Surveyor.
// Lengths are metres, areas square metres, angles degrees (0 = north, clockwise).

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const DEG = Math.PI / 180;

export const M_PER_FT = 0.3048;

export const AREA_UNITS = [
  { key: 'sqm', label: 'Square metres', short: 'sq m', perUnit: 1 },
  { key: 'sqft', label: 'Square feet', short: 'sq ft', perUnit: 0.09290304 },
  { key: 'sqyd', label: 'Square yards', short: 'sq yd', perUnit: 0.83612736 },
  { key: 'cent', label: 'Cents', short: 'cents', perUnit: 40.468564224 },
  { key: 'gunta', label: 'Guntas', short: 'guntas', perUnit: 101.17141056 },
  { key: 'acre', label: 'Acres', short: 'acres', perUnit: 4046.8564224 },
  { key: 'ha', label: 'Hectares', short: 'ha', perUnit: 10000 },
];

// Radii of curvature of the WGS84 ellipsoid at a latitude.
export function radiiAt(latDeg) {
  const s = Math.sin(latDeg * DEG);
  const w2 = 1 - WGS84_E2 * s * s;
  const w = Math.sqrt(w2);
  return { N: WGS84_A / w, M: (WGS84_A * (1 - WGS84_E2)) / (w2 * w) };
}

function wrapLng(d) {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

// Local plane projection around an origin (east = x, north = y), accurate to
// a few parts per million over a few kilometres.
export function makeProjection(lat0, lng0) {
  const { M, N } = radiiAt(lat0);
  const kx = DEG * N * Math.cos(lat0 * DEG);
  const ky = DEG * M;
  return {
    lat0,
    lng0,
    toXY: (lat, lng) => ({ x: wrapLng(lng - lng0) * kx, y: (lat - lat0) * ky }),
    toLatLng: (x, y) => ({ lat: lat0 + y / ky, lng: lng0 + x / kx }),
  };
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const p = makeProjection((lat1 + lat2) / 2, (lng1 + lng2) / 2);
  const a = p.toXY(lat1, lng1);
  const b = p.toXY(lat2, lng2);
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function bearingDeg(dx, dy) {
  const b = Math.atan2(dx, dy) / DEG;
  return (b + 360) % 360;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMPASS_NAMES = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
export function compass8(b) {
  return COMPASS[Math.round(b / 45) % 8];
}
export function compassName(b) {
  return COMPASS_NAMES[Math.round(b / 45) % 8];
}

export function signedArea(xy) {
  let s = 0;
  const n = xy.length;
  for (let i = 0; i < n; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function properlyIntersect(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function isSelfIntersecting(xy) {
  const n = xy.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a1 = xy[i];
    const a2 = xy[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // neighbouring sides share a corner
      if (properlyIntersect(a1, a2, xy[j], xy[(j + 1) % n])) return true;
    }
  }
  return false;
}

function areaCentroid(xy, area2) {
  if (Math.abs(area2) < 1e-9) {
    const sx = xy.reduce((s, p) => s + p.x, 0);
    const sy = xy.reduce((s, p) => s + p.y, 0);
    return { x: sx / xy.length, y: sy / xy.length };
  }
  let cx = 0;
  let cy = 0;
  const n = xy.length;
  for (let i = 0; i < n; i++) {
    const a = xy[i];
    const b = xy[(i + 1) % n];
    const c = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * c;
    cy += (a.y + b.y) * c;
  }
  return { x: cx / (3 * area2), y: cy / (3 * area2) };
}

// Per-axis standard deviation we assume for a reported accuracy radius.
export function sigmaFromAccuracy(acc) {
  return acc && isFinite(acc) ? acc / 2 : 0;
}

// Everything the app shows about a boundary, from its corner points.
export function measure(points) {
  const n = points.length;
  const result = {
    n,
    closed: n >= 3,
    proj: null,
    xy: [],
    sides: [],
    angles: [],
    perimeter: 0,
    area: 0,
    areaSigma: 0,
    orientation: null,
    selfIntersecting: false,
    centroid: null,
    bbox: null,
  };
  if (n === 0) return result;

  const lat0 = points.reduce((s, p) => s + p.lat, 0) / n;
  const lng0 = points.reduce((s, p) => s + p.lng, 0) / n;
  const proj = makeProjection(lat0, lng0);
  const xy = points.map((p) => proj.toXY(p.lat, p.lng));
  result.proj = proj;
  result.xy = xy;
  result.bbox = {
    minX: Math.min(...xy.map((p) => p.x)),
    maxX: Math.max(...xy.map((p) => p.x)),
    minY: Math.min(...xy.map((p) => p.y)),
    maxY: Math.max(...xy.map((p) => p.y)),
  };
  if (n === 1) {
    result.centroid = { ...xy[0] };
    return result;
  }

  const area2 = n >= 3 ? 2 * signedArea(xy) : 0;
  const ccw = area2 >= 0;
  result.orientation = n >= 3 ? (ccw ? 'ccw' : 'cw') : null;

  const sideCount = n >= 3 ? n : n - 1;
  for (let i = 0; i < sideCount; i++) {
    const j = (i + 1) % n;
    const dx = xy[j].x - xy[i].x;
    const dy = xy[j].y - xy[i].y;
    const length = Math.hypot(dx, dy);
    const side = { index: i, from: i, to: j, length, bearing: bearingDeg(dx, dy), facing: null };
    if (n >= 3 && length > 0) {
      // Outward normal: right of the direction of travel for an anticlockwise ring.
      const nx = ccw ? dy : -dy;
      const ny = ccw ? -dx : dx;
      side.facing = bearingDeg(nx, ny);
    }
    result.sides.push(side);
    result.perimeter += length;
  }

  if (n >= 3) {
    result.area = Math.abs(area2) / 2;
    result.selfIntersecting = isSelfIntersecting(xy);
    result.centroid = areaCentroid(xy, area2);
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const prev = xy[(i - 1 + n) % n];
      const next = xy[(i + 1) % n];
      const s = sigmaFromAccuracy(points[i].acc);
      variance += (s * s * ((next.x - prev.x) ** 2 + (next.y - prev.y) ** 2)) / 4;
    }
    result.areaSigma = Math.sqrt(variance);
    for (let i = 0; i < n; i++) {
      const prev = xy[(i - 1 + n) % n];
      const cur = xy[i];
      const next = xy[(i + 1) % n];
      const ux = prev.x - cur.x;
      const uy = prev.y - cur.y;
      const vx = next.x - cur.x;
      const vy = next.y - cur.y;
      const theta = Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) / DEG;
      const turn = cross(prev, cur, next); // > 0 is a left turn
      const convex = ccw ? turn >= 0 : turn <= 0;
      result.angles.push(convex ? theta : 360 - theta);
    }
  } else {
    result.centroid = { x: (xy[0].x + xy[1].x) / 2, y: (xy[0].y + xy[1].y) / 2 };
  }
  return result;
}

// ---- UTM (WGS84), Krüger series as given by Karney (2011) -------------------

export function utmZone(lng) {
  return Math.min(60, Math.max(1, Math.floor((wrapLng(lng) + 180) / 6) + 1));
}

const UTM_N = WGS84_F / (2 - WGS84_F);
const UTM_A = (WGS84_A / (1 + UTM_N)) * (1 + UTM_N ** 2 / 4 + UTM_N ** 4 / 64);
const UTM_E = (2 * Math.sqrt(UTM_N)) / (1 + UTM_N);
const UTM_ALPHA = [
  UTM_N / 2 - (2 * UTM_N ** 2) / 3 + (5 * UTM_N ** 3) / 16,
  (13 * UTM_N ** 2) / 48 - (3 * UTM_N ** 3) / 5,
  (61 * UTM_N ** 3) / 240,
];

export function toUTM(lat, lng, zone = utmZone(lng)) {
  const lng0 = (zone - 1) * 6 - 180 + 3;
  const phi = lat * DEG;
  const dl = wrapLng(lng - lng0) * DEG;
  const s = Math.sin(phi);
  const t = Math.sinh(Math.atanh(s) - UTM_E * Math.atanh(UTM_E * s));
  const xiP = Math.atan2(t, Math.cos(dl));
  const etaP = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let xi = xiP;
  let eta = etaP;
  for (let j = 1; j <= 3; j++) {
    xi += UTM_ALPHA[j - 1] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += UTM_ALPHA[j - 1] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }
  const k0 = 0.9996;
  const E = 500000 + k0 * UTM_A * eta;
  let N = k0 * UTM_A * xi;
  const south = lat < 0;
  if (south) N += 10000000;
  return { zone, hemi: south ? 'S' : 'N', E, N };
}

// ---- Formatting -------------------------------------------------------------

const nf = (dp) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function fmtNum(v, dp) {
  return nf(dp).format(v);
}

export function fmtLen(m, unit = 'm') {
  if (unit === 'ft') {
    const ft = m / M_PER_FT;
    return `${fmtNum(ft, ft < 1000 ? 1 : 0)} ft`;
  }
  return `${fmtNum(m, m < 100 ? 2 : 1)} m`;
}

export function fmtAreaValue(v) {
  if (v >= 1000) return fmtNum(v, 0);
  if (v >= 100) return fmtNum(v, 1);
  if (v >= 1) return fmtNum(v, 2);
  return fmtNum(v, 4);
}

export function areaIn(sqm, key) {
  const u = AREA_UNITS.find((a) => a.key === key) || AREA_UNITS[0];
  return sqm / u.perUnit;
}

export function fmtArea(sqm, key = 'sqm') {
  const u = AREA_UNITS.find((a) => a.key === key) || AREA_UNITS[0];
  return `${fmtAreaValue(sqm / u.perUnit)} ${u.short}`;
}

export function roundSig(v, sig = 2) {
  if (!v || !isFinite(v)) return 0;
  const p = 10 ** (sig - 1 - Math.floor(Math.log10(Math.abs(v))));
  return Math.round(v * p) / p;
}

export function fmtAngle(deg) {
  return `${fmtNum(deg, 1)}°`;
}

export function fmtCoord(v) {
  return v.toFixed(7);
}

// A "nice" step (1, 2 or 5 × 10^k) close to the target.
export function niceStep(target) {
  if (!(target > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(target));
  const f = target / p;
  const m = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
  return m * p;
}
