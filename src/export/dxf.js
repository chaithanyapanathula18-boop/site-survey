// AutoCAD DXF (R12, ASCII) export: boundary, corners, dimensions, angles, area, north arrow, title.
import { measure, toUTM, utmZone, fmtNum, fmtArea, M_PER_FT, compassName } from '../geo.js';
import { sideGeometry, innerBisector } from '../plan.js';

const LAYERS = [
  ['BOUNDARY', 1],
  ['ROAD', 30],
  ['CORNERS', 3],
  ['CORNER_LABELS', 7],
  ['DIMENSIONS', 5],
  ['ANGLES', 6],
  ['AREA', 7],
  ['PHOTOS', 4],
  ['NORTH_ARROW', 7],
  ['TITLE', 7],
];

// DXF strings: ASCII, with \U+XXXX for anything else; degree/plus-minus as AutoCAD codes.
function dxfText(s) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (ch === '°') out += '%%d';
    else if (ch === '±') out += '%%p';
    else if (c === 10 || c === 13) out += ' ';
    else if (c >= 32 && c < 127) out += ch;
    else if (c <= 0xffff) out += `\\U+${c.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return out;
}

function num(v, dp = 4) {
  if (!isFinite(v)) return '0.0';
  const s = v.toFixed(dp);
  return s.includes('.') ? s : `${s}.0`;
}

class Writer {
  constructor() {
    this.out = [];
  }
  g(code, value) {
    this.out.push(String(code).padStart(3, ' '), String(value));
  }
  toString() {
    return this.out.join('\r\n') + '\r\n';
  }
}

export function buildDxf(project, { coords = 'utm', generatedAt = new Date() } = {}) {
  const m = measure(project.points);
  if (m.n === 0) throw new Error('There are no corners to export yet.');

  let T;
  let coordNote;
  if (coords === 'utm') {
    const zone = utmZone(m.proj.lng0);
    const hemi = m.proj.lat0 >= 0 ? 'N' : 'S';
    T = (x, y) => {
      const ll = m.proj.toLatLng(x, y);
      const u = toUTM(ll.lat, ll.lng, zone);
      return [u.E, u.N];
    };
    coordNote = `Coordinates: UTM zone ${zone}${hemi}, WGS84, metres`;
  } else {
    const o = m.xy[0];
    T = (x, y) => [x - o.x, y - o.y];
    coordNote = 'Coordinates: local metres, P1 = 0,0, Y axis = true north';
  }
  const angleOut = (p, dir) => {
    const [x0, y0] = T(p.x, p.y);
    const [x1, y1] = T(p.x + dir.x, p.y + dir.y);
    return (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;
  };

  const ext = Math.max(m.bbox.maxX - m.bbox.minX, m.bbox.maxY - m.bbox.minY, 1);
  const th = Math.min(Math.max(ext / 45, 0.12), 8); // text height in metres

  const ents = new Writer();
  const text = (layer, p, height, value, rot = 0) => {
    const [x, y] = T(p.x, p.y);
    ents.g(0, 'TEXT');
    ents.g(8, layer);
    ents.g(10, num(x));
    ents.g(20, num(y));
    ents.g(30, '0.0');
    ents.g(40, num(height, 3));
    ents.g(1, dxfText(value));
    ents.g(50, num(rot, 3));
    ents.g(7, 'STANDARD');
    ents.g(72, 1);
    ents.g(11, num(x));
    ents.g(21, num(y));
    ents.g(31, '0.0');
    ents.g(73, 2);
  };
  const line = (layer, a, b) => {
    const [x1, y1] = T(a.x, a.y);
    const [x2, y2] = T(b.x, b.y);
    ents.g(0, 'LINE');
    ents.g(8, layer);
    ents.g(10, num(x1));
    ents.g(20, num(y1));
    ents.g(30, '0.0');
    ents.g(11, num(x2));
    ents.g(21, num(y2));
    ents.g(31, '0.0');
  };
  const polyline = (layer, pts, closed) => {
    ents.g(0, 'POLYLINE');
    ents.g(8, layer);
    ents.g(66, 1);
    ents.g(10, '0.0');
    ents.g(20, '0.0');
    ents.g(30, '0.0');
    ents.g(70, closed ? 1 : 0);
    pts.forEach((p) => {
      const [x, y] = T(p.x, p.y);
      ents.g(0, 'VERTEX');
      ents.g(8, layer);
      ents.g(10, num(x));
      ents.g(20, num(y));
      ents.g(30, '0.0');
    });
    ents.g(0, 'SEQEND');
    ents.g(8, layer);
  };
  const circle = (layer, p, r) => {
    const [x, y] = T(p.x, p.y);
    ents.g(0, 'CIRCLE');
    ents.g(8, layer);
    ents.g(10, num(x));
    ents.g(20, num(y));
    ents.g(30, '0.0');
    ents.g(40, num(r, 3));
  };
  const point = (layer, p) => {
    const [x, y] = T(p.x, p.y);
    ents.g(0, 'POINT');
    ents.g(8, layer);
    ents.g(10, num(x));
    ents.g(20, num(y));
    ents.g(30, '0.0');
  };
  const add = (p, v, s) => ({ x: p.x + v.x * s, y: p.y + v.y * s });

  // boundary
  if (m.n >= 3) polyline('BOUNDARY', m.xy, true);
  else if (m.n === 2) line('BOUNDARY', m.xy[0], m.xy[1]);

  // road side
  if (project.roadSide != null && m.n >= 3 && m.sides[project.roadSide]) {
    const sg = sideGeometry(m, project.roadSide);
    line('ROAD', sg.a, sg.b);
    const p = add(sg.mid, sg.normal, 3.2 * th);
    text('ROAD', p, th * 1.1, 'ROAD', angleOut(p, sg.dir.x >= 0 ? sg.dir : { x: -sg.dir.x, y: -sg.dir.y }));
  }

  // corners and labels
  m.xy.forEach((p, i) => {
    point('CORNERS', p);
    circle('CORNERS', p, th * 0.3);
    let out;
    if (m.n >= 3) {
      const b = innerBisector(m, i);
      out = { x: -b.x, y: -b.y };
    } else {
      out = { x: 0, y: 1 };
    }
    text('CORNER_LABELS', add(p, out, th * 1.3), th, `P${i + 1}`);
  });

  // side lengths
  m.sides.forEach((side, i) => {
    const sg = sideGeometry(m, i);
    const p = add(sg.mid, sg.normal, th * 1.0);
    const dir = { x: Math.cos((sg.angle * Math.PI) / 180), y: Math.sin((sg.angle * Math.PI) / 180) };
    text('DIMENSIONS', p, th * 0.8, `${fmtNum(side.length, 2)} m (${fmtNum(side.length / M_PER_FT, 1)} ft)`, angleOut(p, dir));
  });

  // angles
  if (m.n >= 3) {
    m.angles.forEach((a, i) => {
      const b = innerBisector(m, i);
      text('ANGLES', add(m.xy[i], b, th * 2.4), th * 0.65, `${fmtNum(a, 1)}°`);
    });
    // area
    const c = m.centroid;
    text('AREA', { x: c.x, y: c.y + th * 0.8 }, th * 1.1, `AREA ${fmtArea(m.area, 'sqm')}`);
    text('AREA', { x: c.x, y: c.y - th * 0.8 }, th * 0.75, `${fmtArea(m.area, 'sqyd')} = ${fmtArea(m.area, 'sqft')} = ${fmtArea(m.area, 'acre')}`);
  }

  // photos
  project.photos.forEach((ph, i) => {
    if (ph.lat == null || ph.lng == null) return;
    const p = m.proj.toXY(ph.lat, ph.lng);
    point('PHOTOS', p);
    circle('PHOTOS', p, th * 0.25);
    text('PHOTOS', { x: p.x, y: p.y - th * 0.9 }, th * 0.55, `Ph${i + 1}`);
  });

  // north arrow at the top right of the plot
  const bb = m.bbox;
  const na = { x: bb.maxX + th * 4, y: bb.maxY + th * 2 };
  const L = th * 3;
  polyline(
    'NORTH_ARROW',
    [
      { x: na.x, y: na.y + L / 2 },
      { x: na.x + L * 0.28, y: na.y - L / 2 },
      { x: na.x, y: na.y - L * 0.25 },
      { x: na.x - L * 0.28, y: na.y - L / 2 },
    ],
    true,
  );
  text('NORTH_ARROW', { x: na.x, y: na.y + L / 2 + th }, th * 1.1, 'N');

  // title block under the plot
  let ty = bb.minY - th * 4;
  const tx = bb.minX;
  const titleLine = (s, size) => {
    textLeft(ents, T, 'TITLE', { x: tx, y: ty }, size, s);
    ty -= size * 1.7;
  };
  titleLine(project.name || 'Site', th * 1.4);
  const details = [project.surveyNo && `Survey no. ${project.surveyNo}`, project.village, project.owner && `Owner: ${project.owner}`].filter(Boolean).join('  |  ');
  if (details) titleLine(details, th * 0.8);
  if (m.n >= 3) {
    titleLine(`Area: ${fmtArea(m.area, 'sqm')} = ${fmtArea(m.area, 'sqyd')} = ${fmtArea(m.area, 'cent')} = ${fmtArea(m.area, 'acre')}`, th * 0.8);
    titleLine(`Perimeter: ${fmtNum(m.perimeter, 2)} m   Corners: ${m.n}`, th * 0.8);
    if (project.roadSide != null && m.sides[project.roadSide] && m.sides[project.roadSide].facing != null) {
      titleLine(`Facing: ${compassName(m.sides[project.roadSide].facing)} (road side P${project.roadSide + 1}-P${((project.roadSide + 1) % m.n) + 1})`, th * 0.8);
    }
  }
  titleLine(coordNote, th * 0.7);
  if (coords === 'utm' && m.centroid) {
    const c = m.centroid;
    const [x0, y0] = T(c.x, c.y);
    const [x1, y1] = T(c.x + 100, c.y);
    const k = Math.hypot(x1 - x0, y1 - y0) / 100;
    titleLine(`UTM grid scale here: ${k.toFixed(5)}. Length labels are ground distances.`, th * 0.6);
  }
  titleLine(`Surveyed with phone GPS (approximate). Generated ${generatedAt.toISOString().slice(0, 10)} by Site Surveyor.`, th * 0.6);

  // extents
  const corners = [
    T(bb.minX - th * 6, bb.minY - th * 16),
    T(bb.maxX + th * 8, bb.maxY + th * 8),
    T(bb.minX - th * 6, bb.maxY + th * 8),
    T(bb.maxX + th * 8, bb.minY - th * 16),
  ];
  const minX = Math.min(...corners.map((c) => c[0]));
  const minY = Math.min(...corners.map((c) => c[1]));
  const maxX = Math.max(...corners.map((c) => c[0]));
  const maxY = Math.max(...corners.map((c) => c[1]));

  const w = new Writer();
  w.g(0, 'SECTION');
  w.g(2, 'HEADER');
  w.g(9, '$ACADVER');
  w.g(1, 'AC1009');
  w.g(9, '$DWGCODEPAGE');
  w.g(3, 'ANSI_1252');
  w.g(9, '$INSBASE');
  w.g(10, '0.0');
  w.g(20, '0.0');
  w.g(30, '0.0');
  w.g(9, '$EXTMIN');
  w.g(10, num(minX));
  w.g(20, num(minY));
  w.g(30, '0.0');
  w.g(9, '$EXTMAX');
  w.g(10, num(maxX));
  w.g(20, num(maxY));
  w.g(30, '0.0');
  w.g(9, '$TEXTSIZE');
  w.g(40, num(th, 3));
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION');
  w.g(2, 'TABLES');
  w.g(0, 'TABLE');
  w.g(2, 'LTYPE');
  w.g(70, 1);
  w.g(0, 'LTYPE');
  w.g(2, 'CONTINUOUS');
  w.g(70, 0);
  w.g(3, 'Solid line');
  w.g(72, 65);
  w.g(73, 0);
  w.g(40, '0.0');
  w.g(0, 'ENDTAB');
  w.g(0, 'TABLE');
  w.g(2, 'LAYER');
  w.g(70, LAYERS.length + 1);
  for (const [name, color] of [['0', 7], ...LAYERS]) {
    w.g(0, 'LAYER');
    w.g(2, name);
    w.g(70, 0);
    w.g(62, color);
    w.g(6, 'CONTINUOUS');
  }
  w.g(0, 'ENDTAB');
  w.g(0, 'TABLE');
  w.g(2, 'STYLE');
  w.g(70, 1);
  w.g(0, 'STYLE');
  w.g(2, 'STANDARD');
  w.g(70, 0);
  w.g(40, '0.0');
  w.g(41, '1.0');
  w.g(50, '0.0');
  w.g(71, 0);
  w.g(42, num(th, 3));
  w.g(3, 'txt');
  w.g(4, '');
  w.g(0, 'ENDTAB');
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION');
  w.g(2, 'BLOCKS');
  w.g(0, 'ENDSEC');

  w.g(0, 'SECTION');
  w.g(2, 'ENTITIES');
  w.out.push(...ents.out);
  w.g(0, 'ENDSEC');
  w.g(0, 'EOF');
  return w.toString();
}

function textLeft(ents, T, layer, p, height, value) {
  const [x, y] = T(p.x, p.y);
  ents.g(0, 'TEXT');
  ents.g(8, layer);
  ents.g(10, num(x));
  ents.g(20, num(y));
  ents.g(30, '0.0');
  ents.g(40, num(height, 3));
  ents.g(1, dxfText(value));
  ents.g(7, 'STANDARD');
}
