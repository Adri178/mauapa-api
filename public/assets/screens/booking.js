import { get, patch, post, publicApi, query } from '../api.js';
import { go } from '../store.js';
import {
  DAY_NAMES, confirmDialog, dateIn, empty, errorNotice, esc, fill, icon, isoDateIn, rp,
  skeletons, statusTag, timeIn,
} from '../ui.js';

const DAYS_AHEAD = 14;

/**
 * Service → staff → day → slot, then book.
 *
 * Availability is re-read after every attempt, successful or not. Slots sit on
 * a 15-minute grid while services often run longer, so neighbouring slots
 * overlap: taking one invalidates the ones around it, and a stale grid would
 * offer times the API is about to refuse.
 */
export async function renderSlots(root, route) {
  const shopId = route.params[0];
  fill(root, skeletons(4));

  let shop;
  try {
    shop = await publicApi(`/public/shops/${shopId}`);
  } catch (error) {
    fill(root, errorNotice(error));
    return;
  }

  if (!shop.services.length || !shop.staff.length) {
    fill(root, empty('Usaha ini belum bisa menerima booking.'));
    return;
  }

  const pick = {
    serviceId: shop.services[0].id,
    staffId: shop.staff[0].id,
    date: isoDateIn(shop.timezone),
    slot: null,
  };

  const days = Array.from({ length: DAYS_AHEAD }, (_, offset) => {
    const at = new Date(Date.now() + offset * 86_400_000);
    return { iso: isoDateIn(shop.timezone, at), at };
  });

  fill(
    root,
    `<button class="btn btn-ghost" id="back" style="margin-bottom:10px">${icon('ph-arrow-left')} ${esc(shop.name)}</button>
    <div class="page-head"><h1>Pilih jadwal</h1></div>

    <div class="stack" style="gap:22px">
      <section>
        <div class="faint" style="margin-bottom:8px">1 · Layanan</div>
        <div class="stack" id="services"></div>
      </section>

      <section>
        <div class="faint" style="margin-bottom:8px">2 · Kapster</div>
        <div class="row" id="staff"></div>
      </section>

      <section>
        <div class="faint" style="margin-bottom:8px">3 · Tanggal</div>
        <div class="day-tabs" id="days"></div>
      </section>

      <section>
        <div class="faint" style="margin-bottom:8px">4 · Jam</div>
        <div id="slots">${skeletons(1)}</div>
      </section>

      <div id="feedback"></div>
      <button class="btn btn-order btn-block" id="book" disabled>Pilih jam dulu</button>
    </div>`,
  );

  root.querySelector('#back').addEventListener('click', () => go(`usaha/${shop.id}`));

  const nodes = {
    services: root.querySelector('#services'),
    staff: root.querySelector('#staff'),
    days: root.querySelector('#days'),
    slots: root.querySelector('#slots'),
    feedback: root.querySelector('#feedback'),
    book: root.querySelector('#book'),
  };

  const service = () => shop.services.find((s) => s.id === pick.serviceId);

  function paintPickers() {
    nodes.services.innerHTML = shop.services
      .map(
        (s) => `<button class="card card-lift row" data-service="${esc(s.id)}"
          aria-pressed="${s.id === pick.serviceId}"
          style="justify-content:space-between;border:0;cursor:pointer;font:inherit;color:inherit;text-align:left;
                 box-shadow:${s.id === pick.serviceId ? '0 0 0 1px var(--accent)' : 'var(--shadow-sm)'}">
          <span><span>${esc(s.name)}</span><br><span class="faint">${s.durationMinutes} menit</span></span>
          <strong class="nums">${rp(s.price)}</strong>
        </button>`,
      )
      .join('');

    nodes.staff.innerHTML = shop.staff
      .map(
        (s) => `<button class="btn btn-secondary" data-staff="${esc(s.id)}"
          aria-pressed="${s.id === pick.staffId}"
          style="${s.id === pick.staffId ? 'border-color:var(--accent);background:var(--accent-100)' : ''}">
          ${esc(s.name)}</button>`,
      )
      .join('');

    nodes.days.innerHTML = days
      .map(
        (day) => `<button class="btn btn-secondary day-tab" data-day="${day.iso}"
          aria-pressed="${day.iso === pick.date}">
          <span class="dow">${DAY_NAMES[day.at.getDay()].slice(0, 3)}</span>
          <span class="nums">${day.at.getDate()}</span>
        </button>`,
      )
      .join('');
  }

  async function loadSlots() {
    nodes.slots.innerHTML = skeletons(1);
    pick.slot = null;
    updateButton();

    try {
      const result = await get(
        `/shops/${shop.id}/availability${query({
          serviceId: pick.serviceId,
          staffId: pick.staffId,
          date: pick.date,
        })}`,
      );

      if (!result.open) {
        nodes.slots.innerHTML = empty('Tutup pada hari ini.', 'Pilih tanggal lain.');
        return;
      }
      if (result.slots.length === 0) {
        nodes.slots.innerHTML = empty('Tidak ada jam tersisa.', 'Semua sudah terisi atau sudah lewat.');
        return;
      }

      nodes.slots.innerHTML = `<div class="slot-grid">${result.slots
        .map(
          (slot) => `<button class="btn btn-secondary slot" data-slot="${esc(slot.start)}"
            aria-pressed="${slot.start === pick.slot}">${esc(slot.startLocal)}</button>`,
        )
        .join('')}</div>`;
    } catch (error) {
      nodes.slots.innerHTML = errorNotice(error);
    }
  }

  function updateButton() {
    nodes.book.disabled = !pick.slot;
    nodes.book.textContent = pick.slot
      ? `Pesan ${service().name} · ${timeIn(pick.slot, shop.timezone)}`
      : 'Pilih jam dulu';
  }

  root.addEventListener('click', async (event) => {
    const service = event.target.closest('[data-service]');
    if (service) {
      pick.serviceId = service.dataset.service;
      paintPickers();
      return loadSlots();
    }

    const staff = event.target.closest('[data-staff]');
    if (staff) {
      pick.staffId = staff.dataset.staff;
      paintPickers();
      return loadSlots();
    }

    const day = event.target.closest('[data-day]');
    if (day) {
      pick.date = day.dataset.day;
      paintPickers();
      return loadSlots();
    }

    const slot = event.target.closest('[data-slot]');
    if (slot) {
      pick.slot = slot.dataset.slot;
      nodes.slots
        .querySelectorAll('[data-slot]')
        .forEach((node) => node.setAttribute('aria-pressed', String(node.dataset.slot === pick.slot)));
      updateButton();
    }
  });

  nodes.book.addEventListener('click', async () => {
    nodes.book.disabled = true;
    nodes.feedback.innerHTML = '';

    try {
      await post(`/shops/${shop.id}/bookings`, {
        serviceId: pick.serviceId,
        staffId: pick.staffId,
        startTime: pick.slot,
      });
      go('booking-saya');
    } catch (error) {
      // 409 is the double-booking guard doing its job — someone took the slot
      // between this page loading and the button being pressed. Say so plainly
      // and reload the grid rather than leaving a stale, wrong list on screen.
      nodes.feedback.innerHTML =
        error.status === 409
          ? `<div class="notice notice-amber">Jam itu baru saja diambil orang lain. Silakan pilih jam lain — daftar di bawah sudah diperbarui.</div>`
          : errorNotice(error);
      await loadSlots();
    }
  });

  paintPickers();
  await loadSlots();
}

