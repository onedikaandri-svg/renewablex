# Kontrak Tahap 8: Pemolesan Performa, Audit Aksesibilitas, Dokumentasi Pengguna, dan Komponen Energi Tambahan

**Status dokumen:** Tahap 8A disetujui pemilik proyek pada 2026-11-26 (keputusan 1, 2, 3, dan 5 terkonfirmasi; menunggu konfirmasi keputusan 4 mengenai pilihan komponen pertama Tahap 8B).
**Cabang usulan kontrak:** `docs/stage-8-contract` (berbasis `main` setelah penggabungan Tahap 7, commit `ca46fac`).
**Cakupan:** Hasil pengukuran benchmark performa dasar (backend dan frontend) beserta target optimasi yang terukur, temuan audit aksesibilitas WCAG AA dan perbaikan visual, penambahan 3 grafik katalog `AGENTS.md` 9.2 (tanpa dependensi baru), rancangan dokumentasi pengguna berbahasa Indonesia, serta usulan kontrak komponen energi tambahan pertama melalui antarmuka seragam `EnergyComponent`.

---

## 1. Prinsip Kompatibilitas dan Usulan Pembagian Tahap 8A dan 8B

1. **Mode Cepat Screening PV tetap 100% utuh:**
   Halaman utama `/` serta endpoint backend `POST /v1/pv/preliminary`, `POST /v1/pv/sensitivity`, dan `GET /health` tidak diubah struktur JSON, validasi, maupun perhitungannya.
2. **Rumus hanya di backend (`AGENTS.md` bagian 3 dan 9.2):**
   Frontend dilarang keras menghitung ulang rumus energi, dispatch, sapuan, sensitivitas, maupun keuangan. Frontend hanya menampilkan data dari mesin hitung Python, memformat angka (`tabular-nums`), memilih satuan tampilan, dan melakukan penyederhanaan titik grafik (*decimation*) untuk tampilan tanpa mengubah metrik.
3. **Batas terhadap Tahap 3B dan Tahap 6B:**
   Tahap 3B (interpreter aturan EMS kustom berbasis JSON) dan Tahap 6B (editor EMS visual) tetap ditunda sementara sampai berkas skema EMS resmi dari pemilik proyek siap digabungkan. Halaman 5 (`/hybrid/[projectId]/ems`) tetap memakai 5 strategi dispatch bawaan. Desain komponen baru di Tahap 8B disiapkan melalui `DispatchContext` agar kelak langsung kompatibel dengan interpreter EMS kustom.
4. **Nol dependensi baru (`AGENTS.md` bagian 4 dan 11):**
   - **Tahap 8A:** Tidak menambah paket baru baik di backend maupun frontend. Diagram aliran energi **Sankey** sudah tersedia langsung di paket `echarts` (`v6.1.0`) yang terpasang (`SankeyChart` dari `echarts/charts`).
   - **Tahap 8B:** Komponen energi baru (misalnya Diesel Generator, Wind, atau Hidro) dibangun di atas Python + NumPy bawaan tanpa pustaka eksternal.
5. **Usulan Pembagian Menjadi Dua PR Terpisah (8A dan 8B):**
   - **Tahap 8A (Pemolesan Performa, Audit Aksesibilitas WCAG AA, Perbaikan Visual + 3 Grafik Katalog 9.2, dan Dokumentasi Pengguna):** Tidak mengubah kontrak JSON API v0.5/v0.6 (`ENGINE_VERSION` tetap di seri `0.6.x`, misalnya `"0.6.1"`). Fokus pada kecepatan, kenyamanan pengguna, kepatuhan aksesibilitas, dan panduan pengguna.
   - **Tahap 8B (Komponen Energi Tambahan Pertama lewat `EnergyComponent`):** Menaikkan kontrak menjadi `contract_version: "0.7"` (`ENGINE_VERSION = "0.7.0"`), sambil tetap menerima permintaan lama `"0.5"` dan `"0.6"` secara kompatibel mundur.

---

## 2. Hasil Pengukuran Benchmark Performa Dasar (Aktual) dan Target Pemolesan

### 2.1 Kondisi Pengukuran Dasar (*Baseline*)
Pengukuran dilakukan langsung pada mesin pengembangan lokal sebelum optimasi apa pun (`main` commit `ca46fac`):
- **Lingkungan:** Windows, Python 3.11 + NumPy, Node.js `v26.13.1`.
- **Skenario uji backend:** Profil beban sintetis `120` sampai `350 kW` (`seed=42`, `noise_fraction=0.05`), PV `500 kWp` / inverter `420 kW` (`detailed_v1`, transposisi Perez, suhu sel Faiman, degradasi `0,5%/tahun`), BESS `600 kWh` (`300 kW` charge/discharge), Biomass `250 kW` (`sample_gasifier_250kw`, preset `efb`, batas pasokan bulanan `220 ton`), strategi dispatch `load_following`, umur proyek `25 tahun`, asumsi keuangan sampel `[REAL DATA]`.

### 2.2 Benchmark Backend Aktual vs Target Tahap 8A

