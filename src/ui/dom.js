// Small DOM helpers, icons, sheets and toasts.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

const ICONS = {
  back: '<polyline points="15 18 9 12 15 6"/>',
  more: '<circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/><line x1="12" y1="1.5" x2="12" y2="4.5"/><line x1="12" y1="19.5" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="4.5" y2="12"/><line x1="19.5" y1="12" x2="22.5" y2="12"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  camera: '<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H7l1.6-2.2A1.5 1.5 0 0 1 9.8 3h4.4a1.5 1.5 0 0 1 1.2.8L17 6h1.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  layers: '<polygon points="12 3 21 8 12 13 3 8 12 3"/><polyline points="3 12.5 12 17.5 21 12.5"/><polyline points="3 17 12 22 21 17"/>',
  map: '<polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21 3 6"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>',
  plan: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9h3M4 14h3M9 4v3M14 4v3"/>',
  table: '<line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  download: '<path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M5 21h14"/>',
  share: '<path d="M12 3v13"/><polyline points="8 7 12 3 16 7"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  settings: '<path d="M4 7h3M11.5 7H20M4 17h8.5M17.5 17H20"/><circle cx="9.2" cy="7" r="2.3"/><circle cx="15" cy="17" r="2.3"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/>',
  cloudOff: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/><line x1="3" y1="3" x2="21" y2="21"/>',
  move: '<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>',
  insert: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
  recapture: '<path d="M20.5 12a8.5 8.5 0 1 1-2.8-6.3"/><polyline points="21 3.5 21 9 15.5 9"/>',
  road: '<path d="M8 3L5 21M16 3l3 18"/><path d="M12 4v3M12 10.5v3M12 17v3"/>',
  upload: '<path d="M12 21V9"/><polyline points="7 14 12 9 17 14"/><path d="M5 3h14"/>',
  fit: '<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><polyline points="21 15 21 21 15 21"/><polyline points="3 9 3 3 9 3"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="14 3 14 9 20 9"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="17"/><circle cx="12" cy="7.5" r="1.1" fill="currentColor" stroke="none"/>',
  warn: '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="16.8" r="1.1" fill="currentColor" stroke="none"/>',
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `icon ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}

export function iconSvgMarkup(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
}

export function button(label, opts = {}) {
  const { icon: ic, cls = '', onClick, title, disabled, type = 'button' } = opts;
  return h(
    'button',
    { type, class: `btn ${cls}`.trim(), onclick: onClick, title: title || null, 'aria-label': title || null, disabled: !!disabled },
    ic ? icon(ic) : null,
    label ? h('span', { class: 'btn-label' }, label) : null,
  );
}

let toastTimer = null;
export function toast(message, { action, onAction, timeout = 2800 } = {}) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  clear(el);
  el.append(h('span', null, message));
  if (action) {
    el.append(
      h(
        'button',
        {
          type: 'button',
          class: 'toast-action',
          onclick: () => {
            el.classList.remove('show');
            onAction && onAction();
          },
        },
        action,
      ),
    );
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), timeout);
}

const openSheets = [];

export function sheet({ title, content, actions, onClose, wide = false, className = '' }) {
  const backdrop = h('div', { class: 'sheet-backdrop' });
  const body = h('div', { class: 'sheet-body' }, content);
  const header = title
    ? h(
        'div',
        { class: 'sheet-header' },
        h('h2', null, title),
        h('button', { type: 'button', class: 'icon-btn sheet-close', 'aria-label': 'Close', onclick: () => close() }, icon('x')),
      )
    : null;
  const footer = actions && actions.length ? h('div', { class: 'sheet-actions' }, actions) : null;
  const panel = h('div', { class: `sheet ${wide ? 'wide' : ''} ${className}`.trim(), role: 'dialog', 'aria-modal': 'true' }, header, body, footer);
  const root = h('div', { class: 'sheet-root' }, backdrop, panel);
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    root.classList.remove('open');
    const i = openSheets.indexOf(api);
    if (i >= 0) openSheets.splice(i, 1);
    setTimeout(() => root.remove(), 200);
    onClose && onClose(result);
  }
  backdrop.addEventListener('click', () => close());
  document.body.append(root);
  requestAnimationFrame(() => root.classList.add('open'));
  const api = { close, root, panel, body };
  openSheets.push(api);
  return api;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openSheets.length) openSheets[openSheets.length - 1].close();
});

export function closeAllSheets() {
  [...openSheets].forEach((s) => s.close());
}

export function confirmSheet(title, message, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const s = sheet({
      title,
      content: h('p', { class: 'sheet-text' }, message),
      actions: [
        button(cancel, { cls: 'secondary', onClick: () => s.close() }),
        button(ok, {
          cls: danger ? 'danger' : 'primary',
          onClick: () => {
            result = true;
            s.close();
          },
        }),
      ],
      onClose: () => resolve(result),
    });
  });
}

export function promptSheet(title, { label, value = '', placeholder = '', ok = 'Save', multiline = false } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const input = multiline
      ? h('textarea', { class: 'input', rows: 4, placeholder })
      : h('input', { class: 'input', type: 'text', placeholder, autocomplete: 'off' });
    input.value = value;
    const submit = () => {
      result = input.value;
      s.close();
    };
    if (!multiline) input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
    const s = sheet({
      title,
      content: h('label', { class: 'field' }, label ? h('span', { class: 'field-label' }, label) : null, input),
      actions: [button('Cancel', { cls: 'secondary', onClick: () => s.close() }), button(ok, { cls: 'primary', onClick: submit })],
      onClose: () => resolve(result),
    });
    setTimeout(() => input.focus(), 250);
  });
}

export function fmtDate(t) {
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(t) {
  return new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
