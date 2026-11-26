# DESIGN.md: RenewableX Web

## 1. Identitas dan Arah Visual
- **Identitas produk:** RenewableX adalah alat desain dan analisis sistem energi hybrid (PV, BESS atau baterai, Biomass, dan EMS atau pengatur operasi sistem). Fungsi awalnya, screening kelayakan PV, tetap ada sebagai mode cepat.
- **Wordmark:** Teks "RenewableX" sampai logo resmi dan gambar final dikonfirmasi oleh pemilik proyek. Sebelum itu, gunakan placeholder berlabel.
- **Acuan visual minimum:** [docs/reference/kiyo.html](docs/reference/kiyo.html). Dokumen ini menyesuaikan arah desain dari prototipe tersebut sebagai batas dasar minimum, yang nantinya dikembangkan jauh lebih lengkap ke alur multi-halaman dan katalog grafik sistem hybrid.
- **Kepribadian desain:** Tenang, padat data namun enak dibaca, teknis, jujur soal asumsi, dan terasa dikerjakan dengan cermat.
- **Dial desain awal:** `ENERGY 1 / RHYTHM 2 / MOTION 1` (tenang, tata letak terstruktur dengan pemisahan garis tipis, animasi minimal hanya untuk umpan balik hover, tekan, dan transisi fokus). Pemilik proyek dapat mengubah dial ini kapan saja.

## 2. Palet Warna dan Token Semantik

Mengikuti arahan pemilik proyek, palet aksen violet dari `kiyo.html` dipertahankan dan dirapikan ke token semantik agar memiliki identitas sendiri (tidak memakai nama token produk lain) serta lolos rasio kontras WCAG AA (minimal 4,5 banding 1 untuk teks isi, minimal 3 banding 1 untuk batas input dan kontrol).

### 2.1 Mode Terang (Light)
| Token Semantik | Nilai Hex | Pemakaian |
|---|---|---|
| `surface` (`--bg`, `--surface`) | `#FFFFFF` | Latar halaman dan kartu utama |
| `surface-subtle` (`--surface-subtle`) | `#F8FAFC` | Kepala tabel, baris sorot hover, permukaan sekunder |
| `ink` (`--text`) | `#0B1F3A` | Teks isi utama |
| `ink-strong` (`--navytext`) | `#061B31` | Judul halaman, judul kartu, nilai KPI, angka penting |
| `muted` (`--muted`) | `#5A687D` | Teks pendukung, satuan, sub-label (digelapkan dari `#6B7A90` di `kiyo.html` agar lolos kontras minimal 4,5 banding 1 di atas putih) |
| `border` (`--border`) | `#E5EDF5` | Garis pembatas kartu, pemisah bagian, garis tabel |
| `field-border` (`--field`) | `#6B7A90` | Batas input dan kontrol saat hover (lolos 3 banding 1) |
| `brand` (`--accent`, `--btn`) | `#533AFD` | Aksen utama, tombol aksi utama, indikator tab aktif, slider |
| `brand-hover` (`--btnhover`) | `#4229E8` | Keadaan hover tombol aksi utama |
| `brand-soft` (`--accent-soft`, `--secondary`) | `#8E5CFF` / `#B9B9F9` | Batas tombol sekunder dan sorotan halus |
| `positive` (`--success` / `--successbg`) | `#16A34A` / `#F0FDF4` | Status layak dan indikator nilai positif |
| `negative` (`--errtext` / `--errbg`) | `#B42318` / `#FEF2F2` | Status tidak layak, pesan galat, indikator nilai negatif |
| `warning` (`--warntext` / `--warnbg`) | `#92400E` / `#FFFBEB` | Status marjinal dan banner peringatan |

### 2.2 Mode Gelap (Dark)
Mode gelap mengikuti preferensi sistem (`prefers-color-scheme: dark`) dan toggle tema bila tersedia, menggunakan nilai yang sudah teruji kontrasnya di `apps/web/app/globals.css`:
- `surface`: `#061B31` (halaman), `#0B2542` (kartu), `#0F2D4F` (kepala tabel dan permukaan halus)
- `ink`: `#F1F5F9` (utama), `#FFFFFF` (judul), `#A9B4C2` (teks pendukung)
- `border`: `#1E3A5F` (batas kartu), `#7F8EA6` (batas kontrol)
- `brand`: `#A78BFA` (aksen teks/garis fokus), `#6C55FF` (tombol utama), `#6852FF` (hover tombol)
- `positive` / `negative` / `warning`: `#4ADE80` di `#052E16`, `#FFB4A3` di `#3A1A14`, `#FDE68A` di `#3A2E12`

### 2.3 Palet Seri Grafik Hybrid
Untuk membedakan sumber energi dan aliran daya pada grafik sistem hybrid tanpa bergantung pada warna saja (selalu disertai label, legenda, atau pola garis):
- **PV (Surya):** `#533AFD` (violet utama, mode gelap `#A78BFA`)
- **BESS (Baterai):** `#0EA5E9` (biru langit, mode gelap `#38BDF8`)
- **Biomass (Pembangkit):** `#D97706` (amber hangat, mode gelap `#FBBF24`)
- **Beban (Load):** `#061B31` (navy gelap, mode gelap `#E2E8F0`) dengan gaya garis putus-putus atau pembeda tebal garis
- **Grid / Ekspor / Positif:** `#16A34A` (hijau status, mode gelap `#4ADE80`)
- **Unmet Load / Curtailment / Negatif:** `#B42318` (merah status, mode gelap `#F87171`)