| Skenario Uji Backend | Baseline Aktual (Sebelum Optimasi) | Target Tahap 8A | Catatan Pengukuran |
|---|---|---|---|
| Simulasi 1 tahun PV + BESS (tanpa Biomass) | **122,7 ms** *(median 3 run: 116,0 / 122,7 / 123,6 ms)* | **< 100 ms** | Loop 8.760 langkah sudah ringan tanpa Biomass. |
| Simulasi 1 tahun PV + BESS + Biomass (`pvwatts` DC) | **1.295,1 ms** *(median 3 run: 1.250,6 / 1.295,1 / 1.319,0 ms)* | **< 300 ms** *(>= 4x lebih cepat)* | Didominasi overhead berulang di `BiomassComponent` dan `TimeConfig`. |
| Simulasi 1 tahun PV + BESS + Biomass (`single_diode` DC) | **1.158,1 ms** *(median 3 run: 1.125,1 / 1.158,1 / 1.167,6 ms)* | **< 300 ms** | Potensi PV 8 tahap tervektorisasi; bottleneck sama di loop Biomass. |
| Simulasi 25 tahun `scaled_year_1` + Keuangan | **1.171,2 ms** *(median 3 run: 1.114,9 / 1.171,2 / 1.338,1 ms)* | **< 320 ms** | Menjalankan 1x simulasi Tahun 1 lalu penskalaan 24 tahun berikutnya. |
| Simulasi 25 tahun `full_hourly` + Keuangan | **29.548,2 ms** *(~29,5 detik)* | **< 7.500 ms** *(< 7,5 detik)* | Menjalankan 25x simulasi 8.760 jam berurutan (219.000 langkah). |
| Sapuan 64 kombinasi (`4 PV x 4 BESS x 4 Biomass`, `scaled_year_1`, cache PV aktif) | **63.217,0 ms** *(~63,2 detik; 987,8 ms/kombinasi)* | **< 15.000 ms** *(< 15 detik; < 235 ms/kombinasi)* | Sangat penting agar job sapuan nyaman di CPU bersama server gratis Render. |
| Sensitivitas Hybrid (6 variabel default Tornado + Matriks `5 x 5`) | **6.108,6 sampai 6.547,7 ms** *(~6,1 sampai 6,5 detik)* | **< 1.500 ms** *(< 1,5 detik)* | 1 kasus dasar + 4 kasus geser `pv_degradation_rate` + kasus matriks. |

### 2.3 Temuan Profiler (`cProfile`) dan Rencana Optimasi Bedah

Hasil profiling `cProfile` pada 1 tahun simulasi penuh (PV + BESS + Biomass) mencatat **4.010.639 panggilan fungsi** dengan 5 titik panas (*hotspot*) utama:

1. **`BiomassConfig.effective_fuel_params` (`services/calculation-engine/app/hybrid/biomass.py:214`):**
   Dipanggil **94.821 kali** dalam 1 tahun simulasi (`0,648 detik` waktu kumulatif pada sesi profiler) karena berupa `@property` yang menyalin kamus preset dan memvalidasi `ResolvedFuelParams` berulang kali di dalam loop per jam dan bisection `max_power_for_fuel_tons`.
   - **Solusi:** Hitung dan simpan `_fuel_params: ResolvedFuelParams` satu kali pada `BiomassComponent.__init__`.
2. **`BiomassComponent._heat_rate_kj_per_kwh` (`services/calculation-engine/app/hybrid/biomass.py:534`):**
   Dipanggil **85.504 kali** per tahun (`0,629 detik` waktu kumulatif), memicu **188.533** alokasi `numpy.array(...)` dan **85.504** panggilan `numpy.interp` hanya untuk menginterpolasi 2 sampai 5 titik kurva bahan bakar.
   - **Solusi:** Pre-komputasi tuple `(xs, ys)` dan lakukan interpolasi linear Python murni pada `BiomassComponent.__init__`, serta pre-komputasi konsumsi bahan bakar untuk `min_load_kw` dan `rated_capacity_kw` agar metode `max_power_for_fuel_tons` tidak mengulang kalkulasi konstan.
3. **`TimeConfig.day_indices()` dan `TimeConfig.month_indices()` (`services/calculation-engine/app/hybrid/time_grid.py:100,104`):**
   Dipanggil **17.526** dan **17.523 kali** per tahun (`0,495 detik` waktu kumulatif untuk `month_indices`, **35.051** alokasi `numpy.arange`) terutama oleh `BiomassComponent._period_key()` di setiap langkah jam.
   - **Solusi:** Cache hasil array `day_indices()`, `month_indices()`, dan `hour_of_day()` di tingkat modul dengan `@lru_cache` berbasis `(step_minutes, leap_day_policy)`, dengan `arr.flags.writeable = False` agar aman terhadap mutasi tidak sengaja.
4. **`BiomassComponent.inspect_step_limits()` (`services/calculation-engine/app/hybrid/biomass.py:680`):**
   Dipanggil **17.520 kali** (2 kali per langkah waktu: sekali di `simulator.py` sebelum dispatch, lalu sekali lagi di dalam `BiomassComponent.step()`), menyumbang `1,557 detik` waktu kumulatif.
   - **Solusi:** Tambahkan parameter opsional `precomputed_limits: dict[str, Any] | None = None` pada `BiomassComponent.step()` sehingga `simulator.py` meneruskan hasil `inspect_step_limits` yang sudah dihitung pada langkah yang sama tanpa menghitung ulang.