/** The customer's own bookings, across every shop they have used. */
export async function renderMyBookings(root) {
  fill(root, `<div class="page-head"><h1>Booking saya</h1></div><div id="list">${skeletons(3)}</div>`);
  const list = root.querySelector('#list');

  try {
    const page = await get(`/bookings/me${query({ limit: 50 })}`);

    if (page.data.length === 0) {
      list.innerHTML = empty('Belum ada booking.', 'Cari usaha dan pesan jadwal pertamamu.');
      return;
    }

    list.innerHTML = `<div class="stack">${page.data.map(bookingCard).join('')}</div>`;

    list.querySelectorAll('[data-cancel]').forEach((button) => {
      button.addEventListener('click', async () => {
        const sure = await confirmDialog({
          title: 'Batalkan booking ini?',
          body: 'Jamnya langsung dilepas dan bisa diambil orang lain.',
          confirmLabel: 'Batalkan',
          danger: true,
        });
        if (!sure) return;

        button.disabled = true;
        try {
          await patch(`/bookings/${button.dataset.cancel}/cancel`);
          renderMyBookings(root);
        } catch (error) {
          list.prepend(Object.assign(document.createElement('div'), {
            innerHTML: errorNotice(error),
          }));
          button.disabled = false;
        }
      });
    });

    list.querySelectorAll('[data-queue]').forEach((button) => {
      button.addEventListener('click', () => go(`antrian/${button.dataset.queue}`));
    });
  } catch (error) {
    list.innerHTML = errorNotice(error);
  }
}

const bookingCard = (booking) => {
  const cancellable = ['BOOKED', 'WAITING'].includes(booking.status);

  return `<div class="card stack">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div>
        <strong>${esc(booking.serviceName)}</strong>
        <div class="faint">${esc(booking.shopName)} · ${esc(booking.staffName)}</div>
      </div>
      ${statusTag(booking.status)}
    </div>
    <div class="row" style="justify-content:space-between">
      <span class="nums">
        ${esc(dateIn(booking.startTime, booking.shopTimezone))} ·
        ${esc(timeIn(booking.startTime, booking.shopTimezone))}
        <span class="faint">(${booking.durationMinutes} mnt · ${rp(booking.price)})</span>
      </span>
      <span class="row" style="gap:6px">
        <button class="btn btn-secondary btn-sm" data-queue="${esc(booking.shopId)}">Antrian</button>
        ${cancellable ? `<button class="btn btn-danger btn-sm" data-cancel="${esc(booking.id)}">Batalkan</button>` : ''}
      </span>
    </div>
  </div>`;
};
