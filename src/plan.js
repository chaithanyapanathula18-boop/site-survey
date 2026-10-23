// Shared drawing geometry for the plan view, PDF and DXF (local metres, y = north).

function unit(x, y) {
  const l = Math.hypot(x, y);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: x / l, y: y / l };
}

export function sideGeometry(m, i) {
  const s = m.sides[i];
  const a = m.xy[s.from];
  const b = m.xy[s.to];
  const dir = unit(b.x - a.x, b.y - a.y);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let normal;
  if (s.facing != null) {
    const r = (s.facing * Math.PI) / 180;
    normal = { x: Math.sin(r), y: Math.cos(r) };
  } else {
    normal = { x: -dir.y, y: dir.x };
  }
  // text angle along the side, kept upright (degrees, anticlockwise from east)
  let angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  return { a, b, mid, dir, normal, angle, length: s.length };
}

export function innerBisector(m, i) {
  const n = m.xy.length;
  const cur = m.xy[i];
  const prev = m.xy[(i - 1 + n) % n];
  const next = m.xy[(i + 1) % n];
  const u = unit(prev.x - cur.x, prev.y - cur.y);
  const v = unit(next.x - cur.x, next.y - cur.y);
  let b = unit(u.x + v.x, u.y + v.y);
  if (b.x === 0 && b.y === 0) {
    const d = unit(next.x - prev.x, next.y - prev.y);
    b = m.orientation === 'ccw' ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x };
  } else if (m.angles[i] > 180) {
    b = { x: -b.x, y: -b.y };
  }
  return b;
}

// A "nice" drawing scale (1:N) so the plot fits a frame of the given size in mm.
export function chooseScale(widthM, heightM, frameWmm, frameHmm) {
  const need = Math.max((widthM * 1000) / frameWmm, (heightM * 1000) / frameHmm, 1);
  const steps = [1, 1.25, 2, 2.5, 5];
  for (let p = 1; p <= 1e7; p *= 10) {
    for (const s of steps) {
      const n = s * p;
      if (n >= need) return n;
    }
  }
  return Math.ceil(need);
}
