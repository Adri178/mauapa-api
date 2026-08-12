import { del, get, patch, post, put, query } from '../api.js';
import { go, session } from '../store.js';
import {
  DAY_NAMES, confirmDialog, empty, errorNotice, esc, fill, flash, icon, rp, skeletons,
} from '../ui.js';

const requireShop = (root) => {
  if (session.shop) return true;
  fill(root, empty('Belum ada usaha.', 'Buat usahamu dulu di Pengaturan.'));
  return false;
};

/* ── services ─────────────────────────────────────────────────────────── */

export async function renderServices(root) {
  if (!requireShop(root)) return;
  const shop = session.shop;

  fill(
    root,
    `<div class="page-head">
      <h1>Layanan</h1>
      <button class="btn btn-order" id="add">${icon('ph-plus')} Tambah layanan</button>
    </div>
    <div id="form"></div>
    <div id="feedback"></div>
    <div id="list">${skeletons(3)}</div>`,
  );

  const nodes = {
    form: root.querySelector('#form'),
    list: root.querySelector('#list'),
    feedback: root.querySelector('#feedback'),
  };

  const reload = async () => {
    try {
      const services = await get(`/shops/${shop.id}/services${query({ includeInactive: true })}`);
      nodes.list.innerHTML = services.length
        ? `<div class="stack">${services.map(serviceRow).join('')}</div>`
        : empty('Belum ada layanan.', 'Tambahkan minimal satu supaya slot bisa dihitung.');
    } catch (error) {
      nodes.list.innerHTML = errorNotice(error);
    }
  };

  root.querySelector('#add').addEventListener('click', () => {
    nodes.form.innerHTML = `
      <form class="card stack" id="new" style="margin-bottom:16px">
        <div class="row" style="gap:12px">
          <div class="field" style="flex:2;min-width:180px">
            <label for="nm">Nama layanan</label>
            <input class="input" id="nm" required maxlength="120" />
          </div>
          <div class="field" style="flex:1;min-width:110px">
            <label for="dur">Durasi (menit)</label>
            <input class="input" id="dur" type="number" value="30" min="5" max="480" required />
          </div>
          <div class="field" style="flex:1;min-width:120px">
            <label for="prc">Harga (Rp)</label>
            <input class="input" id="prc" type="number" value="35000" min="0" required />
          </div>
        </div>
        <div class="row">
          <button class="btn btn-primary" type="submit">Simpan</button>
          <button class="btn btn-ghost" type="button" id="cancel">Batal</button>
        </div>
      </form>`;

    nodes.form.querySelector('#cancel').addEventListener('click', () => (nodes.form.innerHTML = ''));
    nodes.form.querySelector('#new').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await post(`/shops/${shop.id}/services`, {
          name: nodes.form.querySelector('#nm').value.trim(),
          durationMinutes: Number(nodes.form.querySelector('#dur').value),
          price: Number(nodes.form.querySelector('#prc').value),
        });
        nodes.form.innerHTML = '';
        flash(nodes.feedback, 'Layanan ditambahkan.');
        await reload();
      } catch (error) {
        nodes.feedback.innerHTML = errorNotice(error);
      }
    });
  });

  nodes.list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-deactivate]');
    if (!button) return;

    const sure = await confirmDialog({
      title: 'Nonaktifkan layanan ini?',
      body: 'Layanan berhenti ditawarkan, tapi booking yang sudah ada tetap utuh.',
      confirmLabel: 'Nonaktifkan',
      danger: true,
    });
    if (!sure) return;

    try {
      await del(`/shops/${shop.id}/services/${button.dataset.deactivate}`);
      await reload();
    } catch (error) {
      nodes.feedback.innerHTML = errorNotice(error);
    }
  });

  await reload();
}

const serviceRow = (service) => `
  <div class="card row ${service.active ? '' : 'inactive'}" style="justify-content:space-between">
    <div>
      <div>${esc(service.name)} ${service.active ? '' : '<span class="tag tag-neutral">nonaktif</span>'}</div>
      <div class="faint">${service.durationMinutes} menit · ${rp(service.price)}</div>
    </div>
    ${
      service.active
        ? `<button class="btn btn-danger btn-sm" data-deactivate="${esc(service.id)}">Nonaktifkan</button>`
        : ''
    }
  </div>`;

/* ── staff ────────────────────────────────────────────────────────────── */

