# plan.md — Rencana Build MauApa?

Urutan pengerjaan per fase. **Kerjakan satu fase sampai selesai dan teruji, baru
lanjut.** Tiap fase adalah irisan vertikal (dari database sampai endpoint yang
bisa dites di Swagger).

Cara pakai dengan Claude Code: buka satu fase, minta Claude Code menulis
rencananya dulu, konfirmasi, baru eksekusi. Selesai satu fase -> commit -> fase
berikutnya.

---

## Fase 0 — Setup

**Tujuan:** proyek kosong yang jalan.
- Inisialisasi NestJS + TypeScript.
- Docker Compose untuk PostgreSQL + Redis lokal.
- Prisma terhubung ke Postgres; struktur folder per modul.
- Swagger aktif; `.env.example`.

**Selesai jika:** `npm run start:dev` jalan, Swagger UI terbuka tanpa error.

---

## Fase 1 — Auth + peran (RBAC)

**Tujuan:** register/login dengan peran.
- Tabel `users`; register/login; hash password; JWT access + refresh.
- Guard RBAC: owner / staff / customer.

**Selesai jika:** endpoint terproteksi menolak tanpa token dan menghormati peran.

---

## Fase 2 — Usaha + layanan + kapster + jam operasional (multi-tenant)

**Tujuan:** owner bisa menyiapkan usahanya.
- Tabel `shops`, `services`, `staff`, `working_hours`.
- CRUD (khusus owner) dengan **scoping `shop_id`** dan verifikasi kepemilikan.

**Selesai jika:** owner A tidak bisa membaca/mengubah data usaha owner B (uji ini).

---

## Fase 3 — Lihat slot tersedia

**Tujuan:** hitung slot kosong.
- Endpoint: diberi usaha + layanan + kapster + tanggal -> daftar slot kosong,
  dihitung dari jam operasional + durasi layanan + booking yang sudah ada.

**Selesai jika:** slot yang sudah dibooking tidak muncul sebagai tersedia.

---

## Fase 4 — Buat booking (JANTUNG proyek)

**Tujuan:** booking aman dari double-booking.
- Tabel `bookings`.
- Buat booking dengan **pencegahan overlap aman-konkurensi**: EXCLUDE constraint
  (tstzrange + GiST) ATAU transaksi + row locking.
- **Tulis tes integrasi** yang menembakkan dua permintaan booking bersamaan ke
  kapster & waktu yang sama, lalu memastikan tepat satu sukses.

**Selesai jika:** tes konkurensi lulus (satu sukses, satu ditolak).

---

## Fase 5 — Antrian real-time

**Tujuan:** status live.
- Status booking: waiting -> in_progress -> done -> (cancelled).
- Socket.IO: room per usaha; broadcast perubahan status.
- Pelanggan bisa melihat posisi antriannya terupdate real-time.

**Selesai jika:** mengubah status di satu klien langsung tercermin di klien lain
tanpa refresh.

---

## Fase 6 — Pengaman produksi + testing + dokumentasi

**Tujuan:** kualitas production-grade.
- Rate limiting (Redis) pada auth & booking.
- Validasi menyeluruh, pagination, filtering, error handling konsisten.
- Coverage tes yang layak (unit + e2e), termasuk skenario konkurensi.
- Swagger lengkap terdokumentasi.

**Selesai jika:** `npm run test` hijau dan Swagger mendokumentasikan semua endpoint.

---

## Fase 7 — Deploy

**Tujuan:** bisa dicoba publik.
- Dockerfile + deploy ke Railway/Render (Postgres + Redis terkelola).
- CI/CD (GitHub Actions): lint + test + build otomatis.
- README studi kasus: masalah -> solusi -> diagram arsitektur -> **penjelasan cara
  pencegahan double-booking & cara pengujiannya** -> link Swagger publik.

**Selesai jika:** ada URL Swagger publik yang berfungsi + README lengkap.

---

## Prinsip lintas-fase

- Satu fitur utuh dulu (DB -> logika -> endpoint), baru fitur berikut.
- Commit tiap fase selesai.
- Untuk logika booking & konkurensi, minta Claude Code "buktikan ini aman lewat
  tes" sebelum menerima kodenya.
