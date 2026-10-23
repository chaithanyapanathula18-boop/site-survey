// Project screen: header, tabs, map overlay controls, corner capture, My Location and photos.
import { h, clear, icon, button, sheet, toast, confirmSheet } from './dom.js';
import { settings, updateSettings, gps, awake, bus, openSession, account } from '../app.js';
import { stores } from '../store/index.js';
import { uid, MAX_PHOTOS } from '../model.js';
import { fmtArea, fmtLen, fmtNum, distanceMeters } from '../geo.js';
import { accuracyQuality, FAIR_ACC } from '../gps.js';
import { processPhoto } from '../photos.js';
import { createMapView } from './mapview.js';
import { createPlanView } from './planview.js';
import { createDataView } from './dataview.js';
import { createPhotosView } from './photosview.js';
import { cornerSheet, sideSheet, photoSheet, detailsSheet, exportSheet, layersSheet, locationHelpSheet } from './sheets.js';
import { settingsSheet } from './settings.js';

const TABS = [
  { key: 'map', label: 'Map', icon: 'map' },
  { key: 'plan', label: 'Plan', icon: 'plan' },
  { key: 'data', label: 'Data', icon: 'table' },
  { key: 'photos', label: 'Photos', icon: 'image' },
];

const PHOTO_LINK_M = 5; // a photo this close to a corner is linked to it

