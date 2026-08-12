import { get, publicApi, query } from '../api.js';
import { events, watchQueue } from '../queue-socket.js';
import { go, session } from '../store.js';
import {
  empty, errorNotice, esc, fill, icon, isoDateIn, skeletons, statusTag, timeIn,
} from '../ui.js';

/**
 * A shop's live queue, as a customer sees it.
 *
 * The payload carries no customer names — the websocket audience is mixed, so
 * the server never puts them on the wire. Your own booking is flagged instead,
 * which is the only row you actually need to find.
 */
export async function renderQueue(root, route, cleanups) {
  const shopId = route.params[0];
  fill(root, skeletons(3));

  let shop;
  try {
    shop = await publicApi(`/public/shops/${shopId}`);
  } catch (error) {
    fill(root, errorNotice(error));
    return;
  }

  const date = isoDateIn(shop.timezone);

  fill(
    root,
    `<button class="btn btn-ghost" id="back" style="margin-bottom:10px">${icon('ph-arrow-left')} ${esc(shop.name)}</button>
    <div class="page-head">
      <div>
        <h1>Antrian hari ini</h1>
        <div class="faint">${esc(shop.name)} · ${esc(date)} · ${esc(shop.timezone)}</div>
      </div>
      <span class="row" style="gap:6px">
        <span class="tag tag-accent">${icon('ph-broadcast')} live</span>
      </span>
    </div>
    <div id="rows">${skeletons(2)}</div>
    <details style="margin-top:20px">
      <summary class="faint" style="cursor:pointer">Peristiwa websocket</summary>
      <div class="events" id="events"></div>
    </details>`,
  );

  root.querySelector('#back').addEventListener('click', () => go(`usaha/${shop.id}`));

  const rows = root.querySelector('#rows');
  const eventLog = root.querySelector('#events');

  const paint = (queue) => {
    if (queue.date !== date) return;

    rows.innerHTML = queue.entries.length
      ? `<div class="stack">${queue.entries.map(queueRow).join('')}</div>`
      : empty('Belum ada antrian hari ini.');

    eventLog.innerHTML = events()
      .map((e) => `<div>${esc(e.at)}  ${esc(e.text)}</div>`)
      .join('');
  };

  try {
    paint(await get(`/shops/${shop.id}/queue${query({ date })}`));
  } catch (error) {
    rows.innerHTML = errorNotice(error);
  }

  cleanups.push(watchQueue(shop.id, date, paint));
}

export const queueRow = (entry) => `
  <div class="queue-row ${entry.status === 'IN_PROGRESS' ? 'current' : ''} ${entry.isYours ? 'mine' : ''}">
    <span class="queue-pos ${entry.position ? '' : 'faint'}">${entry.position ?? '–'}</span>
    <div style="min-width:0">
      <div>${esc(entry.serviceName)}${entry.isYours ? ' <span class="tag tag-amber">Booking kamu</span>' : ''}</div>
      <div class="faint">${esc(entry.staffName)}${entry.customerName ? ` · ${esc(entry.customerName)}` : ''}</div>
    </div>
    <span class="nums faint">${esc(entry.startTime.slice(11, 16))}</span>
    ${statusTag(entry.status)}
  </div>`;

/** Same data, rendered with the shop's own clock — used by the owner's board. */
export const boardRow = (entry, timezone) => `
  <div class="queue-row ${entry.status === 'IN_PROGRESS' ? 'current' : ''}">
    <span class="queue-pos ${entry.position ? '' : 'faint'}">${entry.position ?? '–'}</span>
    <div style="min-width:0">
      <div>${esc(entry.customerName ?? 'Pelanggan')}</div>
      <div class="faint">${esc(entry.serviceName)} · ${esc(entry.staffName)}</div>
    </div>
    <span class="nums faint">${esc(timeIn(entry.startTime, timezone))}</span>
    ${statusTag(entry.status)}
  </div>`;
