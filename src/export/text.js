// KML (Google Earth), CSV (coordinates) and backup file export/import.
import { measure, toUTM, utmZone, fmtArea, fmtNum } from '../geo.js';
import { normaliseProject, uid } from '../model.js';

function xml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

export function buildKml(project) {
  const m = measure(project.points);
  const pts = project.points;
  const coords = pts.map((q) => `${q.lng.toFixed(8)},${q.lat.toFixed(8)},0`);
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  parts.push('<Document>');
  parts.push(`<name>${xml(project.name || 'Site')}</name>`);
  parts.push('<Style id="boundary"><LineStyle><color>ff0c58ea</color><width>3</width></LineStyle><PolyStyle><color>330c58ea</color></PolyStyle></Style>');
  parts.push('<Style id="road"><LineStyle><color>ffed3a7c</color><width>6</width></LineStyle></Style>');
  parts.push('<Style id="corner"><IconStyle><scale>0.7</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>');
  parts.push('<Style id="photo"><IconStyle><scale>0.8</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/camera.png</href></Icon></IconStyle></Style>');
  if (pts.length >= 3) {
    const desc = `Area: ${fmtArea(m.area, 'sqm')} (${fmtArea(m.area, 'sqyd')}, ${fmtArea(m.area, 'acre')}). Perimeter: ${fmtNum(m.perimeter, 2)} m.`;
    parts.push('<Placemark>');
    parts.push(`<name>${xml(project.name || 'Boundary')}</name>`);
    parts.push(`<description>${xml(desc)}</description>`);
    parts.push('<styleUrl>#boundary</styleUrl>');
    parts.push(`<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${[...coords, coords[0]].join(' ')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`);
    parts.push('</Placemark>');
    if (project.roadSide != null && pts[project.roadSide]) {
      const a = coords[project.roadSide];
      const b = coords[(project.roadSide + 1) % pts.length];
      parts.push(`<Placemark><name>Road side</name><styleUrl>#road</styleUrl><LineString><tessellate>1</tessellate><coordinates>${a} ${b}</coordinates></LineString></Placemark>`);
    }
  } else if (pts.length === 2) {
    parts.push(`<Placemark><name>Line</name><styleUrl>#boundary</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coords.join(' ')}</coordinates></LineString></Placemark>`);
  }
  parts.push('<Folder><name>Corners</name>');
  pts.forEach((q, i) => {
    const d = [q.acc != null ? `±${fmtNum(q.acc, 1)} m` : '', q.method === 'gps' ? 'GPS' : q.method === 'moved' ? 'moved by hand' : 'placed on map'].filter(Boolean).join(', ');
    parts.push(`<Placemark><name>P${i + 1}</name><description>${xml(d)}</description><styleUrl>#corner</styleUrl><Point><coordinates>${coords[i]}</coordinates></Point></Placemark>`);
  });
  parts.push('</Folder>');
  const photos = project.photos.filter((p) => p.lat != null);
  if (photos.length) {
    parts.push('<Folder><name>Photos</name>');
    project.photos.forEach((ph, i) => {
      if (ph.lat == null) return;
      parts.push(`<Placemark><name>Photo ${i + 1}</name><description>${xml(ph.caption || '')}</description><styleUrl>#photo</styleUrl><Point><coordinates>${ph.lng.toFixed(8)},${ph.lat.toFixed(8)},0</coordinates></Point></Placemark>`);
    });
    parts.push('</Folder>');
  }
  parts.push('</Document>');
  parts.push('</kml>');
  return parts.join('\n');
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(project) {
  const m = measure(project.points);
  const pts = project.points;
  const zone = pts.length ? utmZone(m.proj.lng0) : null;
  const o = m.xy[0] || { x: 0, y: 0 };
  const rows = [
    ['point', 'latitude', 'longitude', 'accuracy_m', 'method', 'gps_readings', 'captured_at', 'local_x_m', 'local_y_m', 'utm_zone', 'utm_easting_m', 'utm_northing_m'],
  ];
  pts.forEach((q, i) => {
    const u = toUTM(q.lat, q.lng, zone);
    rows.push([
      `P${i + 1}`,
      q.lat.toFixed(8),
      q.lng.toFixed(8),
      q.acc != null ? q.acc.toFixed(1) : '',
      q.method,
      q.n != null ? q.n : '',
      new Date(q.t).toISOString(),
      (m.xy[i].x - o.x).toFixed(3),
      (m.xy[i].y - o.y).toFixed(3),
      `${u.zone}${u.hemi}`,
      u.E.toFixed(3),
      u.N.toFixed(3),
    ]);
  });
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const BACKUP_APP = 'site-surveyor';

export async function buildBackup(project, getImageDataUrl) {
  const images = {};
  for (const ph of project.photos) {
    try {
      const d = await getImageDataUrl(ph.id);
      if (d) images[ph.id] = d;
    } catch (e) {
      console.warn('photo missing from backup', ph.id, e);
    }
  }
  return JSON.stringify({ app: BACKUP_APP, format: 1, exportedAt: new Date().toISOString(), project, images });
}

export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Site Surveyor backup.');
  }
  if (!data || data.app !== BACKUP_APP || !data.project) throw new Error('This file is not a Site Surveyor backup.');
  const project = normaliseProject(data.project);
  return { project, images: data.images && typeof data.images === 'object' ? data.images : {} };
}

export function freshCopy(project) {
  return { ...project, id: uid('p'), updatedAt: Date.now() };
}