export async function showProject(root, id, initialTab = 'map') {
  let raw;
  try {
    raw = await stores.active.getProject(id);
  } catch (e) {
    console.error(e);
    raw = null;
  }
  if (!raw) return null;
  const session = openSession(raw);
  const p = () => session.project;

  let tab = TABS.some((t) => t.key === initialTab) ? initialTab : 'map';
  let moving = null; // corner index being dragged on the map
  let showNearest = false; // after My Location: line + distance to the nearest corner
  let capture = null; // running GPS capture
  const dirty = new Set();
  const disposers = [];

  // ---- layout ------------------------------------------------------------------
  clear(root);
  const titleName = h('span', { class: 'title-name' });
  const titleSub = h('span', { class: 'title-sub' });
  const header = h(
    'header',
    { class: 'topbar project-top' },
    h('a', { class: 'icon-btn', href: '#/', 'aria-label': 'All sites', title: 'All sites' }, icon('back')),
    h('button', { type: 'button', class: 'title-btn', 'aria-label': 'Site details', onclick: () => detailsSheet(session) }, titleName, titleSub),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'More', title: 'More', onclick: moreMenu }, icon('more')),
  );

  const mapEl = h('div', { class: 'map' });
  const planEl = h('div', { class: 'plan' });
  const dataEl = h('div', { class: 'scroll-pane' });
  const photosEl = h('div', { class: 'scroll-pane' });

  const nearestChip = h('div', { class: 'nearest-chip', hidden: true });
  const mapControls = h(
    'div',
    { class: 'map-controls' },
    h('button', { type: 'button', class: 'fab small', 'aria-label': 'Map style', title: 'Map style', onclick: () => layersSheet() }, icon('layers')),
    h('button', { type: 'button', class: 'fab small', 'aria-label': 'Show the whole plot', title: 'Show the whole plot', onclick: fitPlot }, icon('fit')),
  );
  const locateBtn = h('button', { type: 'button', class: 'fab locate-btn', 'aria-label': 'My location', title: 'My location', onclick: myLocation }, icon('locate'));

  // survey panel (bottom of the map)
  const gpsLine = h('button', { type: 'button', class: 'gps-line', onclick: onGpsLineTap });
  const banner = h('div', { class: 'panel-banner', hidden: true });
  const undoBtn = h('button', { type: 'button', class: 'icon-btn round', 'aria-label': 'Undo', title: 'Undo', onclick: undo }, icon('undo'));
  const camBtn = h('button', { type: 'button', class: 'icon-btn round', 'aria-label': 'Take photo', title: 'Take photo', onclick: () => takePhoto(true) }, icon('camera'));
  const captureBtn = button('Capture corner', { icon: 'pin', cls: 'primary capture-btn', onClick: () => startCapture(null) });
  const tapHint = h('div', { class: 'tap-hint' }, 'Tap the map at each corner, in order around the plot.');
  const mainRow = h('div', { class: 'panel-main' }, undoBtn, captureBtn, tapHint, camBtn);
  const modeSeg = h(
    'div',
    { class: 'segmented mode-seg', role: 'group', 'aria-label': 'How to add corners' },
    [
      ['walk', 'Walk with GPS'],
      ['tap', 'Tap on map'],
    ].map(([v, label]) => h('button', { type: 'button', 'data-mode': v, onclick: () => setMode(v) }, label)),
  );
  const panel = h('div', { class: 'survey-panel' }, gpsLine, banner, mainRow, modeSeg);

  const planFit = h('button', { type: 'button', class: 'fab small plan-fit', 'aria-label': 'Fit drawing', title: 'Fit drawing', onclick: () => planView.reset() }, icon('fit'));

  const panes = {
    map: h('section', { class: 'tab-pane map-pane' }, mapEl, mapControls, nearestChip, locateBtn, panel),
    plan: h('section', { class: 'tab-pane plan-pane' }, planEl, planFit),
    data: h('section', { class: 'tab-pane' }, dataEl),
    photos: h('section', { class: 'tab-pane' }, photosEl),
  };
  const tabButtons = {};
  const tabbar = h(
    'nav',
    { class: 'tabbar', 'aria-label': 'Views' },
    TABS.map((t) =>
      (tabButtons[t.key] = h(
        'button',
        { type: 'button', class: 'tab', 'data-tab': t.key, onclick: () => setTab(t.key) },
        icon(t.icon),
        h('span', null, t.label),
      )),
    ),
  );

  const cameraInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: (e) => onPhotoFiles(e, true) });
  const galleryInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => onPhotoFiles(e, false) });

  const overlay = h('div', { class: 'capture-overlay', hidden: true });

  const screen = h(
    'div',
    { class: 'screen project-screen' },
    header,
    h('main', { class: 'project-main' }, Object.values(panes)),
    tabbar,
    cameraInput,
    galleryInput,
    overlay,
  );
  root.append(screen);

  // ---- views -----------------------------------------------------------------------
  const live = () => (gps.isFresh(30000) ? gps.last : null);
  const common = {
    session: () => session,
    settings: () => settings,
    live,
    showNearest: () => showNearest,
    onCornerTap: openCorner,
    onPhotoTap: openPhoto,
  };
  const mapView = createMapView(mapEl, {
    ...common,
    bottomInset: () => panel.offsetHeight || 160,
    onMapTap,
    onCornerMoved: (i, lat, lng) => session.movePoint(i, lat, lng),
  });
  const planView = createPlanView(planEl, {
    ...common,
    bottomInset: () => 16,
    onSideTap: (i) => sideSheet(session, i),
    nearest: (fix) => mapView.nearestCorner(fix),
  });
  const dataView = createDataView(dataEl, { ...common, openExport: () => exportSheet(session) });
  const photosView = createPhotosView(photosEl, { ...common, takePhoto });

  const views = { map: () => mapView.render(), plan: () => planView.render(), data: () => dataView.render(), photos: () => photosView.render() };

  function renderAll() {
    renderHeader();
    renderPanel();
    for (const k of Object.keys(views)) {
      if (k === tab) views[k]();
      else dirty.add(k);
    }
  }

  function renderHeader() {
    const pr = p();
    titleName.textContent = pr.name || 'Untitled site';
    const m = session.m;
    titleSub.textContent =
      m.n >= 3 ? `${fmtArea(m.area, settings.areaUnit)} · ${m.n} corners` : m.n ? `${m.n} corner${m.n === 1 ? '' : 's'}` : pr.surveyNo ? `Survey no. ${pr.surveyNo}` : 'No corners yet';
    document.title = `${pr.name} · Site Surveyor`;
  }

  // ---- tabs ------------------------------------------------------------------------
  function setTab(key, { fromRoute = false } = {}) {
    if (!panes[key]) key = 'map';
    tab = key;
    for (const [k, pane] of Object.entries(panes)) pane.classList.toggle('active', k === key);
    for (const [k, b] of Object.entries(tabButtons)) {
      b.classList.toggle('on', k === key);
      b.setAttribute('aria-current', k === key ? 'page' : 'false');
    }
    if (!fromRoute) history.replaceState(null, '', `#/p/${encodeURIComponent(p().id)}/${key}`);
    if (key === 'map') {
      mapView.invalidate();
      if (settings.surveyMode === 'walk') gps.start();
    }
    if (dirty.has(key) || key === 'plan') {
      dirty.delete(key);
      views[key]();
    }
  }

  // ---- survey panel ----------------------------------------------------------------
  function setMode(mode) {
    updateSettings({ surveyMode: mode });
    if (mode === 'walk') gps.start();
  }

  function renderPanel() {
    const walk = settings.surveyMode !== 'tap';
    modeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === (walk ? 'walk' : 'tap')));
    panel.classList.toggle('walk', walk);
    panel.classList.toggle('tap', !walk);
    captureBtn.hidden = !walk;
    tapHint.hidden = walk;
    undoBtn.disabled = !session.canUndo();
    const n = p().points.length;
    const ia = session.insertAfter;
    const next = ia != null ? ia + 2 : n + 1;
    captureBtn.querySelector('.btn-label').textContent = `Capture corner P${next}`;

    clear(banner);
    if (moving != null) {
      banner.hidden = false;
      banner.append(h('span', null, `Drag P${moving + 1} to its place on the map.`), h('button', { type: 'button', class: 'link-btn', onclick: stopMove }, 'Done'));
    } else if (ia != null) {
      banner.hidden = false;
      banner.append(
        h('span', null, `New corners go between P${ia + 1} and P${((ia + 1) % Math.max(n, 1)) + 1}.`),
        h('button', { type: 'button', class: 'link-btn', onclick: () => ((session.insertAfter = null), renderPanel()) }, 'Stop'),
      );
    } else {
      banner.hidden = true;
    }
    renderGpsLine();
    requestAnimationFrame(() => mapView.invalidate());
  }

  function renderGpsLine() {
    clear(gpsLine);
    const st = gps.state;
    const fix = live();
    let q = 'none';
    let text;
    let warn = null;
    if (!gps.supported || st === 'unavailable') text = 'GPS is not available in this browser';
    else if (st === 'denied') text = 'Location is blocked. Tap for help.';
    else if (st === 'off' && !fix) text = settings.surveyMode === 'tap' ? 'GPS off. Tap My location to see where you are.' : 'GPS off';
    else if (!fix) text = 'Waiting for GPS…';
    else {
      q = accuracyQuality(fix.acc);
      text = `GPS ±${fmtNum(fix.acc, fix.acc < 10 ? 1 : 0)} m · ${q === 'good' ? 'good' : q === 'fair' ? 'fair' : 'weak'}`;
      if (q === 'poor') warn = 'Weak signal. Move into open sky, away from walls and trees, and wait a moment.';
    }
    gpsLine.append(h('span', { class: `gps-dot q-${q}` }), h('span', { class: 'gps-text' }, text));
    if (showNearest && fix && p().points.length) {
      const near = mapView.nearestCorner(fix);
      if (near) gpsLine.append(h('span', { class: 'gps-near' }, `${fmtLen(near.d, settings.lengthUnit)} to P${near.i + 1}`));
    }
    gpsLine.classList.toggle('warn', !!warn);
    if (warn) gpsLine.append(h('span', { class: 'gps-warn' }, icon('warn'), warn));
    renderNearestChip(fix);
  }

  function renderNearestChip(fix) {
    const near = showNearest && fix ? mapView.nearestCorner(fix) : null;
    nearestChip.hidden = !near;
    if (near) nearestChip.textContent = `${fmtLen(near.d, settings.lengthUnit)} to P${near.i + 1}`;
  }

  function onGpsLineTap() {
    if (gps.state === 'denied' || gps.state === 'unavailable' || !gps.supported) locationHelpSheet(gps.supported ? gps.state : 'unavailable');
    else myLocation();
  }

  // ---- adding corners --------------------------------------------------------------
  function afterAdd(idx, extra = '') {
    toast(`P${idx + 1} added${extra}`, { action: 'Undo', onAction: undo });
  }

  function onMapTap(latlng) {
    if (moving != null || capture) return;
    if (settings.surveyMode !== 'tap') {
      toast('Switch to “Tap on map” to place corners by tapping.', { action: 'Switch', onAction: () => setMode('tap') });
      return;
    }
    const idx = session.addPoint({ id: uid('c'), lat: latlng.lat, lng: latlng.lng, acc: null, n: null, method: 'tap', t: Date.now() });
    afterAdd(idx);
  }

  async function startCapture(replaceIndex) {
    if (capture) return;
    if (!gps.supported) {
      locationHelpSheet('unavailable');
      return;
    }
    if (gps.state === 'denied') gps.stop();
    const ms = Math.max(1, Number(settings.avgSeconds) || 10) * 1000;
    const label = replaceIndex != null ? `Re-capturing P${replaceIndex + 1}` : `Capturing P${session.insertAfter != null ? session.insertAfter + 2 : p().points.length + 1}`;
    const bar = h('div', { class: 'progress-fill' });
    const stat = h('div', { class: 'capture-stat' }, 'Waiting for GPS…');
    const finishBtn = button('Use now', { cls: 'secondary', onClick: () => capture && capture.finish(), disabled: true });
    clear(overlay).append(
      h(
        'div',
        { class: 'capture-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': label },
        h('h2', null, label),
        h('p', { class: 'muted' }, 'Stand on the corner and hold the phone still.'),
        h('div', { class: 'progress' }, bar),
        stat,
        h('div', { class: 'capture-actions' }, button('Cancel', { cls: 'secondary', onClick: () => capture && capture.cancel() }), finishBtn),
      ),
    );
    overlay.hidden = false;
    const ctl = gps.average(ms, { onProgress: (pr) => updateOverlay(pr) });
    capture = ctl;

    function updateOverlay(pr) {
      bar.style.width = `${Math.min(100, (pr.elapsed / pr.total) * 100)}%`;
      const left = Math.max(0, Math.ceil((pr.total - pr.elapsed) / 1000));
      const acc = pr.last && gps.isFresh(5000) ? ` · ±${fmtNum(pr.last.acc, 1)} m` : '';
      stat.textContent = pr.count ? `${pr.count} reading${pr.count === 1 ? '' : 's'}${acc} · ${left} s left` : pr.elapsed > pr.total ? 'Still waiting for a GPS fix…' : 'Waiting for GPS…';
      finishBtn.disabled = !pr.count;
    }

    let fix = null;
    try {
      fix = await ctl.promise;
    } catch (e) {
      if (e.name !== 'AbortError') {
        if (e.message === 'denied' || e.message === 'unavailable') locationHelpSheet(e.message);
        else toast('No GPS fix. Move into open sky and try again.', { timeout: 4000 });
      }
    } finally {
      capture = null;
      overlay.hidden = true;
      clear(overlay);
    }
    if (!fix) return;
    const accText = ` (±${fmtNum(fix.acc, 1)} m)`;
    if (replaceIndex != null) {
      session.replacePoint(replaceIndex, fix);
      toast(`P${replaceIndex + 1} re-captured${accText}`, { action: 'Undo', onAction: undo });
    } else {
      const idx = session.addPoint({ id: uid('c'), lat: fix.lat, lng: fix.lng, acc: fix.acc, n: fix.n, method: 'gps', t: Date.now() });
      afterAdd(idx, accText);
    }
    if (fix.acc > FAIR_ACC) {
      setTimeout(() => toast(`That reading is weak (±${fmtNum(fix.acc, 0)} m). Re-capture it in open sky if you can.`, { timeout: 5000 }), 3000);
    }
  }

  function undo() {
    if (session.undo()) toast('Undone');
  }

  // ---- corners ----------------------------------------------------------------------
  function openCorner(i) {
    if (moving != null) return;
    session.selected = i;
    mapView.render();
    planView.render();
    cornerSheet(session, i, {
      recapture: (k) => {
        setTab('map');
        startCapture(k);
      },
      move: startMove,
      insertAfter: (k) => {
        session.insertAfter = k;
        setTab('map');
        renderPanel();
        toast(`Next corner goes after P${k + 1}`);
      },
      remove: (k) => {
        session.deletePoint(k);
        toast(`P${k + 1} deleted`, { action: 'Undo', onAction: undo });
      },
      closed: () => {
        session.selected = null;
        if (tab === 'map') mapView.render();
        else if (tab === 'plan') planView.render();
      },
    });
  }

  function startMove(i) {
    setTab('map');
    moving = i;
    mapView.setMoving(i);
    renderPanel();
    const q = p().points[i];
    if (q) mapView.centerOn(q.lat, q.lng, Math.max(mapView.getZoom(), 19));
  }

  function stopMove() {
    moving = null;
    mapView.setMoving(null);
    renderPanel();
  }

  // ---- location ----------------------------------------------------------------------
  async function myLocation() {
    if (!gps.supported) {
      locationHelpSheet('unavailable');
      return;
    }
    if (tab !== 'map') setTab('map');
    showNearest = true;
    if (gps.state === 'denied') gps.stop();
    if (gps.isFresh(15000)) {
      gps.start();
      mapView.showMeAndCorners(gps.last);
      mapView.renderLive();
      renderGpsLine();
      return;
    }
    toast('Finding your location…');
    try {
      const fix = await gps.waitForFix(25000);
      mapView.showMeAndCorners(fix);
      mapView.renderLive();
      renderGpsLine();
    } catch (e) {
      if (e.message === 'denied' || e.message === 'unavailable') locationHelpSheet(e.message);
      else toast('No GPS fix yet. Step into open sky and try again.', { timeout: 4000 });
    }
  }

  function fitPlot() {
    if (!mapView.fitAll()) {
      if (live()) mapView.showMeAndCorners(live());
      else toast('No corners yet');
    }
  }

  // ---- photos -------------------------------------------------------------------------
  function takePhoto(camera) {
    if (p().photos.length >= MAX_PHOTOS) {
      toast(`A site can hold up to ${MAX_PHOTOS} photos.`);
      return;
    }
    if (camera && gps.supported && gps.state !== 'denied') gps.start(); // so the photo gets a position
    (camera ? cameraInput : galleryInput).click();
  }

  async function onPhotoFiles(e, camera) {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    let saved = 0;
    for (const file of files) {
      try {
        const out = await processPhoto(file);
        let pos = out.exifGps;
        if (!pos && camera && gps.isFresh(60000)) pos = { lat: gps.last.lat, lng: gps.last.lng, acc: gps.last.acc };
        let pointId = null;
        if (pos) {
          let best = null;
          p().points.forEach((q) => {
            const d = distanceMeters(pos.lat, pos.lng, q.lat, q.lng);
            if (d <= PHOTO_LINK_M && (!best || d < best.d)) best = { id: q.id, d };
          });
          pointId = best ? best.id : null;
        }
        await session.addPhoto(
          {
            id: uid('ph'),
            lat: pos ? pos.lat : null,
            lng: pos ? pos.lng : null,
            acc: pos && pos.acc != null ? pos.acc : null,
            t: camera ? Date.now() : file.lastModified || Date.now(),
            caption: '',
            pointId,
            thumb: out.thumb,
            w: out.w,
            h: out.h,
          },
          out.blob,
        );
        saved++;
      } catch (err) {
        console.error(err);
        toast(err.message || 'Could not save the photo.');
        break;
      }
    }
    if (saved) toast(saved === 1 ? 'Photo saved' : `${saved} photos saved`);
  }

  function openPhoto(id) {
    photoSheet(session, id, {
      onShowOnMap: (ph) => {
        setTab('map');
        mapView.centerOn(ph.lat, ph.lng, Math.max(mapView.getZoom(), 19));
      },
    });
  }

  // ---- menu -------------------------------------------------------------------------
  function moreMenu() {
    const s = sheet({
      title: p().name,
      content: h(
        'div',
        { class: 'stack' },
        button('Site details', { icon: 'edit', cls: 'secondary block', onClick: () => (s.close(), detailsSheet(session)) }),
        button('Export & share', { icon: 'share', cls: 'secondary block', onClick: () => (s.close(), exportSheet(session)) }),
        button('Settings', { icon: 'settings', cls: 'secondary block', onClick: () => (s.close(), settingsSheet()) }),
        button('Delete site', { icon: 'trash', cls: 'danger-outline block', onClick: () => (s.close(), deleteSite()) }),
      ),
    });
  }

  async function deleteSite() {
    const pr = p();
    const ok = await confirmSheet(
      'Delete this site?',
      `“${pr.name}” with its ${pr.points.length} corners and ${pr.photos.length} photos will be deleted${account.status === 'signed-in' ? ' from your account' : ' from this phone'}. This cannot be undone.`,
      { ok: 'Delete', danger: true },
    );
    if (!ok) return;
    clearTimeout(session.saveTimer);
    session.saveTimer = null;
    try {
      await stores.active.deleteProject(pr.id);
      toast('Site deleted');
      location.hash = '#/';
    } catch (e) {
      console.error(e);
      toast('Could not delete the site.');
    }
  }

  // ---- events -----------------------------------------------------------------------
  function on(target, type, fn) {
    target.addEventListener(type, fn);
    disposers.push(() => target.removeEventListener(type, fn));
  }

  on(bus, 'project', () => renderAll());
  on(bus, 'settings', (e) => {
    const patch = e.detail || {};
    if ('keepAwake' in patch) patch.keepAwake ? awake.enable() : awake.disable();
    renderAll();
  });
  on(bus, 'saveerror', (e) => toast(`Not saved: ${(e.detail && e.detail.message) || 'storage problem'}`, { timeout: 5000 }));
  on(gps, 'fix', () => {
    if (tab === 'map') mapView.renderLive();
    else if (tab === 'plan') planView.render();
    renderGpsLine();
  });
  on(gps, 'state', () => renderGpsLine());
  const onResize = () => {
    mapView.invalidate();
    if (tab === 'plan') planView.render();
  };
  on(window, 'resize', onResize);
  on(window, 'orientationchange', onResize);

  // keep the My Location button above the survey panel
  const setPanelH = () => panes.map.style.setProperty('--panel-h', `${panel.offsetHeight}px`);
  const ro = 'ResizeObserver' in window ? new ResizeObserver(setPanelH) : null;
  if (ro) {
    ro.observe(panel);
    disposers.push(() => ro.disconnect());
  }

  if (settings.keepAwake) awake.enable();
  if (settings.surveyMode !== 'tap' && gps.supported && tab === 'map') gps.start();

  setTab(tab, { fromRoute: true });
  renderAll();
  requestAnimationFrame(() => {
    mapView.invalidate();
    if (p().points.length) mapView.fitAll(false);
  });

  return {
    setTab,
    destroy() {
      disposers.forEach((d) => d());
      if (capture) capture.cancel();
      gps.stop();
      awake.disable();
      mapView.destroy();
      document.title = 'Site Surveyor';
    },
  };
}
