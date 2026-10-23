// App-wide state: settings, GPS, the project being edited, and account status.
import { stores } from './store/index.js';
import { GPS, ScreenAwake } from './gps.js';
import { History, MAX_PHOTOS, normaliseProject, shiftRoadSide } from './model.js';
import { measure } from './geo.js';

export const APP_VERSION = '1.0.0';

const SETTINGS_KEY = 'ss_settings';
const DEFAULT_SETTINGS = {
  lengthUnit: 'm',
  areaUnit: 'sqm',
  avgSeconds: 10,
  keepAwake: true,
  mapStyle: 'voyager',
  showSideLengths: true,
  showPhotosOnMap: true,
  dxfCoords: 'utm',
  surveyMode: 'walk',
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export const settings = loadSettings();

export const bus = new EventTarget();
export function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

export function updateSettings(patch) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage full or blocked */
  }
  emit('settings', patch);
}

export const gps = new GPS();
export const awake = new ScreenAwake();

// Account: status is 'unconfigured' | 'loading' | 'signed-out' | 'signed-in'
export const account = { status: 'unconfigured', user: null, cloud: null, config: null, error: null };

export function setAccount(patch) {
  Object.assign(account, patch);
  emit('account', account);
}

// ---- Editing session for one project -----------------------------------------

export class ProjectSession {
  constructor(project) {
    this.project = normaliseProject(project);
    this.history = new History();
    this.insertAfter = null;
    this.selected = null;
    this.saveTimer = null;
    this._m = null;
    this.lastSaveError = null;
  }

  get m() {
    if (!this._m) this._m = measure(this.project.points);
    return this._m;
  }

  changed(kind = 'edit', { save = true } = {}) {
    this._m = null;
    if (save) {
      this.project.updatedAt = Date.now();
      this.scheduleSave();
    }
    emit('project', { kind });
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), 600);
  }

  async saveNow() {
    if (this.saveTimer == null) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      await stores.active.saveProject(this.project);
      this.lastSaveError = null;
    } catch (e) {
      this.lastSaveError = e;
      emit('saveerror', e);
    }
  }

  // Corners -----------------------------------------------------------------
  addPoint(pt) {
    const pts = this.project.points;
    this.history.push(this.project);
    let idx;
    if (this.insertAfter != null && this.insertAfter < pts.length - 1) {
      idx = this.insertAfter + 1;
      this.project.roadSide = shiftRoadSide(this.project.roadSide, 'insert', this.insertAfter, pts.length);
      pts.splice(idx, 0, pt);
      this.insertAfter = idx; // keep inserting in sequence
    } else {
      idx = pts.length;
      if (pts.length) this.project.roadSide = shiftRoadSide(this.project.roadSide, 'insert', pts.length - 1, pts.length);
      pts.push(pt);
      this.insertAfter = null;
    }
    this.changed('points');
    return idx;
  }

  replacePoint(i, fix) {
    const pts = this.project.points;
    if (!pts[i]) return;
    this.history.push(this.project);
    pts[i] = { ...pts[i], lat: fix.lat, lng: fix.lng, acc: fix.acc, n: fix.n ?? null, method: 'gps', t: Date.now() };
    this.changed('points');
  }

  movePoint(i, lat, lng) {
    const pts = this.project.points;
    if (!pts[i]) return;
    this.history.push(this.project);
    pts[i] = { ...pts[i], lat, lng, method: 'moved', t: Date.now() };
    this.changed('points');
  }

  deletePoint(i) {
    const pts = this.project.points;
    if (!pts[i]) return;
    this.history.push(this.project);
    this.project.roadSide = shiftRoadSide(this.project.roadSide, 'delete', i, pts.length);
    pts.splice(i, 1);
    if (this.insertAfter != null) {
      if (this.insertAfter >= pts.length - 1) this.insertAfter = null;
      else if (this.insertAfter >= i) this.insertAfter = Math.max(0, this.insertAfter - 1);
    }
    this.selected = null;
    this.changed('points');
  }

  setRoadSide(i) {
    this.history.push(this.project);
    this.project.roadSide = i;
    this.changed('road');
  }

  canUndo() {
    return this.history.canUndo();
  }

  undo() {
    if (!this.history.undo(this.project)) return false;
    this.selected = null;
    if (this.insertAfter != null && this.insertAfter >= this.project.points.length - 1) this.insertAfter = null;
    this.changed('undo');
    return true;
  }

  // Details -----------------------------------------------------------------
  updateDetails(fields) {
    Object.assign(this.project, fields);
    this.changed('details');
  }

  // Photos ------------------------------------------------------------------
  async addPhoto(meta, blob) {
    if (this.project.photos.length >= MAX_PHOTOS) throw new Error(`A site can hold up to ${MAX_PHOTOS} photos.`);
    await stores.active.putImage(this.project.id, meta.id, blob);
    this.project.photos.push(meta);
    this.changed('photos');
  }

  updatePhoto(id, fields) {
    const ph = this.project.photos.find((p) => p.id === id);
    if (!ph) return;
    Object.assign(ph, fields);
    this.changed('photos');
  }

  async deletePhoto(id) {
    this.project.photos = this.project.photos.filter((p) => p.id !== id);
    this.changed('photos');
    try {
      await stores.active.deleteImage(this.project.id, id);
    } catch (e) {
      console.warn(e);
    }
  }
}

export const state = { session: null };

export function openSession(project) {
  state.session = new ProjectSession(project);
  return state.session;
}

export async function closeSession() {
  const s = state.session;
  state.session = null;
  if (s) await s.saveNow();
}
