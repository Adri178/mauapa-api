/** Small rendering helpers shared by every screen. */

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export const rp = (n) => 'Rp ' + Number(n).toLocaleString('id-ID');

export const icon = (name) => `<i class="ph ${name}"></i>`;

/** Wall-clock time of an instant, read in the shop's zone rather than the device's. */
export const timeIn = (iso, timezone) =>
  new Date(iso).toLocaleTimeString('id-ID', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  });

export const dateIn = (iso, timezone) =>
  new Date(iso).toLocaleDateString('id-ID', {
    timeZone: timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

/** YYYY-MM-DD for a date as that zone reads it — what the API expects. */
export const isoDateIn = (timezone, date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

export const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export const STATUS = {
  BOOKED: { label: 'Dipesan', cls: 'tag-outline', icon: 'ph-clock' },
  WAITING: { label: 'Menunggu', cls: 'tag-amber', icon: 'ph-hourglass-medium' },
  IN_PROGRESS: { label: 'Dikerjakan', cls: 'tag-accent', icon: 'ph-scissors' },
  DONE: { label: 'Selesai', cls: 'tag-neutral', icon: 'ph-check' },
  CANCELLED: { label: 'Dibatalkan', cls: 'tag-neutral', icon: 'ph-x' },
};

export const statusTag = (status) => {
  const s = STATUS[status] ?? { label: status, cls: 'tag-neutral' };
  return `<span class="tag ${s.cls}">${esc(s.label)}</span>`;
};

/** The next status a shop can move a booking to, or null at the end of the line. */
export const NEXT_STATUS = { BOOKED: 'WAITING', WAITING: 'IN_PROGRESS', IN_PROGRESS: 'DONE' };

export const empty = (message, hint = '') => `
  <div class="empty">
    <div>${esc(message)}</div>
    ${hint ? `<div class="faint" style="margin-top:6px">${esc(hint)}</div>` : ''}
  </div>`;

export const errorNotice = (error) =>
  `<div class="notice notice-error">${esc(error?.message ?? 'Terjadi kesalahan')}</div>`;

export const skeletons = (count = 3) =>
  `<div class="stack">${'<div class="skeleton"></div>'.repeat(count)}</div>`;

/**
 * Replaces a container's contents and returns it, so a screen can render then
 * bind without re-querying the DOM.
 */
export function fill(node, html) {
  node.innerHTML = html;
  return node;
}

/** Delegated click binding: survives the container being re-rendered. */
export function onClick(root, selector, handler) {
  root.addEventListener('click', (event) => {
    const hit = event.target.closest(selector);
    if (hit && root.contains(hit)) handler(hit, event);
  });
}

export function confirmDialog({ title, body, confirmLabel = 'Ya', danger = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    backdrop.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true">
        <h2>${esc(title)}</h2>
        <p class="muted">${esc(body)}</p>
        <div class="dialog-actions">
          <button class="btn btn-secondary" data-close>Batal</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${esc(confirmLabel)}</button>
        </div>
      </div>`;

    const close = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') close(false);
    };

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.closest('[data-close]')) close(false);
      if (event.target.closest('[data-confirm]')) close(true);
    });
    document.addEventListener('keydown', onKey);

    document.body.append(backdrop);
    backdrop.querySelector('[data-confirm]').focus();
  });
}

/** Brief inline confirmation — a save that says nothing looks like a save that failed. */
export function flash(node, message, tone = 'notice') {
  node.innerHTML = `<div class="${tone}">${esc(message)}</div>`;
  setTimeout(() => {
    if (node.firstElementChild?.textContent === message) node.innerHTML = '';
  }, 4000);
}
