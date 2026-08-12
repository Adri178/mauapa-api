import { get, patch, publicApi, query } from '../api.js';
import { events, watchQueue } from '../queue-socket.js';
import { go, session } from '../store.js';
import {
  NEXT_STATUS, STATUS, empty, errorNotice, esc, fill, icon, isoDateIn, skeletons, statusTag,
  timeIn,
} from '../ui.js';

/**
 * The operational board: today's queue, with the button that moves it.
 *
 * Owners and the shop's own staff share this screen. A staff member sees the
 * whole shop but can filter down to themselves, which is why login resolves
 * their staffId — the bookings are keyed by staff, not by user.
 */
export async function renderBoard(root, route, cleanups) {
  const shop = session.shop;
  if (!shop) {
    fill(root, empty('Belum ada usaha.', 'Buat usahamu dulu di Pengaturan.'));
    return;
  }

  const date = isoDateIn(shop.timezone);
  const onlyMine = route.query.saya === '1';

  fill(
    root,
    `<div class="page-head">
      <div>
        <h1>Papan hari ini</h1>
        <div class="faint">${esc(shop.name)} · ${esc(date)}</div>
      </div>
      <span class="row" style="gap:8px">
        ${
          session.user?.staffId
            ? `<button class="btn btn-secondary btn-sm" id="mine" aria-pressed="${onlyMine}"
                 style="${onlyMine ? 'border-color:var(--accent);background:var(--accent-100)' : ''}">
                 ${icon('ph-user')} Jadwal saya</button>`
            : ''
        }
        <span class="tag tag-accent">${icon('ph-broadcast')} live</span>
      </span>
    </div>

    <div class="grid" id="stats" style="margin-bottom:18px"></div>
    <div id="rows">${skeletons(3)}</div>

    <details style="margin-top:20px">
      <summary class="faint" style="cursor:pointer">Peristiwa websocket</summary>
      <div class="events" id="events"></div>
    </details>`,
  );

  root.querySelector('#mine')?.addEventListener('click', () => {
    go(`papan${onlyMine ? '' : '?saya=1'}`);
  });

  const rows = root.querySelector('#rows');
  const stats = root.querySelector('#stats');
  const eventLog = root.querySelector('#events');

  const paint = (queue) => {
    if (queue.date !== date) return;

    const visible = onlyMine
      ? queue.entries.filter((entry) => entry.staffId === session.user.staffId)
      : queue.entries;

    const count = (...statuses) =>
      visible.filter((entry) => statuses.includes(entry.status)).length;

    stats.innerHTML = [
      ['Total hari ini', visible.length],
      ['Menunggu', count('BOOKED', 'WAITING')],
      ['Selesai', count('DONE')],
    ]
      .map(
        ([label, value]) => `<div class="card">
          <div class="faint" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em">${label}</div>
          <div class="nums" style="font-size:24px">${value}</div>
        </div>`,
      )
      .join('');

    rows.innerHTML = visible.length
      ? `<div class="stack">${visible.map((entry) => row(entry, shop.timezone)).join('')}</div>`
      : empty(
          onlyMine ? 'Tidak ada jadwal untukmu hari ini.' : 'Belum ada booking hari ini.',
          'Bagikan link usahamu supaya pelanggan bisa memesan.',
        );

    eventLog.innerHTML = events()
      .map((e) => `<div>${esc(e.at)}  ${esc(e.text)}</div>`)
      .join('');
  };

  const reload = async () => {
    try {
      paint(await get(`/shops/${shop.id}/queue${query({ date })}`));
    } catch (error) {
      rows.innerHTML = errorNotice(error);
    }
  };

  rows.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-advance]');
    if (!button) return;

    button.disabled = true;
    try {
      await patch(`/shops/${shop.id}/bookings/${button.dataset.advance}/status`, {
        status: button.dataset.to,
      });
      // The broadcast repaints everyone including this tab, so no local edit.
    } catch (error) {
      rows.prepend(
        Object.assign(document.createElement('div'), { innerHTML: errorNotice(error) }),
      );
      button.disabled = false;
    }
  });

  await reload();
  cleanups.push(watchQueue(shop.id, date, paint));
}