5. **Agregasi Harian & Jalur Cepat Sensitivitas (`simulator.py:254` dan `sensitivity.py`):**
   - Pada `_aggregate_daily()` di `simulator.py`, ubah loop 365 hari berulang (`day_idx == d`) menjadi `reshape(365, steps_per_day)` NumPy.
   - Pada `sensitivity.py`, ketika `multi_year_mode == "scaled_year_1"` dan variabel yang digeser hanya `pv_degradation_rate`, degradasi baru memengaruhi Tahun 2 ke atas sehingga Tahun 1 identik dengan kasus dasar (`base_lifetime_res.year_1_result`). Jalur ini menghemat pemanggilan ulang simulasi 8.760 jam untuk 4 kasus Tornado `pv_degradation_rate`.

**Jaminan Kebenaran Optimasi:**
Seluruh optimasi di atas bersifat **ekivalen secara matematis**. PR implementasi Tahap 8A wajib menyertakan skrip benchmark berulang (`services/calculation-engine/scripts/benchmark_hybrid.py`) serta tes regresi `pytest` yang membuktikan selisih numerik keluaran energi dan keuangan terhadap hasil sebelum optimasi tidak lebih dari `1e-12`.

### 2.4 Benchmark Frontend Dasar (`apps/web/`) dan Pemolesan Grafik 8.760 Jam

Pengukuran pemrosesan deret 8.760 jam di JavaScript (Node `v26.13.1`):
- Penyusunan 8.760 titik Peta Panas (`365 x 24`): **2,13 ms**.
- Pengurutan 2 deret Kurva Durasi (`2 x 8.760` titik): **3,01 ms**.
- Penyusunan berkas CSV 8.760 jam (`~485,3 KB`): **1,77 ms**.
- Ukuran payload JSON `hourly_year_1` mentah sebelum kompresi GZip: **~401,6 KB** (`JSON.stringify` + `JSON.parse`: **2,71 ms**).

**Pemolesan Frontend di Tahap 8A:**
1. **Decimation Kurva Durasi 8.760 Jam:** Merender 8.760 titik SVG/Canvas pada kurva garis untuk 3 sampai 4 seri sekaligus di layar mobile akan membebani memori browser. Data diurutkan dari 8.760 nilai nyata, lalu diambil sampel merata (~240 titik persentil dari `0%` sampai `100%`) dengan **selalu mempertahankan titik indeks `0` (nilai puncak) dan indeks `8759` (nilai minimum)** agar ekstrem kurva tetap eksak. Metrik ringkasan tidak berubah sama sekali.
2. **Peta Panas 8.760 Sel:** Menonaktifkan animasi transisi berat (`animation: false` dan `progressive: 2000`) pada opsi ECharts Heatmap agar perpindahan antar metrik (`Beban`, `PV`, `SOC`, `Unmet`) terasa instan termasuk di ponsel.
3. **Render Tab Terpisah:** Mempertahankan perilaku `HybridDashboard` yang hanya memicu instance ECharts pada tab aktif sehingga penggunaan memori WebGL/Canvas tetap kecil.

---

## 3. Audit Aksesibilitas WCAG AA, Pemolesan Visual, dan Grafik Tambahan Katalog 9.2

### 3.1 Temuan Audit Kontras Warna (`apps/web/app/globals.css` & `apps/web/lib/contrast.test.ts`)

Audit otomatis terhadap seluruh token warna Mode Terang dan Mode Gelap pada `apps/web/app/globals.css` menemukan **5 kelemahan kontras WCAG AA** pada **Mode Terang** (batas minimal: `>= 4,5:1` untuk teks normal, `>= 3,0:1` untuk grafis/batas kontrol aktif):

| Token / Elemen | Pasangan Warna Saat Ini (Mode Terang) | Rasio Saat Ini | Status WCAG AA | Usulan Nilai Baru (Mode Terang) | Rasio Baru |
|---|---|---|---|---|---|
| `--success` / `--positive` | `#16A34A` di atas `#FFFFFF` & `#F0FDF4` | `3,30:1` & `3,15:1` | **Gagal 4,5:1 untuk teks** (`.chip-viable`, `.kpi b.pos`, `.num-pos`, `.matrix-viable`, `.toast-success`) | **`#15803D`** | **`5,02:1`** & **`4,79:1`** (Lolos AA) |
| `--series-bess` | `#0EA5E9` di atas `#FFFFFF` & `#F8FAFC` | `2,77:1` & `2,65:1` | **Gagal 3,0:1 grafis & 4,5:1 teks SVG** | **`#0369A1`** | **`5,93:1`** & **`5,65:1`** (Lolos AA) |
| `--series-biomass` | `#D97706` di atas `#FFFFFF` & `#F8FAFC` | `3,19:1` & `3,04:1` | **Gagal 4,5:1 sebagai teks nilai SVG** di `SystemSchematicSvg` & `SchematicCanvas` | **`#B45309`** | **`5,02:1`** & **`4,79:1`** (Lolos AA) |
| `--series-grid` | `#16A34A` di atas `#FFFFFF` & `#F8FAFC` | `3,30:1` & `3,15:1` | **Gagal 4,5:1 sebagai teks nilai SVG** | **`#15803D`** | **`5,02:1`** & **`4,79:1`** (Lolos AA) |
| `.btn.ghost` (batas tombol) | `--secondary` (`#B9B9F9`) di atas `#FFFFFF` | `1,85:1` | **Gagal 3,0:1 batas kontrol non-teks** | Gunakan **`--field-border` (`#6B7A90`)** atau warna batas `>= 3,0:1` | **`4,36:1`** (Lolos 3,0:1) |

