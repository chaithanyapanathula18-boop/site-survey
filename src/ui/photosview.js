// Photos tab: take photos on site and browse them.
import { h, clear, icon, button, fmtDateTime } from './dom.js';

export function createPhotosView(container, ctx) {
  function render() {
    const s = ctx.session();
    clear(container);
    if (!s) return;
    const p = s.project;
    const wrap = h('div', { class: 'photos-wrap' });
    wrap.append(
      h(
        'div',
        { class: 'photo-actions' },
        button('Take photo', { icon: 'camera', cls: 'primary', onClick: () => ctx.takePhoto(true) }),
        button('From gallery', { icon: 'image', cls: 'secondary', onClick: () => ctx.takePhoto(false) }),
      ),
    );
    if (!p.photos.length) {
      wrap.append(
        h(
          'div',
          { class: 'empty' },
          icon('camera', 'big'),
          h('p', null, 'No photos yet.'),
          h('p', { class: 'muted small' }, 'Photos are saved with the GPS spot where you took them, so they appear on the map and in the PDF.'),
        ),
      );
    } else {
      const grid = h('div', { class: 'photo-grid' });
      p.photos.forEach((ph, i) => {
        const corner = ph.pointId ? p.points.findIndex((q) => q.id === ph.pointId) : -1;
        grid.append(
          h(
            'button',
            { type: 'button', class: 'photo-tile', onclick: () => ctx.onPhotoTap(ph.id) },
            ph.thumb ? h('img', { src: ph.thumb, alt: ph.caption || `Photo ${i + 1}`, loading: 'lazy' }) : h('div', { class: 'photo-missing' }, icon('image')),
            h(
              'span',
              { class: 'photo-meta' },
              h('span', { class: 'photo-title' }, ph.caption || `Photo ${i + 1}`),
              h('span', { class: 'photo-sub' }, [corner >= 0 ? `P${corner + 1} · ` : '', fmtDateTime(ph.t)].join('')),
            ),
            ph.lat == null ? h('span', { class: 'photo-nogps', title: 'No location' }, icon('pin')) : null,
          ),
        );
      });
      wrap.append(grid);
      wrap.append(h('p', { class: 'muted small center' }, `${p.photos.length} photo${p.photos.length === 1 ? '' : 's'}`));
    }
    container.append(wrap);
  }
  return { render };
}
