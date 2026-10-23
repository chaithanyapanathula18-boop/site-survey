// Map tab: graphical basemap, boundary, corners, photos and live location.
import L from 'leaflet';
import { fmtLen, distanceMeters } from '../geo.js';
import { iconSvgMarkup } from './dom.js';
import { accuracyQuality } from '../gps.js';

export const MAP_STYLES = {
  voyager: {
    name: 'Streets (graphical)',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxNativeZoom: 19,
  },
  light: {
    name: 'Light (minimal)',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxNativeZoom: 19,
  },
  osm: {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: '',
    maxNativeZoom: 19,
  },
  none: { name: 'No map, boundary only', url: null },
};

export const INDIA_CENTER = [20.6, 78.96];

export function createMapView(container, ctx) {
  const map = L.map(container, {
    zoomControl: false,
    attributionControl: false,
    maxZoom: 22,
    minZoom: 2,
    zoomSnap: 0.5,
    tapTolerance: 12,
    worldCopyJump: true,
  });
  L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);
  L.control.zoom({ position: 'topright' }).addTo(map);

  let baseLayer = null;
  let styleKey = null;
  const plotLayer = L.layerGroup().addTo(map);
  const labelLayer = L.layerGroup().addTo(map);
  const cornerLayer = L.layerGroup().addTo(map);
  const photoLayer = L.layerGroup().addTo(map);
  const liveLayer = L.layerGroup().addTo(map);
  let movingIndex = null;
  let initialViewDone = false;

  function setStyle(key) {
    if (key === styleKey) return;
    styleKey = key;
    if (baseLayer) map.removeLayer(baseLayer);
    baseLayer = null;
    const st = MAP_STYLES[key] || MAP_STYLES.voyager;
    container.classList.toggle('no-basemap', !st.url);
    if (st.url) {
      baseLayer = L.tileLayer(st.url, {
        attribution: st.attribution,
        subdomains: st.subdomains || 'abc',
        maxNativeZoom: st.maxNativeZoom,
        maxZoom: 22,
        crossOrigin: true,
        detectRetina: false,
      });
      baseLayer.addTo(map);
      baseLayer.bringToBack();
    }
  }

  map.on('click', (e) => {
    if (movingIndex != null) return;
    ctx.onMapTap && ctx.onMapTap(e.latlng, map.getZoom());
  });

  function cornerIcon(i, selected, moving, quality) {
    return L.divIcon({
      className: 'corner-icon',
      html: `<div class="corner q-${quality} ${selected ? 'selected' : ''} ${moving ? 'moving' : ''}">${i + 1}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }

  function render() {
    const s = ctx.session();
    if (!s) return;
    const p = s.project;
    const m = s.m;
    const settings = ctx.settings();
    setStyle(settings.mapStyle);
    plotLayer.clearLayers();
    labelLayer.clearLayers();
    cornerLayer.clearLayers();
    photoLayer.clearLayers();

    const latlngs = p.points.map((q) => [q.lat, q.lng]);
    if (latlngs.length >= 3) {
      L.polygon(latlngs, { className: 'plot-poly', weight: 3, interactive: false }).addTo(plotLayer);
    } else if (latlngs.length === 2) {
      L.polyline(latlngs, { className: 'plot-line', weight: 3, interactive: false }).addTo(plotLayer);
    }
    if (p.roadSide != null && latlngs.length >= 3) {
      const a = latlngs[p.roadSide];
      const b = latlngs[(p.roadSide + 1) % latlngs.length];
      if (a && b) L.polyline([a, b], { className: 'road-line', weight: 8, interactive: false }).addTo(plotLayer);
    }
    // closing side preview while walking (dashed)
    if (latlngs.length >= 3) {
      // nothing extra: polygon already closes
    }

    if (settings.showSideLengths) {
      m.sides.forEach((side) => {
        const a = p.points[side.from];
        const b = p.points[side.to];
        const mid = [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2];
        L.marker(mid, {
          icon: L.divIcon({
            className: 'side-label-icon',
            html: `<span class="side-label">${fmtLen(side.length, settings.lengthUnit)}</span>`,
            iconSize: null,
          }),
          interactive: false,
          keyboard: false,
        }).addTo(labelLayer);
      });
    }

    p.points.forEach((q, i) => {
      const moving = movingIndex === i;
      const mk = L.marker([q.lat, q.lng], {
        icon: cornerIcon(i, s.selected === i, moving, q.method === 'gps' ? accuracyQuality(q.acc) : 'manual'),
        draggable: moving,
        autoPan: true,
        zIndexOffset: moving ? 2000 : 500,
        title: `P${i + 1}`,
      });
      mk.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        if (movingIndex == null) ctx.onCornerTap && ctx.onCornerTap(i);
      });
      mk.on('dragend', () => {
        const ll = mk.getLatLng();
        ctx.onCornerMoved && ctx.onCornerMoved(i, ll.lat, ll.lng);
      });
      mk.addTo(cornerLayer);
    });

    if (settings.showPhotosOnMap) {
      p.photos.forEach((ph) => {
        if (ph.lat == null || ph.lng == null) return;
        const mk = L.marker([ph.lat, ph.lng], {
          icon: L.divIcon({ className: 'photo-icon', html: `<div class="photo-pin">${iconSvgMarkup('camera', 14)}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
          zIndexOffset: 300,
          keyboard: false,
        });
        mk.on('click', (ev) => {
          L.DomEvent.stopPropagation(ev);
          ctx.onPhotoTap && ctx.onPhotoTap(ph.id);
        });
        mk.addTo(photoLayer);
      });
    }

    if (!initialViewDone) {
      initialViewDone = true;
      if (latlngs.length) fitAll(false);
      else if (ctx.live()) map.setView([ctx.live().lat, ctx.live().lng], 19);
      else map.setView(INDIA_CENTER, 5);
    }
    renderLive();
  }

  function nearestCorner(fix) {
    const s = ctx.session();
    if (!s || !fix) return null;
    let best = null;
    s.project.points.forEach((q, i) => {
      const d = distanceMeters(fix.lat, fix.lng, q.lat, q.lng);
      if (!best || d < best.d) best = { i, d };
    });
    return best;
  }

  function renderLive() {
    liveLayer.clearLayers();
    const fix = ctx.live();
    if (!fix) return;
    const q = accuracyQuality(fix.acc);
    L.circle([fix.lat, fix.lng], { radius: fix.acc || 0, className: `me-acc q-${q}`, interactive: false, weight: 1 }).addTo(liveLayer);
    if (ctx.showNearest()) {
      const near = nearestCorner(fix);
      if (near) {
        const c = ctx.session().project.points[near.i];
        L.polyline(
          [
            [fix.lat, fix.lng],
            [c.lat, c.lng],
          ],
          { className: 'nearest-line', weight: 2, dashArray: '6 7', interactive: false },
        ).addTo(liveLayer);
      }
    }
    L.marker([fix.lat, fix.lng], {
      icon: L.divIcon({ className: 'me-icon', html: '<div class="me-dot"><span class="me-pulse"></span></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1500,
    }).addTo(liveLayer);
  }

  function boundsPadding() {
    const bottom = ctx.bottomInset ? ctx.bottomInset() : 160;
    return { paddingTopLeft: [28, 80], paddingBottomRight: [28, bottom + 24] };
  }

  function fitAll(animate = true) {
    const s = ctx.session();
    const pts = s ? s.project.points.map((q) => [q.lat, q.lng]) : [];
    if (!pts.length) return false;
    if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 19), { animate });
    else map.fitBounds(L.latLngBounds(pts), { ...boundsPadding(), maxZoom: 21, animate });
    return true;
  }

  // Show the live position and every captured corner together.
  function showMeAndCorners(fix, animate = true) {
    const s = ctx.session();
    const pts = s ? s.project.points.map((q) => [q.lat, q.lng]) : [];
    if (!fix) return;
    const all = [[fix.lat, fix.lng], ...pts];
    if (all.length === 1) {
      map.setView(all[0], Math.max(map.getZoom(), 19), { animate });
      return;
    }
    const b = L.latLngBounds(all);
    // make sure the accuracy circle fits too
    const r = Math.min(fix.acc || 0, 200);
    if (r > 0) {
      const dLat = r / 111320;
      const dLng = r / (111320 * Math.cos((fix.lat * Math.PI) / 180));
      b.extend([fix.lat + dLat, fix.lng + dLng]);
      b.extend([fix.lat - dLat, fix.lng - dLng]);
    }
    map.fitBounds(b, { ...boundsPadding(), maxZoom: 20, animate });
  }

  function setMoving(i) {
    movingIndex = i;
    render();
  }

  function centerOn(lat, lng, zoom) {
    map.setView([lat, lng], zoom || Math.max(map.getZoom(), 19));
  }

  return {
    map,
    render,
    renderLive,
    fitAll,
    showMeAndCorners,
    setMoving,
    nearestCorner,
    centerOn,
    invalidate: () => map.invalidateSize(),
    getZoom: () => map.getZoom(),
    destroy: () => map.remove(),
  };
}
