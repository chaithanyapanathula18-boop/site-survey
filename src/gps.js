// Live GPS position, accuracy, and averaged corner capture.
import { distanceMeters } from './geo.js';

export const GOOD_ACC = 5;
export const FAIR_ACC = 15;

export function accuracyQuality(acc) {
  if (acc == null || !isFinite(acc)) return 'none';
  if (acc <= GOOD_ACC) return 'good';
  if (acc <= FAIR_ACC) return 'fair';
  return 'poor';
}

// Combine several fixes taken at one spot into one position.
export function combineFixes(fixes) {
  if (!fixes.length) return null;
  const best = Math.min(...fixes.map((f) => f.acc));
  const keep = fixes.filter((f) => f.acc <= Math.max(best * 2, best + 3));
  const w = keep.map((f) => 1 / Math.max(f.acc, 0.5) ** 2);
  const W = w.reduce((a, b) => a + b, 0);
  const lat = keep.reduce((s, f, i) => s + f.lat * w[i], 0) / W;
  const lng = keep.reduce((s, f, i) => s + f.lng * w[i], 0) / W;
  const meanAcc = keep.reduce((s, f, i) => s + f.acc * w[i], 0) / W;
  const spread = Math.sqrt(keep.reduce((s, f) => s + distanceMeters(lat, lng, f.lat, f.lng) ** 2, 0) / keep.length);
  return { lat, lng, acc: Math.max(meanAcc, spread), n: keep.length, total: fixes.length, spread };
}

export class GPS extends EventTarget {
  constructor() {
    super();
    this.state = 'off'; // off | starting | ok | denied | unavailable | error
    this.last = null;
    this.watchId = null;
    this.wanted = false;
    this.paused = false;
    this.error = null;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._pause();
      else this._resume();
    });
  }

  get supported() {
    return 'geolocation' in navigator;
  }

  isFresh(maxAgeMs = 15000) {
    return !!this.last && Date.now() - this.last.receivedAt < maxAgeMs;
  }

  start() {
    this.wanted = true;
    if (!this.supported) {
      this._setState('unavailable');
      return;
    }
    if (this.watchId != null) return;
    if (this.state !== 'ok') this._setState('starting');
    try {
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this._onFix(pos),
        (err) => this._onError(err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
      );
    } catch (e) {
      this.error = e;
      this._setState('unavailable');
    }
  }

  stop() {
    this.wanted = false;
    this._clear();
    this._setState('off');
  }

  _pause() {
    if (this.watchId != null) {
      this.paused = true;
      this._clear();
    }
  }

  _resume() {
    if (this.paused && this.wanted) {
      this.paused = false;
      this.start();
    }
  }

  _clear() {
    if (this.watchId != null && this.supported) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  _onFix(pos) {
    const c = pos.coords;
    this.last = {
      lat: c.latitude,
      lng: c.longitude,
      acc: c.accuracy,
      alt: c.altitude,
      heading: c.heading,
      speed: c.speed,
      t: pos.timestamp || Date.now(),
      receivedAt: Date.now(),
    };
    this.error = null;
    this._setState('ok');
    this.dispatchEvent(new CustomEvent('fix', { detail: this.last }));
  }

  _onError(err) {
    this.error = err;
    if (err.code === 1) {
      this._clear();
      this.wanted = false;
      this._setState('denied');
    } else if (err.code === 2) {
      this._setState(this.last ? 'ok' : 'error');
    }
    // code 3 (timeout): keep watching quietly
    this.dispatchEvent(new CustomEvent('gpserror', { detail: err }));
  }

  _setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.dispatchEvent(new CustomEvent('state', { detail: s }));
  }

  // Wait for the next fix (or a recent one).
  waitForFix(timeoutMs = 20000) {
    this.start();
    if (this.isFresh(3000)) return Promise.resolve(this.last);
    return new Promise((resolve, reject) => {
      const done = (fn, v) => {
        clearTimeout(timer);
        this.removeEventListener('fix', onFix);
        this.removeEventListener('state', onState);
        fn(v);
      };
      const onFix = (e) => done(resolve, e.detail);
      const onState = (e) => {
        if (e.detail === 'denied' || e.detail === 'unavailable') done(reject, new Error(e.detail));
      };
      const timer = setTimeout(() => done(reject, new Error('timeout')), timeoutMs);
      this.addEventListener('fix', onFix);
      this.addEventListener('state', onState);
    });
  }

  // Collect fixes for `ms`, then combine. control.finish() ends early, control.cancel() aborts.
  average(ms, { onProgress } = {}) {
    this.start();
    const fixes = [];
    const t0 = performance.now();
    if (this.isFresh(1500)) fixes.push(this.last);
    let finishFlag = false;
    let cancelFlag = false;
    let timer = null;
    const onFix = (e) => fixes.push(e.detail);
    this.addEventListener('fix', onFix);
    const promise = new Promise((resolve, reject) => {
      const tick = () => {
        const elapsed = performance.now() - t0;
        if (cancelFlag) return finish(reject, Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
        if (this.state === 'denied' || this.state === 'unavailable') return finish(reject, new Error(this.state));
        onProgress && onProgress({ elapsed, total: ms, count: fixes.length, last: this.last });
        if (fixes.length && (finishFlag || elapsed >= ms)) return finish(resolve, combineFixes(fixes));
        if (elapsed >= ms + 30000) return finish(reject, new Error('timeout'));
        timer = setTimeout(tick, 200);
      };
      const finish = (fn, v) => {
        clearTimeout(timer);
        this.removeEventListener('fix', onFix);
        fn(v);
      };
      tick();
    });
    return {
      promise,
      finish: () => (finishFlag = true),
      cancel: () => (cancelFlag = true),
      count: () => fixes.length,
    };
  }
}

// Keep the screen awake while surveying (where supported).
export class ScreenAwake {
  constructor() {
    this.lock = null;
    this.wanted = false;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.wanted) this._acquire();
    });
  }
  async enable() {
    this.wanted = true;
    await this._acquire();
  }
  async disable() {
    this.wanted = false;
    try {
      if (this.lock) await this.lock.release();
    } catch {
      /* ignore */
    }
    this.lock = null;
  }
  async _acquire() {
    if (!('wakeLock' in navigator) || this.lock) return;
    try {
      this.lock = await navigator.wakeLock.request('screen');
      this.lock.addEventListener('release', () => {
        this.lock = null;
      });
    } catch {
      this.lock = null;
    }
  }
}
