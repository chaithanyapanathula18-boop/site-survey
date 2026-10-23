// Project data model and edits.

export const MAX_PHOTOS = 60;

export function uid(prefix = '') {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const s = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
  return prefix + s;
}

export function newProject(name) {
  const now = Date.now();
  return {
    id: uid('p'),
    version: 1,
    name: name || 'New site',
    surveyNo: '',
    village: '',
    owner: '',
    notes: '',
    points: [],
    roadSide: null,
    photos: [],
    createdAt: now,
    updatedAt: now,
  };
}

// Normalise anything loaded from storage or a backup file.
export function normaliseProject(p) {
  const out = {
    id: String(p.id || uid('p')),
    version: 1,
    name: String(p.name || 'Untitled site'),
    surveyNo: String(p.surveyNo || ''),
    village: String(p.village || ''),
    owner: String(p.owner || ''),
    notes: String(p.notes || ''),
    points: Array.isArray(p.points)
      ? p.points
          .filter((q) => q && isFinite(q.lat) && isFinite(q.lng))
          .map((q) => ({
            id: String(q.id || uid('c')),
            lat: Number(q.lat),
            lng: Number(q.lng),
            acc: q.acc == null || !isFinite(q.acc) ? null : Number(q.acc),
            n: q.n == null ? null : Number(q.n),
            method: ['gps', 'tap', 'moved'].includes(q.method) ? q.method : 'tap',
            t: Number(q.t) || Date.now(),
          }))
      : [],
    roadSide: Number.isInteger(p.roadSide) ? p.roadSide : null,
    photos: Array.isArray(p.photos)
      ? p.photos
          .filter((ph) => ph && ph.id)
          .map((ph) => ({
            id: String(ph.id),
            lat: ph.lat == null || !isFinite(ph.lat) ? null : Number(ph.lat),
            lng: ph.lng == null || !isFinite(ph.lng) ? null : Number(ph.lng),
            acc: ph.acc == null || !isFinite(ph.acc) ? null : Number(ph.acc),
            t: Number(ph.t) || Date.now(),
            caption: String(ph.caption || ''),
            pointId: ph.pointId ? String(ph.pointId) : null,
            thumb: typeof ph.thumb === 'string' ? ph.thumb : '',
            w: Number(ph.w) || null,
            h: Number(ph.h) || null,
          }))
      : [],
    createdAt: Number(p.createdAt) || Date.now(),
    updatedAt: Number(p.updatedAt) || Date.now(),
  };
  if (out.roadSide != null && (out.roadSide < 0 || out.roadSide >= Math.max(out.points.length, 1))) out.roadSide = null;
  if (p.copiedTo && Array.isArray(p.copiedTo)) out.copiedTo = p.copiedTo.map(String);
  return out;
}

export function pointLabel(i) {
  return `P${i + 1}`;
}

// Undo history for boundary edits within one editing session.
export class History {
  constructor(limit = 60) {
    this.stack = [];
    this.limit = limit;
  }
  push(project) {
    this.stack.push(JSON.stringify({ points: project.points, roadSide: project.roadSide }));
    if (this.stack.length > this.limit) this.stack.shift();
  }
  canUndo() {
    return this.stack.length > 0;
  }
  undo(project) {
    const s = this.stack.pop();
    if (!s) return false;
    const prev = JSON.parse(s);
    project.points = prev.points;
    project.roadSide = prev.roadSide;
    return true;
  }
  clear() {
    this.stack = [];
  }
}

// When a corner is removed or inserted, keep the road side pointing at the same edge where possible.
export function shiftRoadSide(roadSide, op, index, countBefore) {
  if (roadSide == null) return null;
  if (op === 'insert') {
    // a new corner after `index` splits side `index`
    if (roadSide > index) return roadSide + 1;
    return roadSide;
  }
  if (op === 'delete') {
    const n = countBefore;
    if (n - 1 < 3) return null;
    if (roadSide === index || roadSide === (index - 1 + n) % n) return null;
    if (roadSide > index) return roadSide - 1;
    return roadSide;
  }
  return roadSide;
}