*(Catatan: Pada **Mode Gelap**, seluruh token utama dan token seri `--series-*` sudah berada di atas `4,5:1` kecuali `--border` dekoratif kartu `1,51:1` dan `--secondary` `3,59:1` yang masih memenuhi batas kontrol non-teks `3,0:1`.)*

**Tindakan di Tahap 8A:**
1. Memperbarui nilai token warna pada `apps/web/app/globals.css`, `apps/web/components/hybrid/EChart.tsx` (`getChartThemeColors`), `apps/web/lib/hybrid-topology.ts` (`LIGHT_THEME_TOKENS`), dan `DESIGN.md`.
2. Memperluas `apps/web/lib/contrast.test.ts` agar menguji seluruh pasangan baru (`--success` di atas `--bg` & `--successbg`, `--warntext` di atas `--warnbg`, serta seluruh `--series-*` di atas `--surface` & `--surface-subtle` pada mode terang dan blok `:root[data-theme="dark"]`), serta menghapus sisa komentar `"Stripe Modern"` di baris 25 `contrast.test.ts`.

### 3.2 Temuan Navigasi Keyboard, Target Sentuh, Mobile `360px`, dan Konsistensi UI

1. **Tautan Lompat ke Konten Utama (*Skip Link*) & Bahasa Dokumen (`layout.tsx`, `preferences.tsx`):**
   - Menambahkan tautan aksesibilitas `<a href="#main-content" className="skip-link">` di awal `<body>` yang terlihat jelas saat mendapat fokus keyboard (`:focus`) dan mengarahkan langsung ke `<main id="main-content" className="wrap">`.
   - Menyinkronkan atribut `document.documentElement.lang` (`"id"` atau `"en"`) ketika pengguna mengganti toggle bahasa di `AppHeader.tsx`.
2. **Navigasi Keyboard Pola WAI-ARIA Tabs (`HybridDashboard.tsx` & `compare/page.tsx`):**
   - Mengimplementasikan dukungan tombol `ArrowLeft`, `ArrowRight`, `Home`, dan `End` serta atribut `tabIndex` yang tepat (`0` pada tab aktif, `-1` pada tab nonaktif) pada seluruh komponen `role="tablist"`.
3. **Toast Notification (`Toast.tsx`):**
   - Menambahkan penangan tombol `Escape` untuk menutup notifikasi aktif, serta memperbesar target sentuh tombol tutup toast agar memenuhi minimal `44px x 44px` di layar sentuh tanpa memotong teks.
4. **Target Sentuh `44px` & Verifikasi Nol Overflow `360px`:**
   - Memastikan tombol pada header (`.mode-link`, `.seg-btn`), toolbar kanvas, tombol pilih metrik peta panas, dan baris aksi tabel memenuhi target sentuh nyaman minimal `44px` pada layar kecil (`max-width: 40rem`) dan tidak menimbulkan gulir mendatar pada `document.documentElement` mulai lebar `360px` di seluruh Halaman 1 sampai 10 serta Mode Cepat (`/`).
5. **Tabel Teks Alternatif Grafik (`AGENTS.md` 9.3):**
   - Melengkapi `<details className="more">` berisi tabel data terstruktur untuk grafik penting di Halaman 8 yang saat ini belum memiliki alternatif teks tabel: **Energi Bulanan per Sumber**, **Diagram Rugi PV (Waterfall)**, **Rincian Biaya LCOE**, serta ketiga grafik baru Tahap 8A (**Aliran Energi Sankey**, **Kurva Durasi**, dan **Degradasi Kapasitas Multi-Tahun**).
6. **Perbaikan Konsistensi Penanda Versi & Label UI:**
   - `apps/web/components/AppHeader.tsx`: menyelaraskan penanda `"Hybrid Studio v0.5"` agar memakai konstanta versi terpusat (`"Hybrid Studio v0.6"` pada Tahap 8A, dan `"Hybrid Studio v0.7"` pada Tahap 8B).
   - `apps/web/app/hybrid/page.tsx`: memperbaiki teks `"Langkah 1 dari 8"` menjadi `"Langkah 1 dari 10"`.
   - `apps/web/app/globals.css`: memperbaiki komentar `"Stepper 8 langkah hybrid"` menjadi `"Stepper 10 langkah hybrid"`.
   - `apps/web/components/hybrid/HybridDashboard.tsx`: memastikan label pada kontrol dan keterangan mengikuti toggle bahasa `ID / EN` secara konsisten.

### 3.3 Perbaikan Visual Label Pill pada `SystemSchematicSvg.tsx` dan `hybrid-topology.ts`

Pada verifikasi visual Tahap 7 ditemukan label pill aliran energi pada `SystemSchematicSvg.tsx` dapat menyentuh tepi kotak `AC BUS`. Akar masalah yang ditemukan di kode saat ini:
- Pada `apps/web/lib/hybrid-topology.ts` (`DEFAULT_NODE_POSITIONS`):
  - Node sumber kiri (`x = 40`, `width = 176`) berakhir di `x = 216`.
  - Node `AC BUS` berada di `x = 300`, `width = 128` (berakhir di `x = 428`). Celah horizontal di sisi kiri hanya **`84 px`**.
  - Node kanan (`load`, `grid`) berada di `x = 500`. Celah horizontal di sisi kanan hanya **`72 px`**.
  - Sementara itu, pill aliran di `SystemSchematicSvg.tsx:260` berukuran tetap `width = 108 px`, sehingga pasti melampaui celah `84 px` dan `72 px` serta menyentuh tepi kotak.

