// Data tab: area in every unit, sides, angles, facing and the corner list.
import { h, clear, icon, button } from './dom.js';
import { AREA_UNITS, fmtArea, fmtLen, fmtNum, fmtAngle, compassName, compass8, M_PER_FT, roundSig } from '../geo.js';
import { accuracyQuality, FAIR_ACC } from '../gps.js';

function methodLabel(q) {
  if (q.method === 'gps') return q.n ? `GPS · ${q.n} reading${q.n === 1 ? '' : 's'}` : 'GPS';
  if (q.method === 'moved') return 'Moved by hand';
  return 'Placed on map';
}

export function createDataView(container, ctx) {
  function render() {
    const s = ctx.session();
    clear(container);
    if (!s) return;
    const p = s.project;
    const m = s.m;
    const st = ctx.settings();
    const wrap = h('div', { class: 'data-wrap' });

    // Area card
    const areaCard = h('section', { class: 'card area-card' });
    if (m.n >= 3) {
      areaCard.append(
        h('div', { class: 'card-label' }, 'Area'),
        h('div', { class: 'area-big' }, fmtArea(m.area, st.areaUnit)),
        m.areaSigma > 0
          ? h('div', { class: 'area-sigma' }, `About ±${fmtArea(roundSig(m.areaSigma), st.areaUnit === 'sqm' ? 'sqm' : st.areaUnit)} from GPS accuracy`)
          : null,
        h(
          'div',
          { class: 'unit-grid' },
          AREA_UNITS.filter((u) => u.key !== st.areaUnit).map((u) =>
            h('div', { class: 'unit-cell' }, h('span', { class: 'unit-value' }, fmtArea(m.area, u.key)), h('span', { class: 'unit-name' }, u.label)),
          ),
        ),
      );
    } else {
      areaCard.append(
        h('div', { class: 'card-label' }, 'Area'),
        h('p', { class: 'muted' }, m.n === 0 ? 'Add at least 3 corners to see the area.' : `Add ${3 - m.n} more corner${3 - m.n === 1 ? '' : 's'} to see the area.`),
      );
    }
    wrap.append(areaCard);

    // Shape facts and warnings
    const facts = h('section', { class: 'card' }, h('div', { class: 'card-label' }, 'Boundary'));
    const row = (label, value, extra) => h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, label), h('span', { class: 'fact-value' }, value), extra || null);
    facts.append(row('Corners', String(m.n)));
    if (m.n >= 2) facts.append(row('Perimeter', `${fmtLen(m.perimeter, 'm')} · ${fmtNum(m.perimeter / M_PER_FT, 1)} ft`));
    if (m.n >= 3) {
      if (p.roadSide != null && m.sides[p.roadSide] && m.sides[p.roadSide].facing != null) {
        facts.append(row('Facing', `${compassName(m.sides[p.roadSide].facing)} (road on P${p.roadSide + 1}–P${((p.roadSide + 1) % m.n) + 1})`));
      } else {
        facts.append(row('Facing', 'Mark the road side below'));
      }
    }
    const weak = p.points.map((q, i) => ({ q, i })).filter(({ q }) => q.method === 'gps' && q.acc > FAIR_ACC);
    if (m.selfIntersecting) facts.append(h('div', { class: 'warning' }, icon('warn'), h('span', null, 'Boundary lines cross each other. Check that the corners are in walking order (use Delete or Move on the Map tab).')));
    if (weak.length) facts.append(h('div', { class: 'warning' }, icon('warn'), h('span', null, `Weak GPS at ${weak.map(({ i }) => 'P' + (i + 1)).join(', ')}. Re-capture those corners in open sky if you can.`)));
    wrap.append(facts);

    // Sides
    if (m.sides.length) {
      const sides = h('section', { class: 'card' }, h('div', { class: 'card-label' }, 'Sides'));
      if (m.n >= 3) sides.append(h('p', { class: 'muted small' }, 'Tap the road button on the side that touches the road.'));
      const list = h('div', { class: 'side-list' });
      m.sides.forEach((side, i) => {
        const isRoad = p.roadSide === i;
        list.append(
          h(
            'div',
            { class: `side-row ${isRoad ? 'road' : ''}` },
            h('div', { class: 'side-name' }, `P${side.from + 1}–P${side.to + 1}`),
            h('div', { class: 'side-len' }, h('strong', null, fmtLen(side.length, st.lengthUnit)), h('span', { class: 'muted' }, st.lengthUnit === 'ft' ? fmtLen(side.length, 'm') : `${fmtNum(side.length / M_PER_FT, 1)} ft`)),
            h('div', { class: 'side-face' }, side.facing != null ? `Faces ${compass8(side.facing)}` : `${fmtNum(side.bearing, 0)}°`),
            m.n >= 3
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: `chip-btn ${isRoad ? 'on' : ''}`,
                    'aria-pressed': isRoad ? 'true' : 'false',
                    onclick: () => s.setRoadSide(isRoad ? null : i),
                  },
                  icon('road'),
                  isRoad ? 'Road' : 'Road?',
                )
              : null,
          ),
        );
      });
      sides.append(list);
      wrap.append(sides);
    }

    // Corners
    if (m.n) {
      const corners = h('section', { class: 'card' }, h('div', { class: 'card-label' }, 'Corners'));
      const list = h('div', { class: 'corner-list' });
      p.points.forEach((q, i) => {
        const qual = q.method === 'gps' ? accuracyQuality(q.acc) : 'manual';
        list.append(
          h(
            'button',
            { type: 'button', class: 'corner-row', onclick: () => ctx.onCornerTap(i) },
            h('span', { class: `corner-dot q-${qual}` }, String(i + 1)),
            h(
              'span',
              { class: 'corner-info' },
              h('span', { class: 'corner-main' }, `P${i + 1}`, m.n >= 3 ? h('span', { class: 'muted' }, ` · ${fmtAngle(m.angles[i])}`) : null),
              h('span', { class: 'muted small' }, `${methodLabel(q)}${q.acc != null ? ` · ±${fmtNum(q.acc, 1)} m` : ''}`),
              h('span', { class: 'muted small mono' }, `${q.lat.toFixed(7)}, ${q.lng.toFixed(7)}`),
            ),
          ),
        );
      });
      corners.append(list);
      wrap.append(corners);
    }

    wrap.append(
      h(
        'div',
        { class: 'data-actions' },
        button('Export & share', { icon: 'share', cls: 'primary block', onClick: () => ctx.openExport() }),
      ),
    );
    container.append(wrap);
  }
  return { render };
}
