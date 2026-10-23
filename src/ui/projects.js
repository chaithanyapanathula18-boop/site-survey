// Projects screen: the list of sites, account chip, new site and backup import.
import { h, clear, icon, button, sheet, toast, confirmSheet, promptSheet, fmtDate } from './dom.js';
import { account, bus, settings } from '../app.js';
import { stores } from '../store/index.js';
import { newProject } from '../model.js';
import { measure, fmtArea } from '../geo.js';
import { parseBackup, freshCopy, buildBackup } from '../export/text.js';
import { dataURLToBlob, blobToDataURL } from '../photos.js';
import { safeFileName, downloadFile, canShareFile, shareFile } from '../export/share.js';
import { settingsSheet, signIn, syncStatus } from './settings.js';

export function showProjects(root) {
  clear(root);
  const list = h('div', { class: 'project-list', 'aria-live': 'polite' });
  const chip = h('div', { class: 'account-slot' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: onImportFile });

  const screen = h(
    'div',
    { class: 'screen projects-screen' },
    h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, icon('pin')), h('h1', null, 'Site Surveyor')),
      chip,
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Settings', title: 'Settings', onclick: () => settingsSheet() }, icon('settings')),
    ),
    h('main', { class: 'projects-main' }, list),
    h(
      'div',
      { class: 'projects-footer' },
      button('Import backup', { icon: 'upload', cls: 'secondary', onClick: () => fileInput.click() }),
      button('New site', { icon: 'plus', cls: 'primary', onClick: createSite }),
    ),
    fileInput,
  );
  root.append(screen);

  let alive = true;
  let loadSeq = 0;

  function renderChip() {
    clear(chip);
    if (account.status === 'signed-out') {
      chip.append(h('button', { type: 'button', class: 'account-chip', onclick: signIn }, icon('user'), h('span', null, 'Sign in')));
    } else if (account.status === 'signed-in') {
      const st = syncStatus();
      const u = account.user;
      chip.append(
        h(
          'button',
          { type: 'button', class: `account-chip ${st.kind}`, title: st.text, 'aria-label': `${u.name || u.email}. ${st.text}`, onclick: () => settingsSheet() },
          u.photo ? h('img', { class: 'avatar small', src: u.photo, alt: '', referrerpolicy: 'no-referrer' }) : icon('user'),
          icon(st.kind === 'error' ? 'cloudOff' : 'cloud', `sync-${st.kind}`),
        ),
      );
    } else if (account.status === 'loading') {
      chip.append(h('span', { class: 'account-chip muted' }, icon('cloud'), h('span', null, '…')));
    }
  }

  async function load() {
    const seq = ++loadSeq;
    let projects;
    try {
      projects = await stores.active.listProjects();
    } catch (e) {
      console.error(e);
      if (seq !== loadSeq || !alive) return;
      clear(list).append(h('div', { class: 'empty' }, icon('warn', 'big'), h('p', null, e.message || 'Could not open saved sites.')));
      return;
    }
    if (seq !== loadSeq || !alive) return;
    projects.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    clear(list);
    if (!projects.length) {
      list.append(
        h(
          'div',
          { class: 'empty welcome' },
          icon('map', 'big'),
          h('h2', null, 'Measure a piece of land'),
          h('p', null, 'Walk to each corner of the plot and capture it with GPS, or tap the corners on the map. You get the shape, area in every local unit, a site plan PDF and a CAD drawing.'),
          button('Start a new site', { icon: 'plus', cls: 'primary', onClick: createSite }),
        ),
      );
      return;
    }
    projects.forEach((p) => list.append(projectRow(p)));
  }

  function projectRow(p) {
    const pts = Array.isArray(p.points) ? p.points : [];
    let summary = `${pts.length} corner${pts.length === 1 ? '' : 's'}`;
    if (pts.length >= 3) {
      try {
        summary = `${fmtArea(measure(pts).area, settings.areaUnit)} · ${summary}`;
      } catch {
        /* bad data: keep the count */
      }
    }
    const sub = [p.surveyNo && `Sy. ${p.surveyNo}`, p.village].filter(Boolean).join(' · ');
    return h(
      'div',
      { class: 'project-row' },
      h(
        'a',
        { class: 'project-open', href: `#/p/${encodeURIComponent(p.id)}` },
        h('span', { class: 'project-name' }, p.name || 'Untitled site'),
        sub ? h('span', { class: 'muted small' }, sub) : null,
        h('span', { class: 'project-sum' }, summary, h('span', { class: 'muted' }, ` · ${fmtDate(p.updatedAt || p.createdAt || Date.now())}`)),
      ),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': `More for ${p.name}`, onclick: () => rowMenu(p) }, icon('more')),
    );
  }

  function rowMenu(p) {
    const s = sheet({
      title: p.name || 'Site',
      content: h(
        'div',
        { class: 'stack' },
        button('Open', { icon: 'map', cls: 'secondary block', onClick: () => (s.close(), (location.hash = `#/p/${encodeURIComponent(p.id)}`)) }),
        button('Rename', { icon: 'edit', cls: 'secondary block', onClick: () => (s.close(), rename(p)) }),
        button('Save a backup file', { icon: 'download', cls: 'secondary block', onClick: () => (s.close(), backup(p)) }),
        button('Delete site', { icon: 'trash', cls: 'danger-outline block', onClick: () => (s.close(), remove(p)) }),
      ),
    });
  }

  async function rename(p) {
    const name = await promptSheet('Rename site', { label: 'Site name', value: p.name || '' });
    if (name == null || !name.trim()) return;
    await stores.active.saveProject({ ...p, name: name.trim(), updatedAt: Date.now() });
  }

  async function backup(p) {
    try {
      const text = await buildBackup(p, async (phid) => {
        const blob = await stores.active.getImage(p.id, phid);
        return blob ? blobToDataURL(blob) : null;
      });
      const blob = new Blob([text], { type: 'application/json' });
      const name = safeFileName(p.name, 'sitesurvey.json');
      if (canShareFile(blob, name)) {
        try {
          await shareFile(blob, name, p.name);
          return;
        } catch {
          /* fall back to a download */
        }
      }
      downloadFile(blob, name);
      toast(`Saved ${name}`);
    } catch (e) {
      console.error(e);
      toast('Could not make the backup file.');
    }
  }

  async function remove(p) {
    const ok = await confirmSheet(
      'Delete this site?',
      `“${p.name}” with its ${(p.points || []).length} corners and ${(p.photos || []).length} photos will be deleted${account.status === 'signed-in' ? ' from your account' : ' from this phone'}. This cannot be undone.`,
      { ok: 'Delete', danger: true },
    );
    if (!ok) return;
    try {
      await stores.active.deleteProject(p.id);
      toast('Site deleted');
    } catch (e) {
      console.error(e);
      toast('Could not delete the site.');
    }
  }

  async function createSite() {
    const p = newProject(defaultName());
    try {
      await stores.active.saveProject(p);
      location.hash = `#/p/${encodeURIComponent(p.id)}`;
    } catch (e) {
      console.error(e);
      toast(e.message || 'Could not create the site.');
    }
  }

  async function onImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { project, images } = parseBackup(await file.text());
      let p = project;
      const existing = await stores.active.getProject(p.id);
      if (existing) {
        const replace = await confirmSheet(
          'This site is already here',
          `“${existing.name}” already exists. Replace it with the backup, or keep both?`,
          { ok: 'Replace', cancel: 'Keep both' },
        );
        if (!replace) p = { ...freshCopy(p), name: `${p.name} (copy)` };
      }
      let missing = 0;
      for (const ph of p.photos) {
        const d = images[ph.id];
        if (!d) {
          missing++;
          continue;
        }
        await stores.active.putImage(p.id, ph.id, dataURLToBlob(d));
      }
      await stores.active.saveProject(p);
      toast(missing ? `Imported “${p.name}” (${missing} photo${missing === 1 ? '' : 's'} missing)` : `Imported “${p.name}”`);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Could not import that file.', { timeout: 5000 });
    }
  }

  const onAccount = () => {
    renderChip();
  };
  const onStores = () => {
    renderChip();
    load();
  };
  bus.addEventListener('account', onAccount);
  bus.addEventListener('stores', onStores);
  renderChip();
  load();

  return {
    destroy() {
      alive = false;
      bus.removeEventListener('account', onAccount);
      bus.removeEventListener('stores', onStores);
    },
  };
}

function defaultName() {
  const d = new Date();
  return `Site ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}