**Perbaikan di Tahap 8A:**
1. Memperlebar jarak antar kolom pada `DEFAULT_NODE_POSITIONS` (`hybrid-topology.ts`):
   - Kolom kiri (`pv`, `bess`, `biomass`): `x = 40` (berakhir di `216`).
   - Kolom tengah (`ac_bus`): `x = 360` (celah bersih sisi kiri `144 px`, berakhir di `488`).
   - Kolom kanan (`load`, `grid`): `x = 620` (celah bersih sisi kanan `132 px`).
2. Pada `SystemSchematicSvg.tsx`:
   - Menghitung lebar pill secara adaptif berdasarkan panjang teks label (`Math.max(82, Math.min(126, text.length * 6.2 + 16))`) dengan ukuran font `9.5px` yang tetap terbaca jelas.
   - Membatasi (*clamp*) koordinat horizontal pill terhadap segmen kosong antara tepi sumber dan tepi target dengan bantalan aman minimal `8 px` dari masing-masing tepi kotak (dan menambah bantalan `computeSchematicBounds` agar skema tetap simetris).

### 3.4 Penambahan 3 Grafik Katalog `AGENTS.md` 9.2 (Nol Dependensi Baru)

Melengkapi katalog visualisasi `AGENTS.md` bagian 9.2 di Halaman 8 (`/hybrid/[projectId]/results`) memakai komponen `echarts` yang sudah terpasang (`SankeyChart` + `LineChart`):

1. **Diagram Aliran Energi Tahunan (Sankey, Tab Ringkasan & Bulanan):**
   - Memvisualisasikan neraca energi Tahun 1 langsung dari respons backend (`summary`, `bess_summary`, `biomass_summary`, `lifetime_summary.yearly[0]`):
     - Sisi pasokan: `Solar PV`, `Biomass`, `Grid Import`.
     - Bus & penyimpan: `AC Bus`, `BESS` (menggambarkan `total_charge_kwh`, `total_discharge_kwh`, dan `conversion_losses_kwh`).
     - Sisi penggunaan & sink: `Beban Terpenuhi`, `Grid Export`, `Curtailment`, `Rugi Sistem & Parasitik`.
   - Nilai node/link diambil 100% dari angka backend (hanya dibulatkan ke `MWh/thn` untuk tampilan), disertai tabel ringkasan alternatif di bawah grafik.
2. **Kurva Durasi Beban & Pembangkitan (Tab Dispatch & SOC):**
   - Menampilkan kurva durasi (0% sampai 100% jam setahun, terurut menurun) untuk `Beban Listrik`, `Beban Terpenuhi`, `Produksi PV`, dan `Produksi Biomass` dari `hourly_year_1`.
   - Memakai *decimation* ~240 titik merata (menjaga indeks `0` dan `8759` tetap presisi), dengan state kosong yang jujur apabila `hourly_year_1` tidak tersedia.
3. **Grafik Degradasi Kapasitas PV & BESS Sepanjang Umur Proyek (Tab Keuangan & Umur Proyek):**
   - Mengambil `lifetime_summary.yearly` (`pv_degradation_factor`, `bess_final_effective_capacity_kwh`) dan `lifetime_summary.lifecycle_events` untuk menampilkan:
     - Garis % kapasitas efektif PV dari Tahun 1 sampai Tahun N.
     - Garis % kapasitas efektif akhir tahun BESS terhadap kapasitas nominal awal (terlihat turun bertahap lalu kembali ke 100% saat terjadi penggantian EOL).
     - Garis penanda vertikal (`markLine`) pada tahun terjadinya penggantian BESS, penggantian inverter, atau overhaul Biomass.
   - Juga menyertakan catatan jujur apabila simulasi dijalankan dengan mode cepat `scaled_year_1` (kapasitas BESS tidak disimulasikan per jam di Tahun 2..N pada mode `scaled_year_1`, sedangkan pada `full_hourly` degradasi BESS terhitung penuh tiap jam selama N tahun).

---

## 4. Rancangan Kerangka Dokumentasi Pengguna (Bahasa Indonesia)

Dokumentasi disusun untuk pemilik proyek dan pengguna awam dengan bahasa yang sederhana, langkah bernomor, dan penjelasan istilah teknis singkat:

- **Berkas utama:** `docs/user-guide-id.md`
- **Berkas contoh data beban siap unggah:** `examples/sample-load-8760.csv` (8.760 baris dengan header `waktu,load_kw` sebagai acuan langsung format CSV yang diterima engine).
- **Halaman ringkas di UI web (`/hybrid/guide`):** Halaman **"Panduan"** yang dapat diakses dari Halaman 1 (`/hybrid`) maupun navigasi mode hybrid, menampilkan ringkasan alur 10 halaman, contoh format CSV 8.760 jam, kamus metrik teknis/keuangan, dan tombol unduh contoh `sample-load-8760.csv`.

### Kerangka Bab `docs/user-guide-id.md`
1. **Bab 1: Memulai dengan RenewableX (Mode Cepat PV vs Desain Sistem Hybrid)**
   - Kapan memakai Mode Cepat (`/`) dan kapan memakai Desain Sistem Hybrid (`/hybrid`).
   - Penjelasan penyimpan lokal browser (`localStorage`), fungsi ekspor/impor `.hybrid.json` sebagai cadangan data proyek, serta penjelasan jujur mengenai *cold start* server gratis Render (30 sampai 60 detik pada permintaan pertama).
