// Settings sheet, Google sign-in/out, and copying on-device sites into the account.
import { h, icon, button, sheet, toast, confirmSheet } from './dom.js';
import { AREA_UNITS } from '../geo.js';
import { MAP_STYLES } from './mapview.js';
import { settings, updateSettings, account, bus, APP_VERSION } from '../app.js';
import { stores } from '../store/index.js';
import { normaliseProject } from '../model.js';

export function signInErrorText(e) {
  const code = (e && e.code) || '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in was cancelled.';
  if (code === 'auth/network-request-failed') return 'No connection. Try signing in again when you are online.';
  if (code === 'auth/unauthorized-domain')
    return 'This web address is not allowed to sign in. Add it in Firebase under Authentication, Settings, Authorized domains.';
  return 'Sign-in did not work. Please try again.';
}

export async function signIn() {
  if (!account.cloud) return;
  try {
    await account.cloud.signIn();
  } catch (e) {
    console.error(e);
    toast(signInErrorText(e), { timeout: 6000 });
  }
}

export async function signOut() {
  if (!account.cloud) return;
  const ok = await confirmSheet(
    'Sign out?',
    'Sites in your account stay safe in the cloud. After signing out, this phone shows only the sites saved on the phone itself.',
    { ok: 'Sign out' },
  );
  if (!ok) return;
  try {
    await account.cloud.signOut();
  } finally {
    // The cloud database is shut down on sign-out; start fresh.
    location.hash = '#/';
    location.reload();
  }
}

// Short description of where data is saved right now.
export function syncStatus() {
  if (account.status !== 'signed-in') {
    return { kind: 'local', text: 'Saved on this phone' };
  }
  const st = stores.active.status ? stores.active.status() : {};
  if (st.error) return { kind: 'error', text: 'Sync problem. Changes are kept on this phone for now.' };
  if (st.pending > 0) {
    return st.offline
      ? { kind: 'pending', text: 'Offline. Changes upload when you are back online.' }
      : { kind: 'pending', text: 'Saving to your account…' };
  }
  return { kind: 'ok', text: st.offline ? 'Offline. All changes are on this phone.' : 'All changes saved to your account' };
}

// ---- copying local sites into the account --------------------------------------

const dismissKey = (uid) => `ss_copy_dismissed_${uid}`;

async function uncopiedLocalSites(uid) {
  const all = await stores.local.listProjects().catch(() => []);
  return all.filter((p) => !(Array.isArray(p.copiedTo) && p.copiedTo.includes(uid)));
}

export async function copyLocalSites(uid, projects) {
  const cloud = stores.active;
  if (cloud.kind !== 'cloud' || cloud.uid !== uid) throw new Error('Sign in first.');
  let copied = 0;
  for (const raw of projects) {
    const local = normaliseProject(raw);
    const existing = await cloud.getProject(local.id);
    if (!existing || (existing.updatedAt || 0) < local.updatedAt) {
      for (const ph of local.photos) {
        const blob = await stores.local.getImage(local.id, ph.id).catch(() => null);
        if (blob) await cloud.putImage(local.id, ph.id, blob);
      }
      await cloud.saveProject(local);
      copied++;
    }
    await stores.local.saveProject({ ...raw, copiedTo: [...(raw.copiedTo || []), uid] });
  }
  return copied;
}

export async function offerCopyLocalSites(uid, { force = false } = {}) {
  const list = await uncopiedLocalSites(uid);
  if (!list.length) {
    if (force) toast('Every site on this phone is already in your account.');
    return;
  }
  try {
    if (!force && localStorage.getItem(dismissKey(uid))) return;
  } catch {
    /* storage blocked */
  }
  const n = list.length;
  const ok = await confirmSheet(
    `Copy ${n} site${n === 1 ? '' : 's'} to your account?`,
    `${n === 1 ? 'One site is' : `${n} sites are`} saved only on this phone. Copy ${n === 1 ? 'it' : 'them'}, with photos, into your account so ${n === 1 ? 'it is' : 'they are'} backed up and available on your other devices. The copies on this phone stay as they are.`,
    { ok: 'Copy', cancel: 'Not now' },
  );
  if (!ok) {
    try {
      localStorage.setItem(dismissKey(uid), '1');
    } catch {
      /* storage blocked */
    }
    return;
  }
  try {
    toast('Copying sites…', { timeout: 20000 });
    const copied = await copyLocalSites(uid, list);
    toast(copied ? `Copied ${copied} site${copied === 1 ? '' : 's'} to your account` : 'Your account already had the latest copies.');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Could not copy the sites.');
  }
}

// ---- settings sheet ----------------------------------------------------------------

