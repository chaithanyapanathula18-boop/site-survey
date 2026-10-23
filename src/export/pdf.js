// Site plan PDF: drawing to scale, measurements, coordinates and photos (A4).
import { jsPDF } from 'jspdf';
import { measure, fmtArea, fmtNum, M_PER_FT, AREA_UNITS, toUTM, utmZone, compassName, niceStep, distanceMeters, roundSig } from '../geo.js';
import { sideGeometry, innerBisector, chooseScale } from '../plan.js';

const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#d1d5db';
const BLUE = '#1e40af';
const ROAD = '#7c3aed';
const ORANGE = '#c2410c';

function methodText(q) {
  if (q.method === 'gps') return q.n ? `GPS (${q.n})` : 'GPS';
  if (q.method === 'moved') return 'Moved';
  return 'Map tap';
}

function dateText(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateTimeText(t) {
  return new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export async function buildPdf(project, { getImage, generatedAt = new Date() } = {}) {
  const m = measure(project.points);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `${project.name} - site plan`, creator: 'Site Surveyor' });
  const PW = 210;
  const PH = 297;
  const ML = 12;
  const CW = PW - 2 * ML;
  let page = 1;

  const footer = () => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text('Measured with phone GPS. Positions are usually accurate to a few metres; this is not a legal survey.', ML, PH - 8);
    doc.text(`Page ${page}`, PW - ML, PH - 8, { align: 'right' });
  };
  const newPage = () => {
    footer();
    doc.addPage();
    page += 1;
  };

  // ---- header ---------------------------------------------------------------
  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(doc.splitTextToSize(project.name || 'Site', 140)[0], ML, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(MUTED);
  const details = [project.surveyNo && `Survey no. ${project.surveyNo}`, project.village, project.owner && `Owner: ${project.owner}`].filter(Boolean).join('   |   ');
  if (details) doc.text(doc.splitTextToSize(details, 150)[0], ML, 24);
  doc.text('Site plan', PW - ML, 17, { align: 'right' });
  doc.text(dateText(generatedAt), PW - ML, 22, { align: 'right' });
  doc.setDrawColor(LINE);
  doc.setLineWidth(0.3);
  doc.line(ML, 27, PW - ML, 27);

  // ---- plan drawing ---------------------------------------------------------
  const FX = ML;
  const FY = 30;
  const FW = CW;
  const FH = 150;
  doc.setDrawColor(LINE);
  doc.setLineWidth(0.2);
  doc.rect(FX, FY, FW, FH, 'S');

  let scaleN = null;
  if (m.n >= 2) {
    const bb = m.bbox;
    const bw = Math.max(bb.maxX - bb.minX, 0.5);
    const bh = Math.max(bb.maxY - bb.minY, 0.5);
    scaleN = chooseScale(bw, bh, FW - 34, FH - 34);
    const f = 1000 / scaleN; // mm per metre
    const cx = FX + FW / 2;
    const cy = FY + FH / 2;
    const bcx = (bb.minX + bb.maxX) / 2;
    const bcy = (bb.minY + bb.maxY) / 2;
    const X = (x) => cx + (x - bcx) * f;
    const Y = (y) => cy - (y - bcy) * f;
    const P = m.xy.map((q) => [X(q.x), Y(q.y)]);

    // light grid every nice step
    const gridStep = niceStep(12 / f);
    doc.setDrawColor('#eef2f7');
    doc.setLineWidth(0.15);
    for (let x = Math.ceil((bcx - FW / 2 / f) / gridStep) * gridStep; X(x) < FX + FW; x += gridStep) {
      if (X(x) > FX) doc.line(X(x), FY, X(x), FY + FH);
    }
    for (let y = Math.ceil((bcy - FH / 2 / f) / gridStep) * gridStep; Y(y) > FY; y += gridStep) {
      if (Y(y) < FY + FH) doc.line(FX, Y(y), FX + FW, Y(y));
    }

    // boundary
    doc.setDrawColor(INK);
    doc.setLineWidth(0.6);
    if (m.n >= 3) {
      doc.setFillColor('#fff7ed');
      const segs = [];
      for (let i = 1; i < P.length; i++) segs.push([P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]]);
      doc.lines(segs, P[0][0], P[0][1], [1, 1], 'FD', true);
    } else {
      doc.line(P[0][0], P[0][1], P[1][0], P[1][1]);
    }

    // road
    if (project.roadSide != null && m.n >= 3 && m.sides[project.roadSide]) {
      const sg = sideGeometry(m, project.roadSide);
      doc.setDrawColor(ROAD);
      doc.setLineWidth(1.6);
      doc.line(X(sg.a.x), Y(sg.a.y), X(sg.b.x), Y(sg.b.y));
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(ROAD);
      const c = [X(sg.mid.x) + sg.normal.x * 9, Y(sg.mid.y) - sg.normal.y * 9];
      rotatedText(doc, 'ROAD', c, sg.angle, 8);
    }

    // side lengths
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(BLUE);
    m.sides.forEach((side, i) => {
      const sg = sideGeometry(m, i);
      const c = [X(sg.mid.x) + sg.normal.x * 3.6, Y(sg.mid.y) - sg.normal.y * 3.6];
      rotatedText(doc, `${fmtNum(side.length, 2)} m  (${fmtNum(side.length / M_PER_FT, 1)} ft)`, c, sg.angle, 7);
    });

    // angles
    if (m.n >= 3) {
      doc.setFontSize(6.5);
      doc.setTextColor(MUTED);
      m.angles.forEach((a, i) => {
        const b = innerBisector(m, i);
        const c = [P[i][0] + b.x * 6, P[i][1] - b.y * 6];
        rotatedText(doc, `${fmtNum(a, 1)}°`, c, 0, 6.5);
      });
    }

    // corners
    P.forEach(([x, y], i) => {
      doc.setDrawColor(INK);
      doc.setFillColor('#ffffff');
      doc.setLineWidth(0.35);
      doc.circle(x, y, 1.3, 'FD');
      let out = { x: 0, y: 1 };
      if (m.n >= 3) {
        const b = innerBisector(m, i);
        out = { x: -b.x, y: -b.y };
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(INK);
      rotatedText(doc, `P${i + 1}`, [x + out.x * 4, y - out.y * 4], 0, 8);
    });

    // photos
    project.photos.forEach((ph, i) => {
      if (ph.lat == null) return;
      const q = m.proj.toXY(ph.lat, ph.lng);
      const x = X(q.x);
      const y = Y(q.y);
      if (x < FX || x > FX + FW || y < FY || y > FY + FH) return;
      doc.setFillColor('#0891b2');
      doc.circle(x, y, 1, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6);
      doc.setTextColor('#0e7490');
      doc.text(`Ph${i + 1}`, x + 1.6, y + 0.8);
    });

    // area label
    if (m.n >= 3 && m.centroid) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(ORANGE);
      rotatedText(doc, fmtArea(m.area, 'sqm'), [X(m.centroid.x), Y(m.centroid.y) - 2], 0, 10);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      rotatedText(doc, fmtArea(m.area, 'sqyd'), [X(m.centroid.x), Y(m.centroid.y) + 2.5], 0, 8);
    }

    // north arrow
    const nx = FX + FW - 12;
    const ny = FY + 16;
    doc.setFillColor(INK);
    doc.lines(
      [
        [4, 13],
        [-4, -3],
        [-4, 3],
      ],
      nx,
      ny - 8,
      [1, 1],
      'F',
      true,
    );
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(INK);
    doc.text('N', nx, ny - 9.5, { align: 'center' });

    // scale bar
    const sbLen = niceStep(36 / f);
    const sbMm = sbLen * f;
    const sx = FX + 8;
    const sy = FY + FH - 9;
    doc.setLineWidth(0.2);
    doc.setDrawColor(INK);
    doc.setFillColor(INK);
    doc.rect(sx, sy, sbMm / 2, 1.6, 'FD');
    doc.setFillColor('#ffffff');
    doc.rect(sx + sbMm / 2, sy, sbMm / 2, 1.6, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(INK);
    doc.text('0', sx, sy - 1.2, { align: 'center' });
    doc.text(`${fmtNum(sbLen, sbLen < 1 ? 1 : 0)} m`, sx + sbMm, sy - 1.2, { align: 'center' });
    doc.setTextColor(MUTED);
    doc.text(`Scale 1:${fmtNum(scaleN, 0)} on A4`, sx, sy + 5.5);
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(MUTED);
    doc.text('Not enough corners to draw the boundary yet.', FX + FW / 2, FY + FH / 2, { align: 'center' });
  }

  // ---- summary ----------------------------------------------------------------
  let y = FY + FH + 9;
  const colL = ML;
  const colR = ML + CW / 2 + 4;
  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Area', colL, y);
  doc.text('Boundary', colR, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  let yl = y + 6;
  if (m.n >= 3) {
    AREA_UNITS.forEach((u) => {
      doc.setTextColor(MUTED);
      doc.text(u.label, colL, yl);
      doc.setTextColor(INK);
      doc.text(fmtArea(m.area, u.key), colL + 80, yl, { align: 'right' });
      yl += 5.2;
    });
    if (m.areaSigma > 0) {
      doc.setTextColor(MUTED);
      doc.setFontSize(7.5);
      doc.text(`Rough GPS uncertainty: ±${fmtArea(roundSig(m.areaSigma), 'sqm')}`, colL, yl + 0.5);
      doc.setFontSize(9);
    }
  } else {
    doc.setTextColor(MUTED);
    doc.text('Needs at least 3 corners.', colL, yl);
  }

  let yr = y + 6;
  const rowR = (label, value) => {
    doc.setTextColor(MUTED);
    doc.text(label, colR, yr);
    doc.setTextColor(INK);
    const lines = doc.splitTextToSize(String(value), 56);
    doc.text(lines, colR + 30, yr);
    yr += 5.2 * Math.max(lines.length, 1);
  };
  rowR('Corners', String(m.n));
  rowR('Perimeter', m.n >= 2 ? `${fmtNum(m.perimeter, 2)} m (${fmtNum(m.perimeter / M_PER_FT, 1)} ft)` : '-');
  if (project.roadSide != null && m.sides[project.roadSide] && m.sides[project.roadSide].facing != null) {
    rowR('Facing', `${compassName(m.sides[project.roadSide].facing)} (road on side P${project.roadSide + 1}-P${((project.roadSide + 1) % m.n) + 1})`);
  }
  const gpsPts = project.points.filter((q) => q.method === 'gps' && q.acc != null);
  if (gpsPts.length) {
    const avg = gpsPts.reduce((s, q) => s + q.acc, 0) / gpsPts.length;
    rowR('GPS corners', `${gpsPts.length} of ${m.n}, average ±${fmtNum(avg, 1)} m`);
  }
  if (scaleN) rowR('Drawing scale', `1:${fmtNum(scaleN, 0)}`);
  if (m.selfIntersecting) rowR('Warning', 'Boundary lines cross. Check the corner order.');

  y = Math.max(yl, yr) + 6;
  if (project.notes) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(INK);
    doc.text('Notes', ML, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(project.notes, CW);
    const maxLines = Math.max(0, Math.floor((PH - 16 - (y + 5)) / 4.4));
    doc.text(lines.slice(0, maxLines), ML, y + 5);
  }

  // ---- measurements page ------------------------------------------------------
  if (m.n >= 2) {
    newPage();
    y = 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(INK);
    doc.text('Measurements', ML, y);
    y += 8;
    const table = (cols, rows) => {
      const rh = 6;
      const header = () => {
        doc.setFillColor('#f3f4f6');
        doc.rect(ML, y - 4.2, CW, rh, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(INK);
        let x = ML + 2;
        cols.forEach((c) => {
          doc.text(c.label, c.align === 'right' ? x + c.w - 4 : x, y, { align: c.align === 'right' ? 'right' : 'left' });
          x += c.w;
        });
        y += rh;
      };
      header();
      doc.setFont('helvetica', 'normal');
      rows.forEach((r) => {
        if (y > PH - 20) {
          newPage();
          y = 18;
          header();
          doc.setFont('helvetica', 'normal');
        }
        let x = ML + 2;
        doc.setFontSize(8);
        doc.setTextColor(INK);
        r.forEach((v, k) => {
          const c = cols[k];
          doc.text(String(v), c.align === 'right' ? x + c.w - 4 : x, y, { align: c.align === 'right' ? 'right' : 'left' });
          x += c.w;
        });
        doc.setDrawColor('#e5e7eb');
        doc.setLineWidth(0.15);
        doc.line(ML, y + 1.8, ML + CW, y + 1.8);
        y += rh;
      });
      y += 6;
    };

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Sides', ML, y);
    y += 6;
    table(
      [
        { label: 'Side', w: 30 },
        { label: 'Length (m)', w: 32, align: 'right' },
        { label: 'Length (ft)', w: 32, align: 'right' },
        { label: 'Bearing', w: 30, align: 'right' },
        { label: 'Faces', w: 40 },
        { label: '', w: 22 },
      ],
      m.sides.map((s, i) => [
        `P${s.from + 1} - P${s.to + 1}`,
        fmtNum(s.length, 2),
        fmtNum(s.length / M_PER_FT, 1),
        `${fmtNum(s.bearing, 1)}°`,
        s.facing != null ? compassName(s.facing) : '-',
        project.roadSide === i ? 'Road' : '',
      ]),
    );

    const zone = utmZone(m.proj.lng0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(INK);
    if (y > PH - 40) {
      newPage();
      y = 18;
    }
    doc.text(`Corners (UTM zone ${zone}${m.proj.lat0 >= 0 ? 'N' : 'S'}, WGS84)`, ML, y);
    y += 6;
    table(
      [
        { label: 'Corner', w: 16 },
        { label: 'Angle', w: 18, align: 'right' },
        { label: 'Latitude', w: 28, align: 'right' },
        { label: 'Longitude', w: 28, align: 'right' },
        { label: 'Easting', w: 26, align: 'right' },
        { label: 'Northing', w: 28, align: 'right' },
        { label: '± m', w: 16, align: 'right' },
        { label: 'How', w: 26 },
      ],
      project.points.map((q, i) => {
        const u = toUTM(q.lat, q.lng, zone);
        return [
          `P${i + 1}`,
          m.n >= 3 ? `${fmtNum(m.angles[i], 1)}°` : '-',
          q.lat.toFixed(7),
          q.lng.toFixed(7),
          u.E.toFixed(2),
          u.N.toFixed(2),
          q.acc != null ? fmtNum(q.acc, 1) : '-',
          methodText(q),
        ];
      }),
    );
  }

  // ---- photos -----------------------------------------------------------------
  const photos = project.photos;
  if (photos.length && getImage) {
    let slot = 2;
    for (let i = 0; i < photos.length; i++) {
      const ph = photos[i];
      let img = null;
      try {
        img = await getImage(ph);
      } catch {
        img = null;
      }
      if (slot >= 2) {
        newPage();
        slot = 0;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(INK);
        doc.text('Photos', ML, 18);
      }
      const top = 24 + slot * 132;
      const boxH = 110;
      if (img && img.dataUrl) {
        const r = Math.min(CW / img.w, boxH / img.h);
        const w = img.w * r;
        const hgt = img.h * r;
        try {
          doc.addImage(img.dataUrl, 'JPEG', ML + (CW - w) / 2, top, w, hgt, undefined, 'FAST');
        } catch (e) {
          console.warn(e);
        }
      } else {
        doc.setDrawColor(LINE);
        doc.rect(ML, top, CW, boxH, 'S');
        doc.setFontSize(9);
        doc.setTextColor(MUTED);
        doc.text('Photo not available on this device', ML + CW / 2, top + boxH / 2, { align: 'center' });
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(INK);
      doc.text(doc.splitTextToSize(`Photo ${i + 1}${ph.caption ? ': ' + ph.caption : ''}`, CW)[0], ML, top + boxH + 6);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(MUTED);
      const info = [dateTimeText(ph.t)];
      if (ph.lat != null) info.push(`${ph.lat.toFixed(6)}, ${ph.lng.toFixed(6)}${ph.acc ? ` (±${fmtNum(ph.acc, 0)} m)` : ''}`);
      const near = nearestCornerText(project, ph);
      if (near) info.push(near);
      doc.text(info.join('   |   '), ML, top + boxH + 11);
      slot += 1;
    }
  }

  footer();
  return doc.output('arraybuffer');
}

function nearestCornerText(project, ph) {
  if (ph.pointId) {
    const i = project.points.findIndex((q) => q.id === ph.pointId);
    if (i >= 0) return `At P${i + 1}`;
  }
  if (ph.lat == null || !project.points.length) return '';
  let best = null;
  project.points.forEach((q, i) => {
    const d = distanceMeters(ph.lat, ph.lng, q.lat, q.lng);
    if (!best || d < best.d) best = { i, d };
  });
  return best && best.d < 40 ? `${fmtNum(best.d, 0)} m from P${best.i + 1}` : '';
}

// Text centred on a point, rotated by `angle` degrees (anticlockwise).
function rotatedText(doc, str, [cx, cy], angle, sizePt) {
  const w = doc.getTextWidth(str);
  const hgt = sizePt * 0.3528;
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = -Math.sin(a);
  const downX = Math.sin(a);
  const downY = Math.cos(a);
  const x = cx - dx * (w / 2) + downX * (hgt * 0.35);
  const y = cy - dy * (w / 2) + downY * (hgt * 0.35);
  doc.text(str, x, y, angle ? { angle } : undefined);
}
