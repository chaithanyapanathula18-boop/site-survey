// Sheets used inside a project: corner, side, photo, details, export, map layers, location help.
import { h, icon, button, sheet, toast, confirmSheet, fmtDateTime } from './dom.js';
import { fmtLen, fmtNum, fmtAngle, compassName, distanceMeters, M_PER_FT, utmZone } from '../geo.js';
import { MAP_STYLES } from './mapview.js';
import { settings, updateSettings, gps } from '../app.js';
import { stores } from '../store/index.js';
import { buildDxf } from '../export/dxf.js';
import { buildKml, buildCsv, buildBackup } from '../export/text.js';
import { safeFileName, canShareFile, shareFile, downloadFile } from '../export/share.js';
import { blobToDataURL } from '../photos.js';

function infoRow(label, value) {
  return h('div', { class: 'fact' }, h('span', { class: 'fact-label' }, label), h('span', { class: 'fact-value' }, value));
}

export function cornerSheet(session, i, actions) {
  const q = session.project.points[i];
  if (!q) return null;
  const m = session.m;
  const live = gps.isFresh(30000) ? gps.last : null;
  const how = q.method === 'gps' ? `GPS${q.n ? `, ${q.n} reading${q.n === 1 ? '' : 's'}` : ''}` : q.method === 'moved' ? 'Moved by hand' : 'Placed on the map';
  const content = h(
    'div',
    { class: 'facts' },
    infoRow('How', how),
    q.acc != null ? infoRow('Accuracy', `±${fmtNum(q.acc, 1)} m`) : null,
    infoRow('Saved', fmtDateTime(q.t)),
    m.n >= 3 ? infoRow('Corner angle', fmtAngle(m.angles[i])) : null,
    infoRow('Position', `${q.lat.toFixed(7)}, ${q.lng.toFixed(7)}`),
    live ? infoRow('From you', `${fmtLen(distanceMeters(live.lat, live.lng, q.lat, q.lng), 'm')} (your GPS ±${fmtNum(live.acc, 0)} m)`) : null,
  );
  const s = sheet({
    title: `Corner P${i + 1}`,
    content,
    actions: [
      h(
        'div',
        { class: 'stack' },
        gps.supported ? button('Re-capture here with GPS', { icon: 'recapture', cls: 'secondary block', onClick: () => (s.close(), actions.recapture(i)) }) : null,
        button('Move on the map', { icon: 'move', cls: 'secondary block', onClick: () => (s.close(), actions.move(i)) }),
        button(`Add a corner after P${i + 1}`, { icon: 'insert', cls: 'secondary block', onClick: () => (s.close(), actions.insertAfter(i)) }),
        button(`Delete P${i + 1}`, { icon: 'trash', cls: 'danger-outline block', onClick: () => (s.close(), actions.remove(i)) }),
      ),
    ],
    onClose: () => actions.closed && actions.closed(),
  });
  return s;
}

export function sideSheet(session, i) {
  const m = session.m;
  const side = m.sides[i];
  if (!side) return;
  const isRoad = session.project.roadSide === i;
  const s = sheet({
    title: `Side P${side.from + 1}–P${side.to + 1}`,
    content: h(
      'div',
      { class: 'facts' },
      infoRow('Length', `${fmtLen(side.length, 'm')} · ${fmtNum(side.length / M_PER_FT, 1)} ft`),
      infoRow('Direction', `${fmtNum(side.bearing, 1)}° from north`),
      side.facing != null ? infoRow('Faces', compassName(side.facing)) : null,
    ),
    actions:
      m.n >= 3
        ? [
            button(isRoad ? 'Not the road side' : 'This side touches the road', {
              icon: 'road',
              cls: isRoad ? 'secondary block' : 'primary block',
              onClick: () => {
                session.setRoadSide(isRoad ? null : i);
                s.close();
              },
            }),
          ]
        : [],
  });
}