function segmented(options, current, onPick) {
  const seg = h(
    'div',
    { class: 'segmented', role: 'group' },
    options.map(([value, label]) =>
      h(
        'button',
        {
          type: 'button',
          class: String(value) === String(current) ? 'on' : '',
          'data-value': value,
          onclick: (e) => {
            seg.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
            e.currentTarget.classList.add('on');
            onPick(value);
          },
        },
        label,
      ),
    ),
  );
  return seg;
}

function section(title, ...children) {
  return h('section', { class: 'settings-section' }, h('h3', null, title), children);
}

function accountSection() {
  const box = h('div', { class: 'account-box' });
  const render = () => {
    box.replaceChildren();
    if (account.status === 'unconfigured') {
      box.append(
        h('p', { class: 'muted small' }, 'Sites are saved on this phone. Google sign-in and cloud backup turn on when the app is published on Firebase Hosting.'),
      );
    } else if (account.status === 'loading') {
      box.append(h('p', { class: 'muted small' }, 'Checking your account…'));
    } else if (account.status === 'signed-out') {
      box.append(
        h('p', { class: 'muted small' }, 'Sign in to back up your sites and see them on any device. Without signing in, sites are saved on this phone only.'),
        button('Sign in with Google', { icon: 'user', cls: 'primary block', onClick: signIn }),
      );
    } else if (account.status === 'signed-in') {
      const u = account.user;
      const st = syncStatus();
      box.append(
        h(
          'div',
          { class: 'account-row' },
          u.photo ? h('img', { class: 'avatar', src: u.photo, alt: '', referrerpolicy: 'no-referrer' }) : h('span', { class: 'avatar' }, icon('user')),
          h('span', { class: 'account-text' }, h('strong', null, u.name || 'Signed in'), h('span', { class: 'muted small' }, u.email)),
        ),
        h('p', { class: `sync-line ${st.kind}` }, icon(st.kind === 'error' ? 'cloudOff' : 'cloud'), st.text),
        button('Copy sites from this phone', { icon: 'upload', cls: 'secondary block', onClick: () => offerCopyLocalSites(u.uid, { force: true }) }),
        button('Sign out', { cls: 'secondary block', onClick: signOut }),
      );
    }
  };
  render();
  const onAccount = () => render();
  bus.addEventListener('account', onAccount);
  const unsub = stores.subscribe(render);
  return { el: box, dispose: () => (bus.removeEventListener('account', onAccount), unsub()) };
}

export function settingsSheet() {
  const acc = accountSection();
  const areaSel = h(
    'select',
    { class: 'input', 'aria-label': 'Main area unit', onchange: (e) => updateSettings({ areaUnit: e.target.value }) },
    AREA_UNITS.map((u) => h('option', { value: u.key }, u.label)),
  );
  areaSel.value = settings.areaUnit;
  const styleSel = h(
    'select',
    { class: 'input', 'aria-label': 'Map style', onchange: (e) => updateSettings({ mapStyle: e.target.value }) },
    Object.entries(MAP_STYLES).map(([k, st]) => h('option', { value: k }, st.name)),
  );
  styleSel.value = settings.mapStyle;
  const toggle = (label, key, note) =>
    h(
      'label',
      { class: 'toggle-row' },
      h('span', null, label, note ? h('span', { class: 'muted small block' }, note) : null),
      h('input', { type: 'checkbox', checked: !!settings[key], onchange: (e) => updateSettings({ [key]: e.target.checked }) }),
    );

  sheet({
    title: 'Settings',
    wide: true,
    className: 'settings-sheet',
    content: h(
      'div',
      { class: 'form' },
      section('Account', acc.el),
      section(
        'Units',
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Lengths'), segmented([['m', 'Metres'], ['ft', 'Feet']], settings.lengthUnit, (v) => updateSettings({ lengthUnit: v }))),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Main area unit'), areaSel),
      ),
      section(
        'Corner capture',
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'field-label' }, 'Stand still at each corner for'),
          segmented([[5, '5 s'], [10, '10 s'], [20, '20 s'], [30, '30 s']], settings.avgSeconds, (v) => updateSettings({ avgSeconds: Number(v) })),
          h('span', { class: 'muted small' }, 'Longer gives a steadier position. 10 seconds suits most phones.'),
        ),
        toggle('Keep the screen on while surveying', 'keepAwake'),
      ),
      section(
        'Map',
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Map style'), styleSel),
        toggle('Show side lengths on the map', 'showSideLengths'),
        toggle('Show photos on the map and plan', 'showPhotosOnMap'),
      ),
      section(
        'About',
        h('p', { class: 'muted small' }, `Site Surveyor ${APP_VERSION}. Measurements come from phone GPS and are usually good to a few metres. Use them for planning, not as a legal survey.`),
        h('p', { class: 'muted small' }, 'Map data © OpenStreetMap contributors, © CARTO.'),
      ),
    ),
    onClose: () => acc.dispose(),
  });
}