export async function renderStaff(root) {
  if (!requireShop(root)) return;
  const shop = session.shop;

  fill(
    root,
    `<div class="page-head">
      <h1>Kapster</h1>
      <button class="btn btn-order" id="add">${icon('ph-plus')} Tambah kapster</button>
    </div>
    <div id="form"></div>
    <div id="feedback"></div>
    <div id="list">${skeletons(2)}</div>`,
  );

  const nodes = {
    form: root.querySelector('#form'),
    list: root.querySelector('#list'),
    feedback: root.querySelector('#feedback'),
  };

  const reload = async () => {
    try {
      const staff = await get(`/shops/${shop.id}/staff${query({ includeInactive: true })}`);
      nodes.list.innerHTML = staff.length
        ? `<div class="stack">${staff.map(staffRow).join('')}</div>`
        : empty('Belum ada kapster.', 'Slot tidak bisa dihitung tanpa kapster.');
    } catch (error) {
      nodes.list.innerHTML = errorNotice(error);
    }
  };

  root.querySelector('#add').addEventListener('click', () => {
    nodes.form.innerHTML = `
      <form class="card stack" id="new" style="margin-bottom:16px">
        <div class="field"><label for="nm">Nama</label>
          <input class="input" id="nm" required minlength="2" maxlength="100" /></div>
        <p class="faint">
          Isi email dan password kalau kapster ini perlu akun sendiri untuk menaikkan status.
          Kosongkan kalau dia hanya perlu dijadwalkan.
        </p>
        <div class="row" style="gap:12px">
          <div class="field" style="flex:1;min-width:180px">
            <label for="em">Email (opsional)</label>
            <input class="input" id="em" type="email" autocomplete="off" /></div>
          <div class="field" style="flex:1;min-width:150px">
            <label for="pw">Password</label>
            <input class="input" id="pw" type="password" autocomplete="new-password" minlength="8" /></div>
        </div>
        <div class="row">
          <button class="btn btn-primary" type="submit">Simpan</button>
          <button class="btn btn-ghost" type="button" id="cancel">Batal</button>
        </div>
      </form>`;

    nodes.form.querySelector('#cancel').addEventListener('click', () => (nodes.form.innerHTML = ''));
    nodes.form.querySelector('#new').addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = nodes.form.querySelector('#em').value.trim();
      const password = nodes.form.querySelector('#pw').value;

      try {
        await post(`/shops/${shop.id}/staff`, {
          name: nodes.form.querySelector('#nm').value.trim(),
          ...(email ? { email, password } : {}),
        });
        nodes.form.innerHTML = '';
        flash(nodes.feedback, email ? 'Kapster dan akunnya dibuat.' : 'Kapster ditambahkan.');
        await reload();
      } catch (error) {
        nodes.feedback.innerHTML = errorNotice(error);
      }
    });
  });

  nodes.list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-deactivate]');
    if (!button) return;

    const sure = await confirmDialog({
      title: 'Nonaktifkan kapster ini?',
      body: 'Dia berhenti muncul di pilihan pelanggan; jadwal yang sudah ada tetap utuh.',
      confirmLabel: 'Nonaktifkan',
      danger: true,
    });
    if (!sure) return;

    try {
      await del(`/shops/${shop.id}/staff/${button.dataset.deactivate}`);
      await reload();
    } catch (error) {
      nodes.feedback.innerHTML = errorNotice(error);
    }
  });

  await reload();
}

const staffRow = (member) => `
  <div class="card row ${member.active ? '' : 'inactive'}" style="justify-content:space-between">
    <div>
      <div>${esc(member.name)} ${member.active ? '' : '<span class="tag tag-neutral">nonaktif</span>'}</div>
      <div class="faint">${member.userId ? 'Punya akun sendiri' : 'Tanpa akun — hanya dijadwalkan'}</div>
    </div>
    ${
      member.active
        ? `<button class="btn btn-danger btn-sm" data-deactivate="${esc(member.id)}">Nonaktifkan</button>`
        : ''
    }
  </div>`;

/* ── working hours ────────────────────────────────────────────────────── */

/**
 * The whole week is saved in one PUT, mirroring the API: days left unticked are
 * simply absent from the payload, and absent means closed.
 */