## 3. Tipografi
- **Keluarga huruf:** DM Sans dan Inter melalui paket font lokal atau sistem (`-apple-system`, `BlinkMacSystemFont`, `system-ui`, `sans-serif`). Jangan menggunakan referensi font `"Sohne Var"` dari prototipe.
- **Skala dan angka:**
  - Judul halaman (`h1`): 28 sampai 36 px, bobot ringan/normal (`400`), `letter-spacing: -0.025em`.
  - Judul bagian (`h2`, `h3`): 16 sampai 18 px, bobot semi-tebal (`600`).
  - Teks isi: 15 sampai 16 px (`0.9375rem` sampai `1rem`).
  - Semua angka di KPI, input, tabel, grafik, dan tooltip wajib memakai `font-variant-numeric: tabular-nums` agar kolom angka selalu sejajar.

## 4. Tata Letak dan Pola Interaksi

### 4.1 Yang Dipertahankan dari `kiyo.html`
- **Tata letak dua kolom** pada layar desktop untuk mode cepat dan halaman konfigurasi: panel input di sebelah kiri, ruang kerja hasil di sebelah kanan, dengan header editorial dan strip kartu KPI datar di bagian atas.
- **Kartu datar:** Border tipis `1px solid`, radius kecil konsisten (`4px` untuk kontrol dan `6px` untuk kartu), tanpa bayangan besar.
- **Kontrol dan navigasi data:**
  - Tab bergaris bawah dengan indikator aksen merek (`role="tablist"`, `role="tab"`, `role="tabpanel"`).
  - Input angka yang tersinkron dua arah dengan slider pada parameter utama.
  - Tabel dengan header lengket (`sticky`), caption aksesibel, angka rata kanan, dan baris total di bawah.
  - Chip status (`Layak`, `Marjinal`, `Tidak Layak`).
  - Banner validasi terstruktur di atas area kerja, notifikasi toast non-blokir (dilarang memakai `alert()`), serta tombol ekspor JSON dan CSV.
  - Toggle dwibahasa (EN dan ID) serta mata uang (IDR dan USD) dengan atribut `aria-pressed` dan format angka sesuai lokal.

### 4.2 Yang Dikembangkan untuk Sistem Hybrid
- **Alur multi-halaman:** Proyek, Lokasi dan sumber daya, Beban (unggah CSV dan pembangkit profil), Desain sistem (kanvas skema), EMS (strategi bawaan dan editor aturan visual), Ekonomi, Jalankan simulasi (antrean job dan status cold start Render yang jujur), Dasbor hasil, Perbandingan skenario dan sapuan, serta Ekspor laporan (PDF, Excel, CSV).
- **Katalog grafik lengkap:** Grafik energi bulanan bertumpuk, peta panas 8.760 jam (beban, PV, SOC, unmet load), profil harian rata-rata, dispatch harian/mingguan dengan penggeser waktu, kurva SOC baterai, kurva durasi, diagram aliran energi (Sankey), waterfall rugi PV, arus kas, rincian biaya dan LCOE, degradasi umur proyek, konsumsi bahan bakar biomass, serta tornado sensitivitas.
- **Tiga keadaan wajib di setiap komponen:** Setiap grafik, tabel, dan job simulasi wajib memiliki tampilan keadaan kosong, memuat, dan galat yang jelas.
- **Responsif:** Nyaman digunakan mulai lebar layar `360px` tanpa gulir mendatar yang merusak halaman; target sentuh kontrol minimal `44px`; kanvas skema dan grafik lebar menyediakan mode ringkas pada layar kecil.

## 5. Aturan Kebersihan Kode, Aksesibilitas, dan Data
- **Rumus hanya di backend:** Frontend tidak boleh menghitung ulang rumus energi atau keuangan (NPV, IRR, LCOE, payback, neraca daya). Frontend hanya memformat angka, memilih satuan tampilan, dan menyederhanakan titik grafik bila perlu.
- **Data jujur:** Dilarang menyalin angka bawaan tanpa sumber dari `kiyo.html`. Setiap angka asumsi harus bersumber di `docs/assumptions.md` atau berlabel `[REAL DATA]`.
- **Aksesibilitas keyboard:** Jangan memakai `focus:outline-none` tanpa pengganti yang setara. Pertahankan indikator `:focus-visible` yang kontras dan jelas, urutan Tab logis, serta nama aksesibel untuk semua kontrol dan grafik penting.
- **Tanpa em dash atau en dash:** Dilarang menggunakan em dash atau en dash di teks antarmuka, judul halaman, label preset lokasi, maupun penanda nilai kosong (gunakan koma, titik dua, atau kata seperti "Belum dihitung").
- **Tanpa skrip CDN:** Seluruh CSS dan pustaka grafik harus terpasang lewat build aplikasi (`package.json`), bukan CDN di HTML, dan setiap dependensi baru wajib melewati PR terpisah untuk persetujuan pemilik proyek.
- **Bahasa antarmuka:** Tombol harus menyebut aksinya secara spesifik (misalnya "Hitung Estimasi" atau "Jalankan Simulasi", bukan "Mulai"), tanpa kata promosi kosong.
