# Arahan Tugas untuk Val (Engineer Mesin Hitung)

Kamu memegang mesin hitung RenewableX, menggantikan pekerjaan teknis yang sebelumnya dipegang manager. Baca seluruh dokumen ini, `docs/TEAM.md`, dan `docs/HANDOVER-engine.md` sebelum mulai.

## Konteks singkat
RenewableX adalah alat screening kelayakan proyek PV (surya). Mesin FastAPI menghitung energi, NPV, IRR, payback, dan sensitivitas dari asumsi pengguna. Halaman web (One) dan lapisan data (kaakara) bergantung pada kontrak API yang kamu pegang. Karena itu ketepatan angka dan kestabilan kontrak adalah prioritas pertama.

## Wilayah kamu
`services/calculation-engine/` (kecuali `app/providers/` dan `tests/providers/` milik kaakara), `docs/api.md`, `docs/calculation-methodology.md`, `examples/`, dan `.github/`. Jangan ubah `apps/web/`, `supabase/`, atau `docs/TEAM.md` dan `docs/briefs/`.

## Aturan khusus
- **Perubahan kontrak** (field, nilai yang diizinkan, bentuk respons, kode galat) mempengaruhi One dan kaakara. Sebelum mengubahnya, tulis usulan di laporan: isi sebelum dan sesudah di `docs/api.md`, dampak ke web dan data, dan apakah kompatibel mundur. Tunggu persetujuan manager. Perubahan yang kompatibel mundur (menambah field) lebih disukai daripada mengubah atau menghapus.
- Setiap perubahan perilaku disertai tes. Tes yang gagal tidak boleh dihapus atau dilemahkan.
- Naikkan versi mesin dan metodologi sesuai aturan di `docs/HANDOVER-engine.md`, perbarui `docs/api.md` dan `examples/`, dan jalankan ulang contoh respons.
- Tidak ada angka karangan. Nilai contoh selalu berlabel ilustratif.
- Fakta tentang layanan luar (Render, PVGIS, pustaka) dibaca dari dokumentasi resminya sekarang, dengan tautan dan tanggal baca di laporan. Jangan menebak.
- Pengaturan di Render atau Vercel hanya bisa diubah pemilik proyek. Tulis permintaannya jelas di laporan.

## Tugas (berurutan, satu Pull Request per tugas)

### V1. Pemeriksaan serah terima (hanya laporan)
- Jalankan `pytest` di `services/calculation-engine`. Lampirkan baris ringkasan hasilnya.
- Baca kode dan dokumen, lalu cocokkan: apakah `docs/api.md` sama dengan `schemas.py`, apakah contoh di `examples/` sama dengan keluaran sebenarnya, apakah keputusan di `HANDOVER-engine.md` benar-benar tercermin di kode.
- Daftarkan temuan (perbedaan, risiko, hal yang membingungkan) dengan tingkat keparahannya. **Jangan memperbaiki apa pun di tugas ini**, kecuali salah ketik di dokumen.
- Selesai bila: laporan temuan diterima manager.

### V2. Pengerasan untuk produksi
- Pisahkan dependensi: `requirements.txt` hanya untuk menjalankan layanan, `requirements-dev.txt` untuk tes (pytest, httpx, numpy-financial). Perbarui `.github/workflows/ci.yml` supaya menginstal keduanya. Build Command Render (`pip install -r requirements.txt`) tidak perlu berubah.
- Kunci versi Python. Baca dokumentasi Render yang sekarang untuk cara yang benar, dan sebut langkah yang harus dilakukan pemilik proyek, bila ada.
- Batasi ukuran badan permintaan ke angka yang masuk akal dan kembalikan galat 413 yang jelas. Tambahkan tesnya.
- Log permintaan terstruktur tanpa isi badan permintaan (asumsi pengguna bisa sensitif secara bisnis). Cukup metode, jalur, status, durasi, dan versi mesin.
- Selesai bila: tes hijau, CI hijau, `/health` setelah pemasangan tetap normal, dan laporan menyebut tiap langkah serta cara mengujinya.

### V3. Kelengkapan tes metodologi (S1-06)
- Bandingkan kasus uji di `docs/calculation-methodology.md` dan kriteria S1-06 di `docs/SPRINT-1-issues.md` dengan tes yang ada. Tulis tes untuk setiap kasus yang belum tercakup.
- Tambahkan tes sifat: tarif lebih tinggi menaikkan NPV, CAPEX lebih tinggi menurunkannya, degradasi 0 membuat energi tiap tahun sama, umur 1 tahun menghasilkan satu arus kas operasi.
- Selesai bila: tiap kriteria S1-06 punya tes yang disebut namanya di laporan.

### V4. Usulan mode `location_based` (menunggu D2 kaakara disetujui)
Tugas ini baru dibuka setelah manager memberi tahu bahwa D2 disetujui. Langkah pertama hanya dokumen: `docs/location-based-proposal.md` berisi field baru yang dibutuhkan di `project` dan `technical` (lintang, bujur, kemiringan, azimuth), cara hasil penyedia menjadi `specific_yield` dan `yield_boundary`, galat yang mungkin muncul (dengan `code`), dan dampaknya ke web dan data. Kode ditulis setelah usulan disetujui.

### V5. Pekerjaan CI `database` (menunggu tes SQL kaakara)
Tambahkan pekerjaan di `.github/workflows/ci.yml` yang menjalankan `supabase/tests/` pada Postgres sungguhan (service container). Dibuka setelah kaakara mengirim skripnya dan manager memberi tahu.

## Cara memeriksa pekerjaanmu
```bash
cd services/calculation-engine
pip install -r requirements.txt
pytest
```
Untuk mencoba langsung: jalankan `uvicorn app.main:app --reload` dan ikuti `docs/api.md`.

## Kapan berhenti dan bertanya ke manager
Kontrak perlu berubah, dua aturan bertentangan, kamu perlu mengubah file di luar wilayahmu, atau dokumentasi layanan luar bertentangan dengan asumsi di dokumen ini.