export async function photoSheet(session, id, { onShowOnMap } = {}) {
  const p = session.project;
  const ph = p.photos.find((x) => x.id === id);
  if (!ph) return;
  const idx = p.photos.indexOf(ph);
  const img = h('img', { class: 'photo-full', alt: ph.caption || `Photo ${idx + 1}`, src: ph.thumb || '' });
  let objectUrl = null;
  stores.active
    .getImage(p.id, ph.id)
    .then((blob) => {
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
      }
    })
    .catch(() => {});
  const caption = h('input', { class: 'input', type: 'text', placeholder: 'Add a caption, e.g. boundary stone', value: ph.caption || '' });
  caption.addEventListener('change', () => session.updatePhoto(ph.id, { caption: caption.value.trim() }));
  const cornerSel = h(
    'select',
    { class: 'input' },
    h('option', { value: '' }, 'Not linked to a corner'),
    p.points.map((q, i) => h('option', { value: q.id }, `P${i + 1}`)),
  );
  cornerSel.value = ph.pointId && p.points.some((q) => q.id === ph.pointId) ? ph.pointId : '';
  cornerSel.addEventListener('change', () => session.updatePhoto(ph.id, { pointId: cornerSel.value || null }));
  const s = sheet({
    title: ph.caption || `Photo ${idx + 1}`,
    wide: true,
    content: h(
      'div',
      { class: 'photo-sheet' },
      img,
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Caption'), caption),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Corner'), cornerSel),
      h(
        'p',
        { class: 'muted small' },
        fmtDateTime(ph.t),
        ph.lat != null ? ` · ${ph.lat.toFixed(6)}, ${ph.lng.toFixed(6)}${ph.acc ? ` (±${fmtNum(ph.acc, 0)} m)` : ''}` : ' · no location saved',
      ),
    ),
    actions: [
      ph.lat != null && onShowOnMap ? button('Show on map', { icon: 'map', cls: 'secondary', onClick: () => (s.close(), onShowOnMap(ph)) }) : null,
      button('Delete', {
        icon: 'trash',
        cls: 'danger-outline',
        onClick: async () => {
          const ok = await confirmSheet('Delete this photo?', 'The photo will be removed from this site.', { ok: 'Delete', danger: true });
          if (ok) {
            await session.deletePhoto(ph.id);
            s.close();
            toast('Photo deleted');
          }
        },
      }),
    ].filter(Boolean),
    onClose: () => {
      if (caption.value.trim() !== (ph.caption || '')) session.updatePhoto(ph.id, { caption: caption.value.trim() });
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    },
  });
}

export function detailsSheet(session) {
  const p = session.project;
  const field = (label, key, placeholder, multiline) => {
    const input = multiline
      ? h('textarea', { class: 'input', rows: 3, placeholder })
      : h('input', { class: 'input', type: 'text', placeholder, autocomplete: 'off' });
    input.value = p[key] || '';
    input.dataset.key = key;
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input);
  };
  const form = h(
    'form',
    { class: 'form', onsubmit: (e) => e.preventDefault() },
    field('Site name', 'name', 'e.g. Plot 42, Green Valley'),
    field('Survey number', 'surveyNo', 'e.g. 123/4A'),
    field('Village or area', 'village', 'e.g. Kondapur'),
    field('Owner', 'owner', 'Name'),
    field('Notes', 'notes', 'Anything worth remembering about this site', true),
  );
  const s = sheet({
    title: 'Site details',
    content: form,
    actions: [
      button('Cancel', { cls: 'secondary', onClick: () => s.close() }),
      button('Save', {
        cls: 'primary',
        onClick: () => {
          const patch = {};
          form.querySelectorAll('[data-key]').forEach((el) => (patch[el.dataset.key] = el.value.trim()));
          if (!patch.name) patch.name = 'Untitled site';
          session.updateDetails(patch);
          s.close();
          toast('Details saved');
        },
      }),
    ],
  });
}

export function layersSheet() {
  const radios = Object.entries(MAP_STYLES).map(([key, st]) =>
    h(
      'label',
      { class: 'radio-row' },
      h('input', {
        type: 'radio',
        name: 'mapstyle',
        value: key,
        checked: settings.mapStyle === key,
        onchange: () => updateSettings({ mapStyle: key }),
      }),
      h('span', null, st.name),
    ),
  );
  const toggle = (label, key) =>
    h(
      'label',
      { class: 'toggle-row' },
      h('span', null, label),
      h('input', { type: 'checkbox', checked: !!settings[key], onchange: (e) => updateSettings({ [key]: e.target.checked }) }),
    );
  sheet({
    title: 'Map',
    content: h(
      'div',
      { class: 'form' },
      h('div', { class: 'radio-group' }, radios),
      toggle('Show side lengths', 'showSideLengths'),
      toggle('Show photos', 'showPhotosOnMap'),
      h('p', { class: 'muted small' }, 'Map data © OpenStreetMap contributors, © CARTO. Map tiles you have viewed are kept for offline use.'),
    ),
  });
}

export function locationHelpSheet(state) {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const lines =
    state === 'unavailable'
      ? ['This browser cannot use GPS. Open the app in Safari (iPhone) or Chrome (Android).']
      : ios
        ? [
            'Location access is blocked for this app.',
            'On iPhone: open Settings, then Privacy & Security, then Location Services. Make sure Location Services is on and Safari Websites is set to "While Using the App".',
            'Then come back here and tap My location again.',
          ]
        : ['Location access is blocked for this app.', 'Allow location for this site in your browser settings, then reload the page.'];
  sheet({ title: 'Location needed', content: h('div', null, lines.map((t) => h('p', { class: 'sheet-text' }, t))) });
}

// ---- export ---------------------------------------------------------------------

async function deliver(blob, filename, mode, title) {
  try {
    if (mode === 'share') {
      const r = await shareFile(blob, filename, title);
      if (r === 'shared') toast('Shared');
    } else {
      downloadFile(blob, filename);
      toast(`Saved ${filename}`);
    }
  } catch (e) {
    console.error(e);
    downloadFile(blob, filename);
    toast(`Saved ${filename}`);
  }
}

