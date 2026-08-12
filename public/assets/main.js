import { get, onSlow } from './api.js';
import { closeSocket } from './queue-socket.js';
import { go, homeFor, parseRoute, restore, session, signOut, startRouter } from './store.js';
import { renderAuth } from './screens/auth.js';
import { renderBoard, renderHistory } from './screens/board.js';
import { renderMyBookings, renderSlots } from './screens/booking.js';
import { renderDirectory, renderShop } from './screens/discover.js';
import { renderQueue } from './screens/queue.js';
import { renderHours, renderServices, renderSettings, renderStaff } from './screens/manage.js';
import { esc, icon } from './ui.js';

const app = document.getElementById('app');

/** Teardown for whatever the previous screen subscribed to. */
let cleanups = [];

const NAV = {
  CUSTOMER: [
    { key: 'cari', label: 'Cari usaha', icon: 'ph-magnifying-glass' },
    { key: 'booking-saya', label: 'Booking saya', icon: 'ph-calendar-check' },
  ],
  OWNER: [
    { key: 'papan', label: 'Papan hari ini', icon: 'ph-squares-four' },
    { key: 'layanan', label: 'Layanan', icon: 'ph-list-dashes' },
    { key: 'kapster', label: 'Kapster', icon: 'ph-users-three' },
    { key: 'jam', label: 'Jam operasional', icon: 'ph-clock' },
    { key: 'riwayat', label: 'Riwayat', icon: 'ph-archive' },
    { key: 'pengaturan', label: 'Pengaturan', icon: 'ph-gear' },
    { key: 'cari', label: 'Cari usaha', icon: 'ph-magnifying-glass' },
  ],
  STAFF: [
    { key: 'papan', label: 'Papan hari ini', icon: 'ph-squares-four' },
    { key: 'riwayat', label: 'Riwayat', icon: 'ph-archive' },
  ],
};

/** Screens reachable without signing in — the catalogue, and auth itself. */
const PUBLIC_SCREENS = new Set(['masuk', 'daftar', 'cari', 'usaha']);

const SCREENS = {
  cari: renderDirectory,
  usaha: renderShop,
  jadwal: renderSlots,
  antrian: renderQueue,
  'booking-saya': renderMyBookings,
  papan: renderBoard,
  layanan: renderServices,
  kapster: renderStaff,
  jam: renderHours,
  riwayat: renderHistory,
  pengaturan: renderSettings,
};

/** Owner and staff screens need to know which shop they are running. */
async function ensureShop() {
  if (session.shop || session.role === 'CUSTOMER') return;

  try {
    const shops = await get('/shops');
    session.shop = shops[0] ?? null;
  } catch {
    // A staff member cannot list shops — they get theirs from any booking view,
    // so fall back to the shop their staff row belongs to.
    session.shop = null;
  }
}

async function render() {
  cleanups.forEach((fn) => fn());
  cleanups = [];

  const route = parseRoute();

  if (!route.name) {
    return go(session.signedIn ? homeFor(session.user) : 'cari');
  }

  if (route.name === 'masuk' || route.name === 'daftar') {
    return renderAuth(app, route);
  }

  if (!session.signedIn && !PUBLIC_SCREENS.has(route.name)) {
    return go('masuk');
  }

  await ensureShop();

  const screen = SCREENS[route.name];
  if (!screen) {
    app.innerHTML = shell(`<div class="empty">Halaman tidak ditemukan.</div>`);
    return;
  }

  app.innerHTML = shell('<div id="view"></div>');
  bindShell();
  await screen(document.getElementById('view'), route, cleanups);
}

function shell(inner) {
  const items = session.signedIn ? (NAV[session.role] ?? []) : [];
  const active = parseRoute().name;

  return `<div class="shell">
    <aside class="sidebar">
      <a class="brand" href="/"><i class="ph ph-scissors"></i> MauApa?</a>
      ${items
        .map(
          (item) => `<button class="nav-item ${item.key === active ? 'on' : ''}" data-go="${item.key}">
            ${icon(item.icon)} ${esc(item.label)}</button>`,
        )
        .join('')}
      ${
        session.signedIn
          ? `<div class="spacer"></div>
             <div class="who">
               <span class="avatar">${esc((session.user.name ?? '?').charAt(0).toUpperCase())}</span>
               <div style="min-width:0">
                 <div style="font-size:13px;overflow:hidden;text-overflow:ellipsis">${esc(session.user.name)}</div>
                 <div class="faint" style="font-size:11px">${esc(roleLabel(session.role))}</div>
               </div>
               <button class="btn btn-ghost btn-sm" id="out" title="Keluar">${icon('ph-sign-out')}</button>
             </div>`
          : `<div class="spacer"></div>
             <button class="nav-item" data-go="masuk">${icon('ph-sign-in')} Masuk</button>`
      }
    </aside>
    <main class="main">
      <div id="waking"></div>
      ${inner}
    </main>
  </div>`;
}

function bindShell() {
  app.querySelectorAll('[data-go]').forEach((button) => {
    button.addEventListener('click', () => go(button.dataset.go));
  });
  app.querySelector('#out')?.addEventListener('click', () => {
    closeSocket();
    signOut();
  });
}

const roleLabel = (role) =>
  ({ OWNER: 'Pemilik usaha', STAFF: 'Kapster', CUSTOMER: 'Pelanggan' })[role] ?? '';

// The free tier sleeps after 15 minutes. Without this, the first request of the
// day looks like a hung page rather than a container waking up.
onSlow((slow) => {
  const banner = document.getElementById('waking');
  if (!banner) return;
  banner.innerHTML = slow
    ? `<div class="notice notice-amber" style="margin-bottom:16px">
         Server sedang bangun dari tidur — hosting gratis, butuh sekitar satu menit. Ini bukan error.
       </div>`
    : '';
});

await restore();
startRouter(render);
await render();
