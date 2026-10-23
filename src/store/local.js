// On-device storage (IndexedDB): projects and their photos.

const DB_NAME = 'site-surveyor';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) {
      reject(new Error('This browser cannot store data on the device.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images');
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage is busy in another tab. Close other tabs of this app and reload.'));
  });
  return dbPromise;
}

function tx(storeNames, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeNames, mode);
        let result;
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Storage transaction aborted'));
        const out = fn(t);
        if (out && typeof out.then === 'function') out.then((v) => (result = v), reject);
        else result = out;
      }),
  );
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const listeners = new Set();
function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.error(e);
    }
  });
}

export const localStore = {
  kind: 'local',

  async listProjects() {
    return tx(['projects'], 'readonly', (t) => reqP(t.objectStore('projects').getAll()));
  },

  async getProject(id) {
    const p = await tx(['projects'], 'readonly', (t) => reqP(t.objectStore('projects').get(id)));
    return p || null;
  },

  async saveProject(project) {
    const copy = JSON.parse(JSON.stringify(project));
    await tx(['projects'], 'readwrite', (t) => {
      t.objectStore('projects').put(copy);
    });
    notify();
  },

  async deleteProject(id) {
    await tx(['projects', 'images'], 'readwrite', (t) => {
      t.objectStore('projects').delete(id);
      const range = IDBKeyRange.bound(`${id}/`, `${id}/￿`);
      t.objectStore('images').delete(range);
    });
    notify();
  },

  async putImage(projectId, photoId, blob) {
    // Store bytes rather than the Blob: some iOS versions fail to keep Blobs in IndexedDB.
    const buf = await blob.arrayBuffer();
    await tx(['images'], 'readwrite', (t) => {
      t.objectStore('images').put({ type: blob.type || 'image/jpeg', data: buf }, `${projectId}/${photoId}`);
    });
  },

  async getImage(projectId, photoId) {
    const rec = await tx(['images'], 'readonly', (t) => reqP(t.objectStore('images').get(`${projectId}/${photoId}`)));
    if (!rec) return null;
    return new Blob([rec.data], { type: rec.type || 'image/jpeg' });
  },

  async deleteImage(projectId, photoId) {
    await tx(['images'], 'readwrite', (t) => {
      t.objectStore('images').delete(`${projectId}/${photoId}`);
    });
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  status() {
    return { pending: 0, offline: !navigator.onLine };
  },
};

// Ask the browser not to clear our data under storage pressure.
export async function requestPersistentStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch {
    /* not supported */
  }
}