export function exportSheet(session) {
  const p = session.project;
  const m = session.m;
  let dxfCoords = settings.dxfCoords || 'utm';
  const zone = m.n ? `${utmZone(m.proj.lng0)}${m.proj.lat0 >= 0 ? 'N' : 'S'}` : '';

  const getPhotoForPdf = async (ph) => {
    const blob = await stores.active.getImage(p.id, ph.id);
    if (!blob) {
      if (ph.thumb) return { dataUrl: ph.thumb, w: ph.w || 200, h: ph.h || 150 };
      return null;
    }
    const dataUrl = await blobToDataURL(blob);
    const dims = await new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => resolve({ w: ph.w || 1600, h: ph.h || 1200 });
      im.src = dataUrl;
    });
    return { dataUrl, ...dims };
  };

  const items = [
    {
      key: 'pdf',
      title: 'Site plan (PDF)',
      desc: 'Drawing to scale, measurements, coordinates and photos.',
      needs: 2,
      ext: 'pdf',
      make: async () => {
        const { buildPdf } = await import('../export/pdf.js');
        const buf = await buildPdf(p, { getImage: getPhotoForPdf });
        return new Blob([buf], { type: 'application/pdf' });
      },
    },
    {
      key: 'dxf',
      title: 'CAD drawing (DXF)',
      desc: 'Opens in AutoCAD, BricsCAD, LibreCAD and others.',
      needs: 1,
      ext: 'dxf',
      extra: () => {
        const seg = h(
          'div',
          { class: 'segmented small' },
          [
            ['utm', `Real-world (UTM ${zone})`],
            ['local', 'Local (P1 = 0,0)'],
          ].map(([v, label]) =>
            h(
              'button',
              {
                type: 'button',
                class: v === dxfCoords ? 'on' : '',
                onclick: (e) => {
                  dxfCoords = v;
                  updateSettings({ dxfCoords: v });
                  seg.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
                  e.currentTarget.classList.add('on');
                },
              },
              label,
            ),
          ),
        );
        return seg;
      },
      make: async () => new Blob([buildDxf(p, { coords: dxfCoords })], { type: 'application/dxf' }),
    },
    {
      key: 'kml',
      title: 'Google Earth (KML)',
      desc: 'Boundary, corners and photo spots for Google Earth or Maps.',
      needs: 1,
      ext: 'kml',
      make: async () => new Blob([buildKml(p)], { type: 'application/vnd.google-earth.kml+xml' }),
    },
    {
      key: 'csv',
      title: 'Coordinates (CSV)',
      desc: 'Every corner with latitude, longitude, UTM and accuracy.',
      needs: 1,
      ext: 'csv',
      make: async () => new Blob([buildCsv(p)], { type: 'text/csv' }),
    },
    {
      key: 'backup',
      title: 'Backup file',
      desc: 'The whole site with photos. Import it later on any device.',
      needs: 0,
      ext: 'sitesurvey.json',
      make: async () =>
        new Blob(
          [
            await buildBackup(p, async (phid) => {
              const blob = await stores.active.getImage(p.id, phid);
              return blob ? blobToDataURL(blob) : null;
            }),
          ],
          { type: 'application/json' },
        ),
    },
  ];

  const list = h('div', { class: 'export-list' });
  items.forEach((it) => {
    const enough = m.n >= it.needs;
    const busy = h('span', { class: 'busy', hidden: true }, 'Preparing…');
    const run = async (mode) => {
      busy.hidden = false;
      try {
        const blob = await it.make();
        const filename = safeFileName(p.name, it.ext);
        await deliver(blob, filename, mode, p.name);
      } catch (e) {
        console.error(e);
        toast(e.message || 'Could not create the file');
      } finally {
        busy.hidden = true;
      }
    };
    const probe = new Blob(['x'], { type: it.key === 'pdf' ? 'application/pdf' : it.key === 'csv' ? 'text/csv' : 'application/octet-stream' });
    const shareable = canShareFile(probe, `test.${it.ext}`);
    list.append(
      h(
        'div',
        { class: `export-row ${enough ? '' : 'disabled'}` },
        h('div', { class: 'export-text' }, h('strong', null, it.title), h('span', { class: 'muted small' }, enough ? it.desc : `Needs at least ${it.needs} corners.`), busy),
        it.extra && enough ? it.extra() : null,
        h(
          'div',
          { class: 'export-buttons' },
          shareable ? button('Share', { icon: 'share', cls: 'secondary small', disabled: !enough, onClick: () => run('share') }) : null,
          button('Download', { icon: 'download', cls: 'secondary small', disabled: !enough, onClick: () => run('download') }),
        ),
      ),
    );
  });
  sheet({ title: 'Export & share', content: list, wide: true });
}