2. **Bab 2: Panduan Langkah demi Langkah Halaman 1 sampai Halaman 10**
   - Langkah 1 (Proyek), Langkah 2 (Lokasi & Cuaca PVGIS), Langkah 3 (Profil Beban), Langkah 4 (Kanvas Skema Sistem & Inspektor Parameter), Langkah 5 (Strategi EMS), Langkah 6 (Ekonomi & Tarif), Langkah 7 (Jalankan Simulasi: `scaled_year_1` vs `full_hourly`), Langkah 8 (Membaca Dasbor Hasil), Langkah 9 (Sapuan HOMER, Perbandingan Skenario, & Sensitivitas), Langkah 10 (Ekspor PDF A4, Excel `.xlsx`, CSV, dan JSON).
3. **Bab 3: Format Berkas CSV Beban Listrik 8.760 Jam dan Solusi Galat Umum**
   - Aturan baris (tepat 8.760 nilai, kebijakan tahun non-kabisat tanpa 29 Februari), pemisah koma/titik koma, contoh isi `examples/sample-load-8760.csv`, dan cara mengatasi pesan galat (`invalid_load_length`, `negative_load_value`, `invalid_csv_format`).
4. **Bab 4: Arti Metrik Teknis dan Keuangan**
   - Penjelasan awam untuk **LCOE**, **Total NPC**, **NPV**, **IRR**, **Payback Sederhana vs Terdiskonto**, **Pangsa Energi Terbarukan**, **Unmet Load**, **Curtailment**, **EFC** (siklus penuh baterai), dan **Emisi CO2e Dihindari**.
5. **Bab 5: Cara Membaca Sapuan Kombinasi HOMER, Kurva Pareto, Tornado, dan Matriks `5 x 5`**
   - Cara menafsirkan status `Layak`, `Marjinal`, dan `Tidak Layak`, cara menerapkan konfigurasi pemenang ke proyek aktif, dan cara menyimpan beberapa kandidat sebagai skenario pembanding.
6. **Bab 6: Penanda `[REAL DATA]` dan Pengisian Data Datasheet Nyata**
   - Daftar parameter yang masih memakai nilai ilustrasi sementara `[REAL DATA]` di `docs/assumptions.md` dan bagian mana saja yang perlu diganti saat datasheet PV, inverter, baterai, bahan bakar, atau penawaran EPC proyek asli tersedia.

---

## 5. Usulan Komponen Tambahan Pertama Lewat `EnergyComponent` (Tahap 8B)

### 5.1 Perbandingan Tiga Kandidat Komponen (`AGENTS.md` Bagian 6)

| Kandidat | Kelebihan untuk Tahap 8B | Keterbatasan / Kebutuhan Data | Rekomendasi |
|---|---|---|---|
| **1. Diesel Generator (`diesel`)** | Kasus penggunaan hybrid paling nyata di Indonesia (PV + BESS + Diesel untuk industri/pulau terpencil atau perbandingan biaya vs Biomass); tidak butuh sumber data cuaca tambahan; membedakan jelas antara pembangkit fosil (`is_renewable = False`, emisi tinggi) dan terbarukan. | Membutuhkan asumsi kurva konsumsi solar (L/kWh) dan harga solar industri yang ditandai `[REAL DATA]` di `docs/assumptions.md`. | **Direkomendasikan #1 (Tahap 8B)** |
| **2. Turbin Angin (`wind`)** | Data `WS10m` (kecepatan angin 10m) sudah ada di `WeatherDataset` dari PVGIS TMY tanpa panggilan API cuaca baru. | Data angin reanalisis ERA5 resolusi kasar di ketinggian 10m kurang akurat untuk lokasi spesifik tanpa data anemometer lokal (kurva daya turbin juga bervariasi). | **Kandidat #2 (Setelah Diesel)** |
| **3. Pembangkit Hidro / Run-of-River (`hydro`)** | Cocok untuk sistem off-grid pedesaan berbasis sungai kecil. | Data cuaca PVGIS/NASA tidak menyediakan debit aliran sungai (`m3/s`); pengguna harus mengunggah deret waktu debit 8.760 jam terpisah seperti profil beban. | **Kandidat #3 (Membutuhkan input deret debit baru)** |

### 5.2 Kontrak Teknis Komponen Diesel Generator (`contract_version: "0.7"`)

Apabila pemilik menyetujui **Diesel Generator** sebagai komponen tambahan pertama di Tahap 8B:

