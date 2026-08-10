# PRD — MauApa? (Sistem Booking & Antrian Layanan UMKM)

> Product Requirements Document. Blueprint utama proyek. Serahkan ke Claude Code
> sebagai konteks. Nama "MauApa?" sementara — ganti sesukamu. Vertikal utama:
> barbershop/salon (dirancang agar bisa diperluas ke bengkel/laundry).

---

## 1. Ringkasan

MauApa? adalah **API backend** untuk usaha jasa kecil (barbershop, salon, dan lainnya)
agar bisa menerima booking online dan mengelola antrian, menggantikan cara manual
lewat WhatsApp. Pelanggan memesan layanan pada kapster & jam tertentu; sistem
menjamin tidak ada bentrok, menampilkan antrian real-time, dan memberi pemilik
dashboard operasional.

**Fokus proyek ini adalah kualitas BACKEND-nya, bukan tampilan.** Frontend cukup
minimal atau bahkan hanya Swagger UI. Yang dinilai: desain API, konkurensi,
keamanan multi-tenant, testing, dan deployment.

---

## 2. Target pengguna

- **Pemilik usaha (owner):** mengelola usaha, layanan, kapster, jam operasional,
  dan memantau semua booking.
- **Kapster/staff:** melihat jadwalnya dan mengubah status pengerjaan.
- **Pelanggan:** melihat slot tersedia, memesan, dan melihat posisi antrian.

---

## 3. Fitur MVP

- **a. Auth + peran** — register/login; peran owner / staff / customer (RBAC).
- **b. Kelola usaha** — owner membuat profil usaha (multi-tenant).
- **c. Kelola layanan** — nama, durasi (menit), harga.
- **d. Kelola kapster & jam operasional** — daftar staff + jam buka per hari.
- **e. Lihat slot tersedia** — dihitung dari jam operasional + durasi layanan +
  booking yang sudah ada.
- **f. Buat booking (fitur bintang)** — pesan layanan + kapster + waktu, dengan
  **pencegahan double-booking yang aman-konkurensi**.
- **g. Antrian real-time** — status booking (menunggu -> dikerjakan -> selesai)
  terupdate live via WebSocket; pelanggan lihat posisinya.
- **h. Dashboard operasional owner** — jadwal hari ini, ubah status, riwayat.

---

## 4. Alur pengguna (happy path)

1. Owner register -> buat usaha -> tambah layanan, kapster, jam operasional.
2. Pelanggan register/login -> pilih usaha -> pilih layanan + kapster -> lihat
   slot kosong -> buat booking.
3. Sistem memvalidasi slot masih kosong (transaksi) -> booking dibuat, atau
   ditolak jika keburu terisi.
4. Pelanggan melihat nomor/posisi antrian yang terupdate real-time.
5. Kapster/owner mengubah status (menunggu -> dikerjakan -> selesai); update
   tampil real-time ke pelanggan.

---

## 5. Model data (tabel)

Database: **PostgreSQL** (mendukung transaksi & constraint anti-overlap).

- **users** — id, email, password_hash, role (owner/staff/customer), created_at
- **shops** — id, owner_id, name, address, timezone, created_at
- **services** — id, shop_id, name, duration_minutes, price, active
- **staff** — id, shop_id, name, user_id (nullable), active
- **working_hours** — id, shop_id, day_of_week, open_time, close_time
- **bookings** — id, shop_id, service_id, staff_id, customer_id, start_time,
  end_time, status (booked/waiting/in_progress/done/cancelled), created_at

**Aturan konkurensi (fitur bintang):** cegah dua booking untuk staff_id yang
sama dengan rentang [start_time, end_time) yang tumpang tindih. Pendekatan yang
disarankan: PostgreSQL EXCLUDE constraint dengan tstzrange + GiST, atau transaksi
dengan pengecekan + row locking (SELECT ... FOR UPDATE). Ini WAJIB punya tes yang
mensimulasikan dua permintaan bersamaan.

**Aturan multi-tenant:** setiap query difilter berdasarkan shop_id, dan
kepemilikan diverifikasi (owner A tidak bisa menyentuh data usaha owner B).

---

## 6. Tech stack

- **Framework:** NestJS (TypeScript) — terstruktur, disukai industri
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Cache & real-time pub/sub:** Redis
- **Auth:** JWT (access + refresh token) + RBAC
- **Real-time:** Socket.IO (WebSocket) — antrian live
- **Dokumentasi:** Swagger/OpenAPI (otomatis)
- **Testing:** Jest (unit + integration)
- **Deploy:** Docker + Railway/Render + CI/CD (GitHub Actions)

---

## 7. Fitur yang menonjolkan skill backend (INTI penilaian)

- Desain skema relasional sendiri dengan relasi & constraint.
- **Pencegahan double-booking aman-konkurensi** (transaksi + constraint) — bintang.
- **Multi-tenant** dengan isolasi data antar-usaha.
- Logika perhitungan slot tersedia (jam operasional + durasi + booking existing).
- **Antrian real-time** via WebSocket.
- Auth JWT + RBAC (owner/staff/customer).
- Validasi input, pagination, filtering, error handling terstruktur.
- Rate limiting (Redis).
- Automated tests (termasuk skenario konkurensi) + dokumentasi OpenAPI.
- Docker + CI/CD.

---

## 8. Non-goals (TIDAK dibangun di MVP)

- Frontend cantik (cukup minimal / Swagger UI).
- Pembayaran online (booking cukup sampai konfirmasi).
- Aplikasi mobile native.
- Multi-cabang per usaha (satu usaha = satu lokasi dulu).
- Notifikasi WhatsApp/email (boleh menyusul, bukan MVP).

---

## 9. Catatan pembeda (baca ini)

Booking barbershop adalah proyek yang umum. Yang membuat versimu menonjol BUKAN
idenya, melainkan **kedalaman engineering**: konkurensi yang benar, multi-tenant,
real-time, testing, dan deployment production-grade. Di README, tonjolkan secara
eksplisit bagaimana kamu mencegah double-booking dan bagaimana kamu mengujinya —
itu bagian yang paling dilirik untuk peran backend.

---

## 10. Kriteria sukses (MVP selesai jika)

- Dua booking bersamaan ke kapster & waktu yang sama -> satu sukses, satu ditolak
  (terbukti lewat tes).
- Data antar-usaha terisolasi (terverifikasi).
- Slot tersedia dihitung benar dari jam operasional + booking existing.
- Antrian terupdate real-time saat status berubah.
- Ter-deploy di URL publik dengan Swagger yang bisa dicoba.
- Ada tes (termasuk skenario konkurensi) + README studi kasus + diagram arsitektur.
