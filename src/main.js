// Entry point: hosting redirect, service worker, account/cloud boot and routing.
import { account, setAccount, bus, closeSession, state, APP_VERSION } from './app.js';
import { stores } from './store/index.js';
import { requestPersistentStorage } from './store/local.js';
import { toast } from './ui/dom.js';
import { showProjects } from './ui/projects.js';
import { showProject } from './ui/project.js';
import { offerCopyLocalSites, signInErrorText } from './ui/settings.js';
import { hostingRedirectTarget } from './hosting.js';

function boot() {
  document.documentElement.dataset.version = APP_VERSION;
  registerServiceWorker();
  requestPersistentStorage();
  startAccount();
  window.addEventListener('hashchange', route);
  stores.subscribe(() => bus.dispatchEvent(new CustomEvent('stores')));
  route();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  const register = () =>
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          toast('A new version is ready', { action: 'Reload', onAction: () => applyUpdate(reg.waiting), timeout: 15000 });
        }
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              toast('A new version is ready', { action: 'Reload', onAction: () => applyUpdate(w), timeout: 15000 });
            }
          });
        });
      })
      .catch((e) => console.warn('Service worker not registered', e));
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
}

function applyUpdate(worker) {
  let done = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (done) return;
    done = true;
    location.reload();
  });
  worker.postMessage('skipWaiting');
}

// ---- account ------------------------------------------------------------------

// Resolves once we know which store to use (on-device, or the signed-in account).
let settle;
const accountSettled = new Promise((r) => (settle = r));
setTimeout(() => settle(), 8000);

async function loadFirebaseConfig() {
  try {
    const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('json')) return null;
    const cfg = await res.json();
    return cfg && cfg.apiKey && cfg.projectId ? cfg : null;
  } catch {
    return null;
  }
}

async function startAccount() {
  const config = await loadFirebaseConfig();
  if (!config) {
    setAccount({ status: 'unconfigured', config: null });
    settle();
    return;
  }
  setAccount({ status: 'loading', config });
  try {
    const { startCloud } = await import('./cloud.js');
    const cloud = startCloud(config, {
      onUser: (user) => onUser(cloud, user),
      onError: (e) => {
        console.error(e);
        setAccount({ error: e });
        if (e && e.code !== 'auth/no-auth-event') toast(signInErrorText(e), { timeout: 6000 });
      },
    });
    setAccount({ cloud });
  } catch (e) {
    console.error('Cloud unavailable', e);
    setAccount({ status: 'unconfigured', error: e });
    settle();
  }
}

function onUser(cloud, user) {
  const prevUid = account.user && account.user.uid;
  if (user) {
    const store = cloud.makeStore(user.uid);
    stores.setActive(store);
    setAccount({ status: 'signed-in', user, error: null });
    if (prevUid !== user.uid) {
      leaveProjectIfOpen();
      offerCopyLocalSites(user.uid);
    }
  } else {
    stores.setActive(stores.local);
    setAccount({ status: 'signed-out', user: null });
    if (prevUid) leaveProjectIfOpen();
  }
  settle();
}

function leaveProjectIfOpen() {
  if (/^#\/p\//.test(location.hash)) location.hash = '#/';
  else route();
}

// ---- routing ------------------------------------------------------------------

let current = null; // { key, screen }
const root = () => document.getElementById('app');

export function parseRoute(hash) {
  const m = /^#\/p\/([^/?#]+)(?:\/(map|plan|data|photos))?/.exec(hash || '');
  if (m) return { name: 'project', id: decodeURIComponent(m[1]), tab: m[2] || 'map' };
  return { name: 'projects' };
}

let routeSeq = 0;

async function route() {
  const seq = ++routeSeq;
  const r = parseRoute(location.hash);
  const key = r.name === 'project' ? `p:${r.id}` : 'list';
  if (current && current.key === key) {
    if (r.name === 'project' && current.screen.setTab) current.screen.setTab(r.tab, { fromRoute: true });
    return;
  }
  if (current) {
    current.screen.destroy && current.screen.destroy();
    current = null;
    await closeSession();
  }
  const el = root();
  if (r.name === 'project') {
    await accountSettled;
    if (seq !== routeSeq) return;
    const screen = await showProject(el, r.id, r.tab);
    if (seq !== routeSeq) {
      if (screen) screen.destroy();
      return;
    }
    if (!screen) {
      toast('That site was not found.');
      location.replace('#/');
      return;
    }
    current = { key, screen };
  } else {
    current = { key, screen: showProjects(el) };
  }
}

// Save straight away when the app goes to the background; iOS may not come back.
window.addEventListener('pagehide', () => state.session && state.session.saveNow());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.session) state.session.saveNow();
});

// Start last, once every module-level binding above exists.
const redirect = hostingRedirectTarget(location);
if (redirect) location.replace(redirect);
else boot();