1. **Modul Backend Baru (`services/calculation-engine/app/hybrid/diesel.py`):**
   - Mengikuti kontrak abstrak `EnergyComponent` (`validate()`, `available_power_kw()`, `step()`, `lifecycle_events()`), identik dengan pola `BESSComponent` dan `BiomassComponent`.
   - `DieselConfig`:
     - `rated_capacity_kw: float` (wajib `> 0`)
     - `min_load_fraction: float = 0.30` (`[REAL DATA]` rasio beban minimum aman mesin diesel umumnya 30% agar terhindar dari *wet stacking*)
     - `fuel_curve_model: Literal["willans_linear", "piecewise_sfc"] = "willans_linear"`
     - `no_load_fuel_liters_per_hour: float` (default proporsional `[REAL DATA]`, mis. `0,08 * rated_capacity_kw` L/jam atau diisi dari datasheet)
     - `slope_liters_per_kwh: float = 0.25` (`[REAL DATA]` rasio marginal konsumsi solar per kWh)
     - `fuel_curve_points: tuple[tuple[float, float], ...] | None` (opsional `(load_fraction, liter_per_kwh)`)
     - `min_run_time_hours: float = 1.0`, `min_down_time_hours: float = 1.0`
     - `fuel_price_per_liter: float = 18500.0` (`[REAL DATA]` acuan solar non-subsidi ilustratif, wajib dicatat di `docs/assumptions.md`)
     - `fixed_om_per_kw_year: float = 150000.0` (`[REAL DATA]`), `variable_om_per_operating_hour: float = 0.0`, `startup_cost: float = 0.0`
     - `overhaul_interval_operating_hours: float | None = 15000.0` (`[REAL DATA]`), `overhaul_cost: float = 0.0`
     - `emission_factor_kg_co2e_per_liter: float = 2.68` (rujukan faktor emisi pembakaran bahan bakar diesel stasioner IPCC/DEFRA, dicatat sumbernya di `docs/assumptions.md`)
     - `is_renewable: bool = False` (selalu mengurangi atau tidak dihitung ke `renewable_fraction`).
2. **Integrasi ke `simulator.py`, `dispatch.py`, `lifetime.py`, `finance.py`, `sweep.py`, dan `excel_export.py`:**
   - **Neraca daya (`PowerBalanceSeries`):** Menambahkan vektor `diesel_generation_kw`. Rumus neraca tertutup tetap sama: `generation_kw = pv_generation_kw + biomass_generation_kw + diesel_generation_kw`. `renewable_fraction` mengeluarkan kontribusi `diesel_generation_kw` (karena non-terbarukan).
   - **Dispatch (`DispatchContext` & `DispatchDecision`):** Menambahkan field status dan daya tersedia Diesel (`diesel_available_kw`, `diesel_min_load_kw`, `diesel_can_start`, `diesel_can_stop`, `diesel_command_kw`). Pada 5 strategi dispatch bawaan, urutan prioritas pasokan: **PV -> BESS -> Biomass (jika aktif) -> Diesel Generator -> Grid Import (jika diizinkan)**, dan pada `cycle_charging` Diesel dapat ikut mengisi BESS menuju target SOC bila diaktifkan.
   - **Keuangan (`FinanceConfig` & `LCOEBreakdown`):** Menambahkan `diesel_capex_per_kw`, `diesel_capex`, `diesel_fixed_om_override`, `diesel_overhaul_life_years`, serta pos `capex_diesel` pada `LCOEBreakdown` dan `diesel_fuel_cost` pada biaya bahan bakar tahunan.
   - **Sapuan (`sweep.py`) & Ekspor (`excel_export.py`):** Menambahkan sumbu opsional `diesel_capacity_kw_values` (bila diisi; default `[0.0]` agar pemanggil `"0.6"` tidak berubah) dan ringkasan Diesel pada sheet Excel `Ringkasan` dan `Asumsi_Konfigurasi`.
3. **Integrasi Kanvas & UI (`apps/web/`):**
   - Menambahkan `"diesel"` ke `TopologyNodeKind` (`apps/web/lib/hybrid-types.ts`) dan `OPTIONAL_KINDS` pada `SchematicCanvas.tsx` (tombol **"Tambah Diesel"**).
   - Menambahkan token warna baru yang lolos WCAG AA: `--series-diesel: #475569` (mode terang, rasio `7,58:1` di atas putih) dan `#94A3B8` (mode gelap, rasio `5,96:1` di atas `#0B2542`).
   - Menambahkan form inspektor Diesel pada `ComponentInspector.tsx`, garis dan label aliran Diesel pada `SystemSchematicSvg.tsx`, seri Diesel pada grafik bulanan/dispatch/Sankey/kurva durasi di `HybridDashboard.tsx`, dan kartu asumsi Diesel di `PrintReportPreview.tsx`.

### 5.3 Contoh Perubahan Skema JSON API `contract_version: "0.7"` (Tahap 8B)

*(Seluruh angka berikut adalah sampel ilustratif `[REAL DATA]`.)*

```json
{
  "contract_version": "0.7",
  "components": {
    "pv": { "enabled": true, "capacity_kwp": 500.0, "inverter_ac_kw": 420.0 },
    "bess": { "enabled": true, "nominal_capacity_kwh": 600.0 },
    "biomass": { "enabled": false },
    "diesel": {
      "enabled": true,
      "rated_capacity_kw": 250.0,
      "min_load_fraction": 0.30,
      "fuel_price_per_liter": 18500.0,
      "overhaul_interval_operating_hours": 15000.0,
      "overhaul_cost": 120000000.0
    }
  },
  "finance": {
    "diesel_capex_per_kw": 4500000.0,
    "diesel_overhaul_life_years": 5.0
  }
}
```

Pada respons `POST /v1/hybrid/simulate` (`contract_version: "0.7"`):
- `summary` menambah `diesel_generation_kwh` (tetap `0.0` bila Diesel tidak diaktifkan).
- Menambah blok opsional `diesel_summary` (berisi `total_generation_kwh`, `total_operating_hours`, `startup_count`, `overhaul_count`, `total_fuel_liters`, `total_fuel_cost`, `total_variable_om_cost`, `total_fixed_om_cost`, `total_co2e_kg`, atau `null` jika nonaktif).
- `hourly_year_1` menambah vektor `diesel_generation_kw` dan `diesel_fuel_liters` (bila `include_hourly: true`).
- `lcoe_breakdown` menambah `capex_diesel`.

