# DESIGN.md: RenewableX web

Sumber arah: `style-guide-kraftia.md`, dipakai sebagai acuan gaya ("kurang lebih seperti ini"). Bukan identitas Kraftia: tidak ada logo, nama, atau footer Kraftia.

Identity: alat screening kelayakan PV untuk pengembang energi terbarukan. Wordmark teks "RenewableX" (belum ada logo, R-23).
Personality: tenang, teknis, jujur soal asumsi.
Mood: bersih, banyak ruang putih, kartu abu muda, tabel header navy.
Dial: ENERGY 1 / RHYTHM 2 / MOTION 1

## Palet (light)
- Navy `#0F1E3C`: judul, header tabel. Alasan: otoritas, dari guide.
- Hijau `#1A6B42`: satu-satunya aksen (tombol, label bagian, garis grafik). Guide memakai `#1F7A4D`; digelapkan agar lolos 4,5:1 di atas kartu abu.
- Netral: putih, kartu `#EEF2F5`, teks `#1A1F2B`, teks pendukung `#4F5B69` (guide `#6B7785` gagal 4,05:1 di kartu).
- Status: emas, merah, biru hanya sebagai latar status dengan teks gelap, tidak pernah sebagai teks di putih (emas 2,95:1 dan merah 4,01:1 gagal).
- Dark mode mengikuti pengaturan sistem pengguna; nilainya dibuat sendiri karena guide hanya mendefinisikan latar putih.

## Tipografi
DM Sans, satu keluarga (cadangan Calibri). Judul 28 sampai 30 px bold navy, label bagian bold hijau sentence case (tanpa kapital berjarak, supaya tidak jadi dekorasi), isi 16 px.

## Aturan
- Judul `Topik: Pesan Utama`. Satu layar, satu pesan.
- Semua angka dari input pengguna. Nilai awal form adalah contoh ilustratif dari `examples/sample-pv-project.json` dan diberi label.
- Satuan selalu ditulis. Hasil selalu berlabel "pendahuluan, sebelum pajak, tanpa pendanaan".
- Tanpa em dash. Tanpa ikon dekoratif. Tanpa animasi selain umpan balik hover dan tekan.

## Alasan keputusan (R-31)
- Dua kolom (form dan hasil): pengguna mengubah asumsi sambil melihat hasil.
- Kartu abu: mengelompokkan input dan KPI, sesuai guide.
- Tabel tahunan: teks pengganti grafik dan sumber angka yang bisa diperiksa.
- Tema light tetap sebagai dasar: guide menetapkan latar putih untuk slide konten.
