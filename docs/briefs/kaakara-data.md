# Arahan Tugas untuk kaakara (Data dan Penyimpanan)

Kamu mengerjakan lapisan data RenewableX, di bawah arahan manager proyek. Baca seluruh dokumen ini dan `docs/TEAM.md` sebelum mulai.

## Konteks singkat
RenewableX adalah alat screening kelayakan proyek PV (surya). Mesin FastAPI di `services/calculation-engine/` menghitung energi, NPV, IRR, dan payback dari asumsi pengguna. Kontraknya ada di `docs/api.md`, dengan contoh di `examples/`. Saat ini hanya mode `manual_specific_yield` yang jalan. Mode `location_based` mengembalikan 422 sampai ada penyedia data sumber daya surya, dan itulah tugasmu.

## Wilayah kamu
- `supabase/` (hanya berkas migrasi baru)
- `services/calculation-engine/app/providers/` dan `services/calculation-engine/tests/providers/` (folder baru)
- `docs/database-schema.md` dan `docs/providers.md`

Jangan ubah sisa folder mesin, `docs/api.md`, `apps/web/`, atau `.github/`. Penyambungan penyedia ke endpoint adalah tugas Val (V4), setelah manager menyetujui hasilmu.

## Aturan khusus
- Jangan pernah mengedit `supabase/migrations/0001_initial_schema.sql`. Perubahan selalu lewat migrasi baru bernomor berikutnya.
- Rahasia (kunci Supabase, kunci API) tidak pernah masuk repo. Kunci `service_role` hanya boleh dipakai di server, tidak pernah di kode web.
- CI tidak boleh memanggil layanan luar sungguhan. Tes memakai respons rekaman atau tiruan.
- Fakta tentang layanan luar (parameter API, cakupan wilayah, batas pemakaian, lisensi data) harus kamu baca dari dokumentasi resminya sekarang. Catat tautan dan tanggal bacanya di `docs/providers.md`. Jangan menebak.

## Tugas (kerjakan berurutan, satu Pull Request per tugas)

### D1. Selaraskan skema database dengan kontrak API
Skema awal dibuat sebelum mesin versi 0.2.0. Satu ketidakcocokan sudah diketahui: kolom `technical_inputs.yield_boundary` di migrasi 0001 memakai nilai `gross_before_losses`, sedangkan API memakai `gross_pre_loss`. **API yang benar.**
- Bandingkan semua kolom di 0001 dengan `docs/api.md` dan `examples/sample-pv-project.json`. Daftarkan setiap perbedaan, termasuk batas nilai (contoh: API menolak `performance_loss_fraction` = 1, skema mengizinkannya).
- Tulis `supabase/migrations/0002_align_with_api_v0_2.sql` yang memperbaiki perbedaan itu tanpa merusak data yang mungkin sudah ada (ubah nilai lama sebelum mengganti batasan).
- Periksa Row Level Security: tiap tabel di skema harus punya kebijakan yang membatasi pengguna hanya ke barisnya sendiri. Tulis hasil pemeriksaan per tabel di `docs/database-schema.md`.
- Selesai bila: daftar perbedaan dan keputusan tiap item ada di laporan, migrasi 0002 bisa dijalankan di atas 0001, dan `docs/database-schema.md` sesuai kenyataan.

### D2. Antarmuka penyedia data lokasi (S1-03)
Lihat S1-03 di `docs/SPRINT-1-issues.md` dan bagian energi di `docs/calculation-methodology.md`.
- `app/providers/base.py`: antarmuka `ResourceProvider` yang menerima lintang, bujur, kemiringan, dan azimuth, lalu mengembalikan hasil bertipe berisi `specific_yield_kwh_per_kwp_year`, `yield_boundary` (nilai dari API: `net_ac_at_delivery` atau `gross_pre_loss`), serta metadata asal data: penyedia, dataset, versi dataset, periode, waktu pengambilan. Metadata ini harus bisa dipetakan ke kolom `resource_*` di tabel `technical_inputs`.
- Kesalahan bertipe, bukan teks mentah: layanan tidak tersedia, di luar cakupan, respons tidak valid, batas waktu.
- `app/providers/manual.py`: penyedia sederhana yang meneruskan nilai dari pengguna.
- `app/providers/pvgis.py`: adapter untuk PVGIS (JRC, Komisi Eropa). Baca dokumentasi resminya yang sekarang dulu: versi API, parameter, cakupan wilayah (cek apakah Indonesia tercakup), arti nilai energi tahunan yang dikembalikan, dan ketentuan pemakaian. Tentukan dengan jujur batas yield yang dihasilkannya (apakah sudah dikurangi loss sistem) dan tulis di `docs/providers.md`. Beri batas waktu, jumlah percobaan ulang terbatas, dan cache dalam memori dengan masa berlaku.
- Gunakan `httpx` (sudah ada di `requirements.txt`). Dependensi lain hanya bila perlu, dengan alasan di laporan.
- Tes di `tests/providers/` memakai respons rekaman atau tiruan, mencakup keberhasilan, di luar cakupan, batas waktu, dan respons rusak.
- Jangan mengubah `app/api/pv.py` atau `app/models/schemas.py`. Laporan harus menyebut persis apa yang Val perlu sambungkan.
- Selesai bila: semua tes hijau, `docs/providers.md` memuat sumber, versi, tanggal baca, batas yield, dan keterbatasan, dan `pytest` di `services/calculation-engine` lolos.

### D3. Usulan penyimpanan proyek (hanya dokumen, belum kode)
Tulis `docs/persistence-proposal.md`: bagaimana pengguna menyimpan proyek dan hasil hitungnya di Supabase.
- Alur masuk akun, siapa yang menulis ke database (web langsung dengan kebijakan RLS, atau mesin lewat server), dan di mana kunci rahasia dipakai.
- Daftar endpoint atau fungsi yang dibutuhkan, tanpa mengubah kontrak yang ada.
- Risiko dan hal yang belum diputuskan.
- Selesai bila manager menyetujui. Jangan menulis kode untuk ini sebelum disetujui.

## Cara memeriksa pekerjaanmu
```bash
cd services/calculation-engine
pip install -r requirements.txt   # setelah V2 Val digabung: requirements-dev.txt
pytest
```

## Kapan berhenti dan bertanya ke manager
Kontrak API tampak salah atau kurang, kamu perlu mengubah file di luar wilayahmu, atau dokumentasi layanan luar bertentangan dengan asumsi di dokumen ini.