---

## 6. Kriteria Selesai dan Rencana Verifikasi Tahap 8

Setiap PR implementasi kode (Tahap 8A dan Tahap 8B) baru boleh dinyatakan selesai bila seluruh pemeriksaan berikut lulus tanpa pelemahan tes:

1. **Tes Backend (`cd services/calculation-engine && pytest`):**
   - Seluruh 217+ tes eksisting (termasuk `/v1/pv/*`, Tahap 1 sampai 7) lulus 100%.
   - **Tahap 8A:** Tes kesetaraan numerik optimasi (`selisih <= 1e-12` terhadap baseline sebelum optimasi) dan laporan benchmark sebelum vs sesudah dari `scripts/benchmark_hybrid.py`.
   - **Tahap 8B:** Tes unit `DieselComponent`, tes kekekalan neraca daya tertutup (`max_balance_error_kw <= 1e-6`), tes non-terbarukan (`renewable_fraction`), tes kesetaraan topologi kanvas vs JSON dengan node `diesel`, dan tes API v0.7 serta kompatibilitas mundur v0.5/v0.6.
2. **Tes & Build Frontend (`cd apps/web && npm.cmd test && npm.cmd run build`):**
   - `contrast.test.ts` diperluas untuk seluruh token status dan `--series-*` (termasuk `--series-diesel` di Tahap 8B) pada mode terang dan gelap (`>= 4,5:1` teks, `>= 3,0:1` kontrol/grafik).
   - Tes unit untuk *decimation* Kurva Durasi (titik puncak dan minimum eksak), pembentukan node/link Sankey, validasi topologi `diesel` (Tahap 8B), dan 0 pelanggaran em/en dash.
   - `next build` dan `tsc --noEmit` lulus bersih.
3. **Verifikasi Antarmuka Langsung (`AGENTS.md` Bagian 11):**
   - Menjalankan backend FastAPI dan frontend Next.js lokal.
   - Memeriksa **Mode Cepat (`/`)** dan **Halaman 1 sampai 10 (`/hybrid`)**: mengklik semua tab, grafik Sankey, Kurva Durasi, Kurva Degradasi, kanvas skema, skema aliran SVG (memastikan label pill tidak menyentuh tepi kotak `AC BUS`), dan penanda versi pada `AppHeader`.
   - Menguji navigasi keyboard penuh (`Skip link`, `Tab`, `ArrowLeft`/`ArrowRight` pada tablist, `Enter`/`Space`, panah kanvas, `Escape` pada toast).
   - Menguji viewport desktop dan mobile lebar **`360px`** (memastikan nol horizontal overflow pada `document.documentElement`), Mode Terang dan Mode Gelap penuh, serta konsol browser bersih dari error.

---

## 7. Keputusan Pemilik Proyek

Status konfirmasi keputusan Tahap 8:

1. **Pembagian PR Implementasi (Tahap 8A dan 8B):**
   **Disetujui** (2026-11-26). Dikerjakan **Tahap 8A** lebih dulu (pemolesan performa, perbaikan kontras & aksesibilitas WCAG AA, perbaikan visual `SystemSchematicSvg` + `AppHeader`, 3 grafik katalog 9.2, dan panduan pengguna), lalu dilanjutkan **Tahap 8B** (komponen baru lewat `EnergyComponent` dengan kenaikan `contract_version: "0.7"`).
2. **Penyesuaian 4 Token Warna Mode Terang untuk Kepatuhan WCAG AA:**
   **Disetujui** (2026-11-26). Penggelapan 4 warna di Mode Terang agar seluruh teks, chip status, dan label SVG lolos rasio kontras minimal `4,5:1` serta batas tombol `.ghost` lolos `3,0:1`:
   - `--success` & `--series-grid`: `#16A34A` menjadi `#15803D` (`5,02:1` di atas putih)
   - `--series-bess`: `#0EA5E9` menjadi `#0369A1` (`5,93:1` di atas putih)
   - `--series-biomass`: `#D97706` menjadi `#B45309` (`5,02:1` di atas putih)
   - Border `.btn.ghost`: memakai `--field-border` (`#6B7A90`, `4,36:1`) menggantikan `#B9B9F9` (`1,85:1`).
3. **Penambahan 3 Grafik Katalog `AGENTS.md` 9.2 (Nol Dependensi Baru):**
   **Disetujui** (2026-11-26). Menambahkan **Diagram Aliran Energi (Sankey)**, **Kurva Durasi Beban & Pembangkitan**, dan **Grafik Degradasi Kapasitas PV & BESS Umur Proyek** di Halaman 8 pada Tahap 8A.
4. **Pilihan Komponen Energi Tambahan Pertama (Tahap 8B):**
   **Menunggu konfirmasi pemilik proyek.** Dari tiga kandidat di `AGENTS.md` bagian 6 (**Diesel Generator**, **Turbin Angin / Wind**, atau **Hidro**), komponen mana yang ingin diprioritaskan pertama di Tahap 8B? *(Direkomendasikan: **Diesel Generator**, baru disusul Turbin Angin pada tahap berikutnya.)*
5. **Lokasi dan Akses Dokumentasi Pengguna:**
   **Disetujui ditambahkan di UI** (2026-11-26). Selain berkas `docs/user-guide-id.md` dan contoh CSV `examples/sample-load-8760.csv` di repositori, disediakan halaman ringkas **"Panduan"** di UI web (`/hybrid/guide`).
