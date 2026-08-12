import { publicApi, query } from '../api.js';
import { go } from '../store.js';
import { empty, errorNotice, esc, fill, icon, rp, skeletons } from '../ui.js';
import { DAY_NAMES } from '../ui.js';

/** The shop directory — the first screen a customer sees, and the only one
 *  that works without an account. */
export async function renderDirectory(root, route) {
  const term = route.query.q ?? '';

  fill(
    root,
    `<div class="page-head">
      <h1>Cari usaha</h1>
      <span class="faint">Terbuka tanpa akun</span>
    </div>
    <form class="row" id="search" style="margin-bottom:18px">
      <input class="input" id="q" placeholder="Nama usaha atau alamat…" value="${esc(term)}"
        style="flex:1;min-width:200px" />
      <button class="btn btn-primary" type="submit">${icon('ph-magnifying-glass')} Cari</button>
    </form>
    <div id="results">${skeletons(3)}</div>`,
  );

  root.querySelector('#search').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = root.querySelector('#q').value.trim();
    go(`cari${value ? `?q=${encodeURIComponent(value)}` : ''}`);
  });

  const results = root.querySelector('#results');

  try {
    const page = await publicApi(`/public/shops${query({ q: term, limit: 24 })}`);

    if (page.data.length === 0) {
      results.innerHTML = empty(
        term ? `Tidak ada usaha yang cocok dengan “${term}”.` : 'Belum ada usaha terdaftar.',
        'Coba kata kunci lain, atau daftarkan usahamu sendiri.',
      );
      return;
    }

    results.innerHTML = `<div class="grid">${page.data.map(shopCard).join('')}</div>
      <p class="faint" style="margin-top:14px">${page.meta.total} usaha ditemukan</p>`;

    results.querySelectorAll('[data-shop]').forEach((card) => {
      card.addEventListener('click', () => go(`usaha/${card.dataset.shop}`));
    });
  } catch (error) {
    results.innerHTML = errorNotice(error);
  }
}

const shopCard = (shop) => `
  <button class="card card-lift stack" data-shop="${esc(shop.id)}"
    style="text-align:left;border:0;cursor:pointer;font:inherit;color:inherit">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <strong style="font-size:16px">${esc(shop.name)}</strong>
      <span class="tag ${shop.openNow ? 'tag-accent' : 'tag-neutral'}">
        ${shop.openNow ? 'Buka' : 'Tutup'}
      </span>
    </div>
    <div class="faint">${esc(shop.address)}</div>
    <div class="faint">${shop.serviceCount} layanan · ${shop.staffCount} kapster</div>
  </button>`;

/** One shop: what it sells, who works there, when it opens. */
export async function renderShop(root, route) {
  const shopId = route.params[0];
  fill(root, skeletons(4));

  let shop;
  try {
    shop = await publicApi(`/public/shops/${shopId}`);
  } catch (error) {
    fill(root, errorNotice(error));
    return;
  }

  const bookable = shop.services.length > 0 && shop.staff.length > 0;

  fill(
    root,
    `<button class="btn btn-ghost" id="back" style="margin-bottom:10px">${icon('ph-arrow-left')} Semua usaha</button>
    <div class="page-head">
      <div>
        <h1>${esc(shop.name)}</h1>
        <div class="faint">${esc(shop.address)} · ${esc(shop.timezone)}</div>
      </div>
      <span class="tag ${shop.openNow ? 'tag-accent' : 'tag-neutral'}">
        ${shop.openNow ? 'Sedang buka' : 'Sedang tutup'}
      </span>
    </div>

    ${
      bookable
        ? ''
        : `<div class="notice notice-amber" style="margin-bottom:16px">
             Usaha ini belum menyiapkan layanan atau kapster, jadi belum bisa menerima booking.
           </div>`
    }

    <h2 style="font-size:17px;margin-bottom:10px">Layanan</h2>
    <div class="stack" style="margin-bottom:24px">
      ${
        shop.services.length
          ? shop.services.map(serviceRow).join('')
          : empty('Belum ada layanan.')
      }
    </div>

    <h2 style="font-size:17px;margin-bottom:10px">Kapster</h2>
    <div class="row" style="margin-bottom:24px">
      ${shop.staff.map((s) => `<span class="tag tag-neutral">${esc(s.name)}</span>`).join('') || '<span class="faint">Belum ada kapster.</span>'}
    </div>

    <h2 style="font-size:17px;margin-bottom:10px">Jam buka</h2>
    <div class="card">
      <table>
        <tbody>
          ${DAY_NAMES.map((day, index) => {
            const row = shop.workingHours.find((h) => h.dayOfWeek === index);
            return `<tr>
              <td style="width:120px">${day}</td>
              <td class="${row ? 'nums' : 'faint'}">${row ? `${row.open} – ${row.close}` : 'Tutup'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="row" style="margin-top:20px">
      <button class="btn btn-order" id="book" ${bookable ? '' : 'disabled'}>
        Pilih jadwal ${icon('ph-arrow-right')}
      </button>
      <button class="btn btn-secondary" id="queue">${icon('ph-users-three')} Lihat antrian</button>
    </div>`,
  );

  root.querySelector('#back').addEventListener('click', () => go('cari'));
  root.querySelector('#queue').addEventListener('click', () => go(`antrian/${shop.id}`));
  root.querySelector('#book').addEventListener('click', () => go(`jadwal/${shop.id}`));
}

const serviceRow = (service) => `
  <div class="card row" style="justify-content:space-between">
    <div>
      <div>${esc(service.name)}</div>
      <div class="faint">${service.durationMinutes} menit</div>
    </div>
    <strong class="nums">${rp(service.price)}</strong>
  </div>`;
