// Plan tab: a CAD-style drawing of the boundary with lengths, angles, north arrow and scale.
import { fmtLen, fmtAngle, fmtArea, niceStep, M_PER_FT, fmtNum } from '../geo.js';
import { sideGeometry, innerBisector } from '../plan.js';

const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
  if (text != null) e.textContent = text;
  return e;
}

export function createPlanView(container, ctx) {
  const svg = el('svg', { class: 'plan-svg', role: 'img', 'aria-label': 'Site plan drawing' });
  container.append(svg);
  let view = null; // { scale: px per metre, cx, cy }
  let auto = true;
  let rafPending = false;
  const pointers = new Map();
  let gesture = null;

  function size() {
    return { w: container.clientWidth || 360, h: container.clientHeight || 500 };
  }

  function fit(m, w, h) {
    const bb = m.bbox;
    const padTop = 88; // room for the north arrow and scale bar
    const padBottom = (ctx.bottomInset ? ctx.bottomInset() : 60) + 40;
    const padSide = 56;
    const bw = Math.max(bb.maxX - bb.minX, 1);
    const bh = Math.max(bb.maxY - bb.minY, 1);
    const scale = Math.min((w - 2 * padSide) / bw, (h - padTop - padBottom) / bh);
    view = {
      scale: Math.max(Math.min(scale, 400), 0.01),
      cx: (bb.minX + bb.maxX) / 2,
      cy: (bb.minY + bb.maxY) / 2 - (padBottom - padTop) / 2 / Math.max(Math.min(scale, 400), 0.01),
    };
  }

  function schedule() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      render();
    });
  }

  function render() {
    const s = ctx.session();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (!s) return;
    const { w, h } = size();
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    const p = s.project;
    const m = s.m;
    const st = ctx.settings();
    const live = ctx.live();

    if (m.n === 0) {
      svg.append(el('text', { x: w / 2, y: h / 2 - 10, class: 'plan-empty', 'text-anchor': 'middle' }, 'No corners yet'));
      svg.append(el('text', { x: w / 2, y: h / 2 + 14, class: 'plan-empty small', 'text-anchor': 'middle' }, 'Add corners on the Map tab'));
      return;
    }
    if (auto || !view) fit(m, w, h);
    const k = view.scale;
    const T = (x, y) => [w / 2 + (x - view.cx) * k, h / 2 - (y - view.cy) * k];

    // grid
    const step = niceStep(70 / k);
    const g = el('g', { class: 'plan-grid' });
    const x0 = view.cx - w / 2 / k;
    const x1 = view.cx + w / 2 / k;
    const y0 = view.cy - h / 2 / k;
    const y1 = view.cy + h / 2 / k;
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
      const [sx] = T(x, 0);
      g.append(el('line', { x1: sx, y1: 0, x2: sx, y2: h }));
    }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
      const [, sy] = T(0, y);
      g.append(el('line', { x1: 0, y1: sy, x2: w, y2: sy }));
    }
    svg.append(g);

    const pts = m.xy.map((q) => T(q.x, q.y));
    if (m.n >= 3) {
      svg.append(el('polygon', { points: pts.map((q) => q.join(',')).join(' '), class: 'plan-poly' }));
    } else if (m.n === 2) {
      svg.append(el('polyline', { points: pts.map((q) => q.join(',')).join(' '), class: 'plan-line' }));
    }

    // road side
    if (p.roadSide != null && m.n >= 3 && m.sides[p.roadSide]) {
      const sg = sideGeometry(m, p.roadSide);
      const [ax, ay] = T(sg.a.x, sg.a.y);
      const [bx, by] = T(sg.b.x, sg.b.y);
      svg.append(el('line', { x1: ax, y1: ay, x2: bx, y2: by, class: 'plan-road' }));
      const [mx, my] = T(sg.mid.x, sg.mid.y);
      const off = 44;
      const tx = mx + sg.normal.x * off;
      const ty = my - sg.normal.y * off;
      svg.append(el('text', { x: tx, y: ty, class: 'plan-road-label', 'text-anchor': 'middle', 'dominant-baseline': 'middle', transform: `rotate(${-sg.angle} ${tx} ${ty})` }, 'ROAD'));
    }

    // side lengths
    m.sides.forEach((side, i) => {
      const sg = sideGeometry(m, i);
      const [mx, my] = T(sg.mid.x, sg.mid.y);
      const screenLen = side.length * k;
      const off = 16;
      const tx = mx + sg.normal.x * off;
      const ty = my - sg.normal.y * off;
      const t = el('text', {
        x: tx,
        y: ty,
        class: `plan-side ${screenLen < 70 ? 'tight' : ''}`,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        transform: `rotate(${-sg.angle} ${tx} ${ty})`,
        'data-side': i,
      });
      const primary = st.lengthUnit === 'ft' ? fmtLen(side.length, 'ft') : fmtLen(side.length, 'm');
      const secondary = st.lengthUnit === 'ft' ? fmtLen(side.length, 'm') : `${fmtNum(side.length / M_PER_FT, 1)} ft`;
      t.append(el('tspan', { x: tx, dy: screenLen < 70 ? 0 : '-0.45em' }, primary));
      if (screenLen >= 70) t.append(el('tspan', { x: tx, dy: '1.15em', class: 'secondary' }, secondary));
      svg.append(t);
    });

    // corner angles
    if (m.n >= 3) {
      m.angles.forEach((a, i) => {
        const b = innerBisector(m, i);
        const [cx, cy] = pts[i];
        const off = 26;
        svg.append(el('text', { x: cx + b.x * off, y: cy - b.y * off, class: 'plan-angle', 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, fmtAngle(a)));
      });
    }

    // area at the centroid
    if (m.n >= 3 && m.centroid) {
      const [ax, ay] = T(m.centroid.x, m.centroid.y);
      svg.append(el('text', { x: ax, y: ay - 6, class: 'plan-area', 'text-anchor': 'middle' }, fmtArea(m.area, st.areaUnit)));
      const second = st.areaUnit === 'sqyd' ? fmtArea(m.area, 'sqft') : fmtArea(m.area, 'sqyd');
      svg.append(el('text', { x: ax, y: ay + 12, class: 'plan-area secondary', 'text-anchor': 'middle' }, second));
    }

    // photos
    if (st.showPhotosOnMap) {
      p.photos.forEach((ph) => {
        if (ph.lat == null) return;
        const q = m.proj.toXY(ph.lat, ph.lng);
        const [x, y] = T(q.x, q.y);
        const gp = el('g', { class: 'plan-photo', 'data-photo': ph.id, transform: `translate(${x} ${y})` });
        gp.append(el('circle', { r: 10 }));
        gp.append(el('path', { d: 'M-5 -2.5h2l1-1.5h4l1 1.5h2v6h-10z', class: 'cam' }));
        svg.append(gp);
      });
    }

    // corners
    pts.forEach(([x, y], i) => {
      const gc = el('g', { class: `plan-corner ${s.selected === i ? 'selected' : ''}`, 'data-corner': i, transform: `translate(${x} ${y})` });
      gc.append(el('circle', { r: 11 }));
      gc.append(el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, String(i + 1)));
      svg.append(gc);
    });

    // live location
    if (live && m.proj) {
      const q = m.proj.toXY(live.lat, live.lng);
      const [x, y] = T(q.x, q.y);
      const near = ctx.nearest ? ctx.nearest(live) : null;
      if (near && ctx.showNearest()) {
        const [nx, ny] = pts[near.i];
        svg.append(el('line', { x1: x, y1: y, x2: nx, y2: ny, class: 'plan-nearest' }));
      }
      svg.append(el('circle', { cx: x, cy: y, r: Math.max((live.acc || 0) * k, 0), class: 'plan-me-acc' }));
      svg.append(el('circle', { cx: x, cy: y, r: 7, class: 'plan-me' }));
    }

    // north arrow (top right)
    const na = el('g', { class: 'plan-north', transform: `translate(${w - 30} 58)` });
    na.append(el('path', { d: 'M0 -22 L9 10 L0 4 L-9 10 Z' }));
    na.append(el('text', { x: 0, y: -28, 'text-anchor': 'middle' }, 'N'));
    svg.append(na);

    // scale bar (top left, beside the fit button)
    const len = niceStep(110 / k);
    const px = len * k;
    const sb = el('g', { class: 'plan-scale', transform: `translate(66 44)` });
    sb.append(el('rect', { x: 0, y: -4, width: px / 2, height: 6, class: 'dark' }));
    sb.append(el('rect', { x: px / 2, y: -4, width: px / 2, height: 6, class: 'light' }));
    sb.append(el('text', { x: 0, y: -10 }, '0'));
    sb.append(el('text', { x: px, y: -10, 'text-anchor': 'end' }, len >= 1000 ? `${fmtNum(len / 1000, 1)} km` : `${fmtNum(len, len < 1 ? 1 : 0)} m`));
    svg.append(sb);
  }

  // ---- interaction ---------------------------------------------------------
  function hitTest(x, y) {
    const t = document.elementFromPoint(x, y);
    if (!t) return null;
    const corner = t.closest && t.closest('[data-corner]');
    if (corner) return { type: 'corner', index: Number(corner.getAttribute('data-corner')) };
    const photo = t.closest && t.closest('[data-photo]');
    if (photo) return { type: 'photo', id: photo.getAttribute('data-photo') };
    const side = t.closest && t.closest('[data-side]');
    if (side) return { type: 'side', index: Number(side.getAttribute('data-side')) };
    return null;
  }

  function nearestSide(sx, sy) {
    const s = ctx.session();
    if (!s || !view) return null;
    const m = s.m;
    const rect = svg.getBoundingClientRect();
    const { w, h } = size();
    const x = view.cx + (sx - rect.left - w / 2) / view.scale;
    const y = view.cy - (sy - rect.top - h / 2) / view.scale;
    let best = null;
    m.sides.forEach((side, i) => {
      const a = m.xy[side.from];
      const b = m.xy[side.to];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2));
      const d = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)) * view.scale;
      if (!best || d < best.d) best = { i, d };
    });
    return best && best.d < 22 ? best.i : null;
  }

  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
    if (!view) return;
    if (pointers.size === 1) gesture = { type: 'pan', view: { ...view }, x: e.clientX, y: e.clientY, moved: false };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { type: 'pinch', view: { ...view }, d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, moved: true };
    }
  });

  svg.addEventListener('pointermove', (e) => {
    const ptr = pointers.get(e.pointerId);
    if (!ptr || !gesture || !view) return;
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    if (gesture.type === 'pan' && pointers.size === 1) {
      const dx = e.clientX - gesture.x;
      const dy = e.clientY - gesture.y;
      if (Math.hypot(dx, dy) > 6) gesture.moved = true;
      if (!gesture.moved) return;
      auto = false;
      view = { ...gesture.view, cx: gesture.view.cx - dx / gesture.view.scale, cy: gesture.view.cy + dy / gesture.view.scale };
      schedule();
    } else if (gesture.type === 'pinch' && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const f = d / (gesture.d || 1);
      zoomAt(gesture.mx, gesture.my, gesture.view, f);
      schedule();
    }
  });

  function zoomAt(clientX, clientY, base, factor) {
    const rect = svg.getBoundingClientRect();
    const { w, h } = size();
    const px = clientX - rect.left - w / 2;
    const py = clientY - rect.top - h / 2;
    const scale = Math.min(Math.max(base.scale * factor, 0.005), 2000);
    const wx = base.cx + px / base.scale;
    const wy = base.cy - py / base.scale;
    auto = false;
    view = { scale, cx: wx - px / scale, cy: wy + py / scale };
  }

  function endPointer(e) {
    const ptr = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (!ptr) return;
    const tap = gesture && gesture.type === 'pan' && !gesture.moved && performance.now() - ptr.t0 < 500;
    if (pointers.size === 0) gesture = null;
    else if (pointers.size === 1 && view) {
      const [only] = [...pointers.values()];
      gesture = { type: 'pan', view: { ...view }, x: only.x, y: only.y, moved: true };
    }
    if (tap) {
      const hit = hitTest(e.clientX, e.clientY);
      if (hit && hit.type === 'corner') ctx.onCornerTap && ctx.onCornerTap(hit.index);
      else if (hit && hit.type === 'photo') ctx.onPhotoTap && ctx.onPhotoTap(hit.id);
      else {
        const si = hit && hit.type === 'side' ? hit.index : nearestSide(e.clientX, e.clientY);
        if (si != null) ctx.onSideTap && ctx.onSideTap(si);
      }
    }
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener(
    'wheel',
    (e) => {
      if (!view) return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, view, Math.exp(-e.deltaY * 0.0015));
      schedule();
    },
    { passive: false },
  );
  svg.addEventListener('dblclick', () => {
    auto = true;
    schedule();
  });

  return {
    render: schedule,
    renderNow: render,
    reset() {
      auto = true;
      schedule();
    },
  };
}