export async function renderHours(root) {
  if (!requireShop(root)) return;
  const shop = session.shop;

  fill(root, `<div class="page-head"><h1>Jam operasional</h1></div><div id="body">${skeletons(3)}</div>`);
  const body = root.querySelector('#body');

  let current = [];
  try {
    current = await get(`/shops/${shop.id}/working-hours`);
  } catch (error) {
    body.innerHTML = errorNotice(error);
    return;
  }

  body.innerHTML = `
    <form class="card stack" id="form">
      ${DAY_NAMES.map((day, index) => {
        const row = current.find((h) => h.dayOfWeek === index);
        return `<div class="row" style="gap:12px">
          <label class="row" style="flex:1;min-width:150px;gap:8px">
            <input type="checkbox" data-day="${index}" ${row ? 'checked' : ''} />
            <span>${day}</span>
          </label>
          <input class="input" type="time" data-open="${index}" value="${row?.open ?? '09:00'}"
            style="max-width:130px" ${row ? '' : 'disabled'} />
          <span class="faint">sampai</span>
          <input class="input" type="time" data-close="${index}" value="${row?.close ?? '20:00'}"
            style="max-width:130px" ${row ? '' : 'disabled'} />
        </div>`;
      }).join('')}
      <div class="row"><button class="btn btn-primary" type="submit">Simpan jam buka</button></div>
    </form>
    <div id="feedback" style="margin-top:12px"></div>`;

  const feedback = root.querySelector('#feedback');

  body.addEventListener('change', (event) => {
    const box = event.target.closest('[data-day]');
    if (!box) return;
    const index = box.dataset.day;
    body.querySelector(`[data-open="${index}"]`).disabled = !box.checked;
    body.querySelector(`[data-close="${index}"]`).disabled = !box.checked;
  });

  root.querySelector('#form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const hours = DAY_NAMES.map((_, index) => index)
      .filter((index) => body.querySelector(`[data-day="${index}"]`).checked)
      .map((index) => ({
        dayOfWeek: index,
        open: body.querySelector(`[data-open="${index}"]`).value,
        close: body.querySelector(`[data-close="${index}"]`).value,
      }));

    try {
      await put(`/shops/${shop.id}/working-hours`, { hours });
      flash(feedback, 'Jam buka disimpan.');
    } catch (error) {
      feedback.innerHTML = errorNotice(error);
    }
  });
}

/* ── shop settings ────────────────────────────────────────────────────── */

export async function renderSettings(root) {
  const shop = session.shop;

  fill(
    root,
    `<div class="page-head"><h1>${shop ? 'Pengaturan usaha' : 'Buat usaha'}</h1></div>
    <form class="card stack" id="form" style="max-width:520px">
      <div class="field"><label for="nm">Nama usaha</label>
        <input class="input" id="nm" required minlength="2" value="${esc(shop?.name ?? '')}" /></div>
      <div class="field"><label for="ad">Alamat</label>
        <input class="input" id="ad" required value="${esc(shop?.address ?? '')}" /></div>
      <div class="field"><label for="tz">Zona waktu</label>
        <input class="input" id="tz" required value="${esc(shop?.timezone ?? 'Asia/Jakarta')}" />
        <span class="faint">Zona IANA, misalnya Asia/Jakarta atau Asia/Makassar.</span></div>
      <div class="row"><button class="btn btn-primary" type="submit">
        ${shop ? 'Simpan perubahan' : 'Buat usaha'}</button></div>
    </form>
    <div id="feedback" style="margin-top:12px"></div>

    ${
      shop
        ? `<div class="card stack" style="max-width:520px;margin-top:18px">
             <strong>Link untuk pelanggan</strong>
             <p class="faint">Bagikan ini supaya pelanggan bisa memesan langsung.</p>
             <code class="mono" style="word-break:break-all">${esc(location.origin)}/app#/usaha/${esc(shop.id)}</code>
           </div>`
        : ''
    }`,
  );

  const feedback = root.querySelector('#feedback');

  root.querySelector('#form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      name: root.querySelector('#nm').value.trim(),
      address: root.querySelector('#ad').value.trim(),
      timezone: root.querySelector('#tz').value.trim(),
    };

    try {
      session.shop = shop
        ? await patch(`/shops/${shop.id}`, payload)
        : await post('/shops', payload);

      if (shop) {
        flash(feedback, 'Perubahan disimpan.');
      } else {
        go('papan');
      }
    } catch (error) {
      feedback.innerHTML = errorNotice(error);
    }
  });
}