const row = (entry, timezone) => {
  const next = NEXT_STATUS[entry.status];

  return `<div class="queue-row ${entry.status === 'IN_PROGRESS' ? 'current' : ''}">
    <span class="queue-pos ${entry.position ? '' : 'faint'}">${entry.position ?? '–'}</span>
    <div style="min-width:0">
      <div>${esc(entry.customerName ?? 'Pelanggan')}</div>
      <div class="faint">${esc(entry.serviceName)} · ${esc(entry.staffName)} · ${esc(timeIn(entry.startTime, timezone))}</div>
    </div>
    ${statusTag(entry.status)}
    ${
      next
        ? `<button class="btn btn-primary btn-sm" data-advance="${esc(entry.bookingId)}" data-to="${next}">
             ${esc(STATUS[next].label)} ${icon('ph-arrow-right')}</button>`
        : '<span></span>'
    }
  </div>`;
};

/** Past and future bookings, filtered — the owner's records view. */
export async function renderHistory(root, route) {
  const shop = session.shop;
  if (!shop) {
    fill(root, empty('Belum ada usaha.'));
    return;
  }

  const status = route.query.status ?? '';
  const date = route.query.tanggal ?? '';

  fill(
    root,
    `<div class="page-head"><h1>Riwayat booking</h1></div>
    <form class="row" id="filters" style="margin-bottom:16px">
      <select class="select" id="status" style="max-width:190px">
        <option value="">Semua status</option>
        ${Object.entries(STATUS)
          .map(
            ([key, meta]) =>
              `<option value="${key}" ${key === status ? 'selected' : ''}>${esc(meta.label)}</option>`,
          )
          .join('')}
      </select>
      <input class="input" id="tanggal" type="date" value="${esc(date)}" style="max-width:180px" />
      <button class="btn btn-primary" type="submit">Terapkan</button>
      ${status || date ? '<button class="btn btn-ghost" type="button" id="clear">Bersihkan</button>' : ''}
    </form>
    <div id="list">${skeletons(3)}</div>`,
  );

  root.querySelector('#filters').addEventListener('submit', (event) => {
    event.preventDefault();
    const next = new URLSearchParams();
    const chosen = root.querySelector('#status').value;
    const day = root.querySelector('#tanggal').value;
    if (chosen) next.set('status', chosen);
    if (day) next.set('tanggal', day);
    go(`riwayat${next.toString() ? `?${next}` : ''}`);
  });
  root.querySelector('#clear')?.addEventListener('click', () => go('riwayat'));

  const list = root.querySelector('#list');

  try {
    const page = await get(
      `/shops/${shop.id}/bookings${query({ status, date, order: 'desc', limit: 50 })}`,
    );

    list.innerHTML = page.data.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Waktu</th><th>Status</th><th>Layanan</th><th>Kapster</th></tr></thead>
          <tbody>${page.data
            .map(
              (booking) => `<tr>
                <td class="nums">${esc(new Date(booking.startTime).toLocaleString('id-ID', {
                  timeZone: shop.timezone,
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }))}</td>
                <td>${statusTag(booking.status)}</td>
                <td class="faint mono" style="font-size:12px">${esc(booking.serviceId.slice(0, 8))}</td>
                <td class="faint mono" style="font-size:12px">${esc(booking.staffId.slice(0, 8))}</td>
              </tr>`,
            )
            .join('')}</tbody>
        </table></div>
        <p class="faint" style="margin-top:12px">${page.meta.total} booking</p>`
      : empty('Tidak ada booking yang cocok dengan filter ini.');
  } catch (error) {
    list.innerHTML = errorNotice(error);
  }
}
