// Google sign-in and cloud storage (Firebase). Loaded only when the app has a Firebase config.
import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  onAuthStateChanged,
  signOut as fbSignOut,
} from 'firebase/auth';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocFromCache,
  getDocs,
  deleteDoc,
  onSnapshot,
  Bytes,
  terminate,
  clearIndexedDbPersistence,
} from 'firebase/firestore';

function isStandalone() {
  return (
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true
  );
}

function isMobile() {
  return (
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function startCloud(config, { onUser, onError }) {
  const app = initializeApp(config);
  const auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  let db;
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
        cacheSizeBytes: 200 * 1024 * 1024,
      }),
      ignoreUndefinedProperties: true,
    });
  } catch (e) {
    console.warn('Offline cache unavailable, using memory cache', e);
    db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  }

  getRedirectResult(auth).catch((e) => onError && onError(e));
  onAuthStateChanged(auth, (user) => {
    onUser(
      user
        ? {
            uid: user.uid,
            name: user.displayName || '',
            email: user.email || '',
            photo: user.photoURL || '',
          }
        : null,
    );
  });

  return {
    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      if (isStandalone() || isMobile()) {
        await signInWithRedirect(auth, provider);
        return;
      }
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        if (
          e &&
          (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')
        ) {
          await signInWithRedirect(auth, provider);
          return;
        }
        throw e;
      }
    },
    async signOut() {
      await fbSignOut(auth);
      try {
        await terminate(db);
        await clearIndexedDbPersistence(db);
      } catch (e) {
        console.warn(e);
      }
    },
    makeStore(uid) {
      return makeCloudStore(db, uid);
    },
  };
}

function makeCloudStore(db, uid) {
  const col = collection(db, 'users', uid, 'projects');
  const imageRef = (pid, phid) => doc(db, 'users', uid, 'projects', pid, 'images', phid);
  let cache = new Map();
  let fromCache = true;
  let snapPending = false;
  let pendingWrites = 0;
  let lastError = null;
  const listeners = new Set();
  const notify = () =>
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    });

  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  const readyTimer = setTimeout(() => resolveReady(), 8000);

  const unsub = onSnapshot(
    col,
    { includeMetadataChanges: true },
    (snap) => {
      const next = new Map();
      snap.forEach((d) => next.set(d.id, d.data()));
      cache = next;
      fromCache = snap.metadata.fromCache;
      snapPending = snap.metadata.hasPendingWrites;
      clearTimeout(readyTimer);
      resolveReady();
      notify();
    },
    (err) => {
      lastError = err;
      console.error(err);
      resolveReady();
      notify();
    },
  );

  const track = (p) => {
    pendingWrites++;
    notify();
    p.then(
      () => {
        lastError = null;
      },
      (e) => {
        lastError = e;
        console.error(e);
      },
    ).finally(() => {
      pendingWrites--;
      notify();
    });
  };

  return {
    kind: 'cloud',
    uid,
    ready,
    async listProjects() {
      await ready;
      return [...cache.values()];
    },
    async getProject(id) {
      await ready;
      if (cache.has(id)) return cache.get(id);
      try {
        const s = await getDoc(doc(col, id));
        return s.exists() ? s.data() : null;
      } catch {
        return null;
      }
    },
    async saveProject(p) {
      const data = JSON.parse(JSON.stringify(p));
      delete data.copiedTo;
      cache.set(p.id, data);
      track(setDoc(doc(col, p.id), data));
      notify();
    },
    async deleteProject(id) {
      cache.delete(id);
      notify();
      try {
        const imgs = await getDocs(collection(db, 'users', uid, 'projects', id, 'images'));
        imgs.forEach((d) => track(deleteDoc(d.ref)));
      } catch (e) {
        console.error(e);
      }
      track(deleteDoc(doc(col, id)));
    },
    async putImage(pid, phid, blob) {
      const u8 = new Uint8Array(await blob.arrayBuffer());
      track(setDoc(imageRef(pid, phid), { data: Bytes.fromUint8Array(u8), type: blob.type || 'image/jpeg', t: Date.now() }));
    },
    async getImage(pid, phid) {
      let snap = null;
      try {
        snap = await getDocFromCache(imageRef(pid, phid));
      } catch {
        snap = null;
      }
      if (!snap || !snap.exists()) {
        try {
          snap = await getDoc(imageRef(pid, phid));
        } catch {
          snap = null;
        }
      }
      if (!snap || !snap.exists()) return null;
      const d = snap.data();
      return new Blob([d.data.toUint8Array()], { type: d.type || 'image/jpeg' });
    },
    async deleteImage(pid, phid) {
      track(deleteDoc(imageRef(pid, phid)));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    status() {
      return {
        pending: pendingWrites + (snapPending ? 1 : 0),
        offline: !navigator.onLine,
        fromCache,
        error: lastError,
      };
    },
    close() {
      unsub();
    },
  };
}
