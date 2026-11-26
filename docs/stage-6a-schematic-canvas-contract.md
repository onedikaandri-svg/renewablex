# Kontrak Tahap 6A: Kanvas Skema Sistem Interaktif dan Skema Aliran SVG

**Status dokumen:** Usulan untuk persetujuan pemilik proyek (belum ada perubahan kode implementasi maupun dependensi).
**Cabang usulan kontrak:** `docs/stage-6a-contract` (berbasis `main` setelah penggabungan Tahap 5, commit `3a995e6`).
**Cakupan:** Kanvas skema sistem interaktif di Halaman 4 (`/hybrid/[projectId]/system`), kesetaraan 100% konfigurasi kanvas terhadap payload JSON simulasi, kompatibilitas mundur proyek Tahap 5, serta peningkatan Skema SVG dengan angka aliran energi nyata di Dasbor Hasil Halaman 8.

---

## 1. Prinsip Kompatibilitas dan Batas Cakupan Tahap 6A

1. **Mode Cepat Screening PV tetap 100% utuh:**
   Halaman utama `/` serta endpoint backend `POST /v1/pv/preliminary`, `POST /v1/pv/sensitivity`, dan `GET /health` tidak diubah struktur data, validasi, maupun perilakunya.
2. **Kontrak API Backend Hybrid v0.5 tidak diubah:**
   Seluruh endpoint `/v1/hybrid/*` di `services/calculation-engine/app/api/hybrid.py` menggunakan validasi Pydantic ketat (`extra="forbid"`). Oleh karena itu, data tata letak visual kanvas (`topology`) **hanya** disimpan di objek proyek sisi frontend (`localStorage` serta berkas ekspor/impor proyek JSON) dan **tidak** dikirim ke payload permintaan `/v1/hybrid/simulate` maupun `/v1/hybrid/jobs`.
3. **Rumus energi dan keuangan hanya di backend:**
   Sesuai `AGENTS.md` bagian 3 dan 9.2, frontend dilarang menghitung ulang neraca daya, rugi PV, efisiensi baterai, atau metrik keuangan. Seluruh angka aliran energi pada Skema SVG di Halaman 8 dibaca langsung dari respons `HybridSimulateResponse` milik backend (`summary`, `bess_summary`, `biomass_summary`, dan `lifetime_summary.yearly[0]`), sementara frontend hanya memformat angka (`tabular-nums`) dan satuan tampilan (`MWh/thn` atau `kWh`).
4. **Batas terhadap Tahap 3B, 6B, dan 7:**
   - **Masuk Tahap 6A:** Kanvas skema sistem interaktif Halaman 4 (PV, BESS, Biomass, AC Bus, Beban, Grid), panel inspeksi parameter di samping kanvas, validasi topologi, kesetaraan kanvas vs JSON, serta render ulang Skema SVG beraliran nyata di Halaman 8.
   - **Tetap ditunda:** Tahap 3B (interpreter aturan EMS kustom JSON) dan Tahap 6B (editor EMS visual) tetap menunggu berkas skema EMS resmi dari pemilik proyek; Halaman 5 (`/hybrid/[projectId]/ems`) tetap memakai 5 strategi dispatch bawaan. Sapuan kombinasi, perbandingan banyak skenario, dan ekspor PDF/Excel penuh tetap di Tahap 7.

---

## 2. Skema Data Topologi Kanvas dan Kompatibilitas Mundur

### 2.1 Struktur `HybridSystemTopology` di `apps/web/lib/hybrid-types.ts`

Pada `HybridProjectConfig`, ditambahkan satu field opsional `topology?: HybridSystemTopology`. Selain itu, tipe `lifetime_summary` pada `HybridSimulateResponse` dilengkapi tipe `yearly` yang memang sudah dikirim oleh backend (`services/calculation-engine/app/hybrid/lifetime.py`) agar Halaman 8 dapat membaca `grid_import_kwh` dan `grid_export_kwh` Tahun 1 secara aman dan bertipe kuat.

```ts
export type TopologyNodeKind =
  | "ac_bus"
  | "pv"
  | "bess"
  | "biomass"
  | "load"
  | "grid";

export type TopologyEdgeFlowType =
  | "dc_ac_generation"
  | "bidirectional_storage"
  | "ac_generation"
  | "ac_load"
  | "bidirectional_grid";

export interface TopologyNode {
  id: string;
  kind: TopologyNodeKind;
  label?: string;
  x: number;
  y: number;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  flowType: TopologyEdgeFlowType;
}

export interface TopologyViewport {
  panX: number;
  panY: number;
  zoom: number;
}

export interface HybridSystemTopology {
  version: "1.0";
  viewport: TopologyViewport;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}
```

Penjelasan istilah teknis singkat:
- **Node:** Blok komponen di dalam kanvas (misalnya PV, BESS, AC Bus).
- **Edge:** Garis koneksi/kabel penghubung antara komponen dengan AC Bus.
- **Viewport (`panX`, `panY`, `zoom`):** Posisi geser kanvas dan tingkat perbesaran tampilan agar posisi kerja pengguna tetap tersimpan.

### 2.2 Contoh JSON `topology` (Ilustratif `[REAL DATA]`)

```json
{
  "version": "1.0",
  "viewport": { "panX": 0, "panY": 0, "zoom": 1 },
  "nodes": [
    { "id": "node-pv", "kind": "pv", "x": 60, "y": 40 },
    { "id": "node-bess", "kind": "bess", "x": 60, "y": 160 },
    { "id": "node-biomass", "kind": "biomass", "x": 60, "y": 280 },
    { "id": "node-ac-bus", "kind": "ac_bus", "x": 340, "y": 160 },
    { "id": "node-load", "kind": "load", "x": 600, "y": 100 },
    { "id": "node-grid", "kind": "grid", "x": 600, "y": 220 }
  ],
  "edges": [
    { "id": "edge-pv-bus", "source": "node-pv", "target": "node-ac-bus", "flowType": "dc_ac_generation" },
    { "id": "edge-bess-bus", "source": "node-bess", "target": "node-ac-bus", "flowType": "bidirectional_storage" },
    { "id": "edge-biomass-bus", "source": "node-biomass", "target": "node-ac-bus", "flowType": "ac_generation" },
    { "id": "edge-bus-load", "source": "node-ac-bus", "target": "node-load", "flowType": "ac_load" }
  ]
}
```

### 2.3 Kompatibilitas Mundur dengan Proyek Tahap 5 dan Kesiapan Tahap 8

1. **Menerima berkas proyek lama (`schemaVersion: "0.5"`):**
   Fungsi `listProjects`, `getProject`, dan `importProjectJson` di `apps/web/lib/hybrid-storage.ts` akan menerima baik proyek dengan `schemaVersion: "0.5"` (tanpa field `topology`) maupun proyek baru `schemaVersion: "0.6"` (dengan field `topology`).
2. **Derivasi otomatis (`deriveDefaultTopology(project)`):**
   Jika proyek tidak memiliki field `topology` (misalnya berkas JSON ekspor dari Tahap 5 atau data lama di `localStorage`), fungsi deterministik `deriveDefaultTopology(project)` membangun daftar `nodes` dan `edges` standar secara otomatis berdasarkan nilai `components.pv.enabled`, `components.bess.enabled`, `components.biomass.enabled`, serta `simulation.dispatch_params.allow_grid_import || allow_grid_export`.
3. **Kesiapan komponen Tahap 8:**
   Model berbasis array `nodes` dan `edges` dengan `kind` dan `flowType` terbuka untuk penambahan jenis komponen baru di Tahap 8 (misalnya `wind`, `diesel`, `hydro`, atau `dc_bus`) tanpa perlu mengubah struktur penyimpanan proyek dari awal.

---

## 3. Aturan Validasi Topologi dan Sinkronisasi Dua Arah Kanvas vs State Proyek

### 3.1 Aturan Sinkronisasi Kanvas Halaman 4, Parameter Proyek, dan Halaman 5 (EMS)

Pada kontrak mesin v0.5, sistem memiliki maksimal 1 unit per jenis komponen (`pv`, `bess`, `biomass`, `load`, `grid`) yang terhubung ke 1 `ac_bus`. Perubahan di kanvas langsung menyinkronkan state proyek (`HybridProjectConfig`) secara deterministik agar Halaman 5 (EMS), Halaman 6 (Ekonomi), dan Halaman 7 (Jalankan) selalu konsisten:

| Komponen (`kind`) | Sifat di v0.5 | Ketika Terhubung ke `ac_bus` | Ketika Kabel Diputus atau Dihapus dari Kanvas | Sinkronisasi jika Diubah di Halaman Lain |
|---|---|---|---|---|
| `ac_bus` | Wajib (1 unit) | Pusat distribusi daya AC tempat seluruh sumber dan beban bermuara. | Tidak diizinkan dihapus (atau memicu galat `missing_ac_bus` bila diedit lewat JSON). | Selalu ada di topologi bawaan. |
| `pv` | Wajib (1 unit) | `components.pv.enabled = true`. | `components.pv.enabled = false` dan memicu galat validasi `pv_not_connected` / `missing_pv_node` (simulasi diblokir). | Nilai parameter PV langsung tercermin di label node PV. |
| `load` | Wajib (1 unit) | Mengambil profil beban dari Halaman 3 (`load_profile`). | Memicu galat validasi `load_not_connected` / `missing_load_node` (simulasi diblokir). | Perubahan beban di Halaman 3 langsung diperbarui pada label node Beban. |
| `bess` | Opsional (maks. 1) | `components.bess.enabled = true`. | `components.bess.enabled = false`. Angka kapasitas/efisiensi terakhir di `components.bess` **tetap dipertahankan** agar tidak hilang jika pengguna memasang ulang BESS. | Mengaktifkan/menonaktifkan BESS di state proyek menyinkronkan node/kabel BESS di kanvas. |
| `biomass` | Opsional (maks. 1) | `components.biomass.enabled = true`. | `components.biomass.enabled = false`. Angka sampel/bahan bakar terakhir di `components.biomass` **tetap dipertahankan**. | Perubahan sampel/preset biomass di state proyek langsung memperbarui label node. |
| `grid` | Opsional (maks. 1) | Jika `allow_grid_import` dan `allow_grid_export` keduanya `false`, otomatis menyetel `allow_grid_import = true`. Jika salah satu atau keduanya sudah `true`, dipertahankan. | Menyetel `allow_grid_import = false` dan `allow_grid_export = false` (sistem menjadi terisolasi / off-grid). | Jika pengguna menyalakan/mematikan izin impor atau ekspor grid di Halaman 5 (EMS), status node/kabel `grid` di Halaman 4 ikut tersinkron saat dibuka kembali. |

### 3.2 Aturan Validasi Topologi (`validateSystemTopology(project)`)

Validasi dijalankan langsung setiap kali topologi atau parameter berubah (baik lewat kanvas, panel inspeksi, maupun sebelum simulasi dijalankan di Halaman 7). Keluaran validasi terbagi menjadi dua tingkat dengan kode stabil:

1. **Galat pemblokir (`errors`, banner merah, tombol "Jalankan Simulasi" di Halaman 7 dinonaktifkan sampai diperbaiki):**
   - `missing_ac_bus`: Tidak terdapat node `ac_bus` pada skema.
   - `missing_pv_node`: Komponen wajib Solar PV belum ada di kanvas.
   - `pv_not_connected`: Node Solar PV ada di kanvas tetapi belum terhubung ke `ac_bus`.
   - `missing_load_node`: Node Beban Listrik belum ada di kanvas.
   - `load_not_connected`: Node Beban Listrik ada di kanvas tetapi belum terhubung ke `ac_bus`.
   - `invalid_edge_connection`: Koneksi ilegal (misalnya menghubungkan dua node non-bus secara langsung seperti PV ke BESS tanpa melalui AC Bus, menghubungkan node ke dirinya sendiri, atau membuat dua kabel identik/duplikat).
   - `invalid_component_params`: Parameter fisik komponen aktif tidak sah (contoh: `pv.capacity_kwp <= 0`, `pv.inverter_ac_kw <= 0`, `bess.nominal_capacity_kwh <= 0`, `bess.max_charge_kw <= 0`, `bess.soc_min_fraction >= bess.soc_max_fraction`, `biomass.rated_capacity_kw <= 0`).
2. **Peringatan informatif (`warnings`, banner kuning, simulasi tetap boleh dijalankan):**
   - `disconnected_optional_node`: Node opsional (`bess`, `biomass`, atau `grid`) sudah diletakkan di kanvas tetapi kabelnya belum dihubungkan ke `ac_bus`. Pada simulasi, komponen tersebut diperlakukan nonaktif (`enabled = false` atau grid off-grid) sampai kabelnya disambungkan.
   - `pv_dc_ac_ratio_warning`: Rasio kapasitas DC PV terhadap AC inverter berada di luar rentang lazim (`< 0,8` atau `> 1,6`), memberi informasi potensi clipping berlebih atau ukuran inverter terlalu besar.

---

## 4. Strategi Pengujian Kesetaraan Kanvas vs JSON (`AGENTS.md` Bagian 10)

Sesuai kriteria selesai Tahap 6 pada `AGENTS.md` bagian 10: *"konfigurasi dari kanvas menghasilkan simulasi yang sama dengan konfigurasi JSON"*. Pembuktian dilakukan melalui dua lapis pengujian otomatis:

1. **Lapisan 1: Pengujian Unit dan Integrasi Frontend (`apps/web/lib/hybrid-topology.test.ts` via Vitest):**
   - Menyusun konfigurasi proyek dari awal menggunakan fungsi aksi kanvas murni (`createInitialTopology`, `addTopologyNode`, `connectTopologyNodes`, `moveTopologyNode`, `disconnectTopologyEdge`, `removeTopologyNode`, serta pembaruan parameter inspektor) untuk 4 skenario kombinasi:
     1. PV + Beban (off-grid dasar).
     2. PV + BESS + Beban.
     3. PV + BESS + Biomass + Beban (off-grid hybrid penuh).
     4. PV + BESS + Biomass + Grid + Beban (on-grid).
   - Membandingkan hasil `buildHybridSimulatePayload(canvasProject)` terhadap `buildHybridSimulatePayload(manualJsonProject)` menggunakan kesamaan struktural mendalam (`toEqual`), memastikan **100% identik** dan tidak ada field visual `topology` yang bocor ke payload API.
   - Menguji **invariansi tata letak**: menggeser posisi koordinat node (`x`, `y`), mengubah `zoom`/`panX`/`panY`, atau mereset tata letak tidak mengubah satu bit pun payload `buildHybridSimulatePayload`.
   - Menguji **kompatibilitas mundur**: mengimpor JSON proyek Tahap 5 (`schemaVersion: "0.5"` tanpa `topology`) tetap menghasilkan topologi bawaan yang valid dan payload simulasi identik.
2. **Lapisan 2: Pengujian Kesetaraan Hasil Mesin Hitung Backend (`pytest`):**
   - Mengonfirmasi melalui tes endpoint atau layanan simulasi bahwa dua payload (satu dari jalur kanvas, satu dari JSON manual) menghasilkan `config_hash` yang identik, sehingga seluruh keluaran energi (`summary`, `monthly`, `hourly_year_1`) dan keuangan (`finance_summary`, `cashflow_schedule`) memiliki selisih tepat `0.0`.

---

## 5. Evaluasi Jujur Pilihan Implementasi Kanvas (Diet Paket `AGENTS.md` Bagian 4 dan 11)

Saat ini `apps/web/package.json` memakai Next.js `^16.4.6`, React `^19.3.1`, TypeScript `^7.0.2`, dan `echarts ^6.1.0`. Berikut perbandingan jujur dua pendekatan untuk membangun kanvas skema interaktif Tahap 6A:

| Kriteria | Opsi A: Kanvas SVG + Web Pointer Events Buatan Sendiri (Direkomendasikan) | Opsi B: `@xyflow/react` (React Flow v12, Lisensi MIT) |
|---|---|---|
| **Kepatuhan Diet Paket (`AGENTS.md` 4 & 11)** | **Nol dependensi baru.** Memakai API browser dan SVG bawaan. Tidak butuh PR dependensi terpisah. | Menambah 1 paket utama (`@xyflow/react`) beserta CSS dan sub-dependensi internal (`d3-zoom`, `d3-drag`, `zustand`). Wajib PR dependensi terpisah sebelum PR kode. |
| **Berbagi Renderer dengan Halaman 8 & PDF Tahap 7** | **Satu mesin SVG bersama.** Geometri node, port, dan routing kabel yang sama persis dipakai ulang oleh Kanvas Halaman 4 (mode interaktif) dan `SystemSchematicSvg` di Halaman 8 (mode ringkasan aliran daya + siap ekspor PDF). | `@xyflow/react` merender node sebagai elemen HTML `<div>` di atas lapisan kanvas DOM. Untuk Skema SVG rapi di Halaman 8 dan ekspor PDF Tahap 7, pengembang tetap harus menulis renderer SVG terpisah. |
| **Kompatibilitas Stack (React 19.3 + TS 7)** | Tidak ada risiko konflik peer dependency atau tipe TypeScript 7. | Perlu verifikasi runtime terhadap React 19.3 dan TypeScript 7 pada PR dependensi. |
| **Ukuran Bundel** | Sangat ringan (hanya beberapa ratus baris modul TypeScript lokal). | Menambah puluhan KB JavaScript + stylesheet eksternal di bundel Halaman 4. |
| **Kemampuan Fitur Kanvas** | Cukup dan presisi untuk skema energi hybrid RenewableX (6 jenis node pada v0.5, drag-and-drop grid 20px, sambung/putus koneksi ke AC Bus, zoom, pan, reset tata letak). | Unggul jika kelak editor berkembang menjadi graf bebas dengan puluhan sub-bus, minimap, dan seleksi kotak multi-node. |
| **Aksesibilitas Keyboard & Mobile `360px`** | Kontrol penuh sejak awal atas urutan `Tab`, geser posisi dengan tombol panah, `aria-live`, dan transisi mulus ke mode ringkas `360px`. | Membutuhkan kustomisasi CSS dan override handler agar nyaman di layar `360px` dan serasi dengan token tema terang/gelap RenewableX. |

**Kesimpulan evaluasi:** Karena cakupan Tahap 6A memiliki topologi star terpusat pada `AC Bus` dengan 6 jenis komponen yang terdefinisi jelas, serta Halaman 8 dan ekspor PDF Tahap 7 membutuhkan keluaran SVG murni yang identik dengan kanvas, **Opsi A** memberikan rasio kesederhanaan, konsistensi visual, performa, dan kepatuhan Diet Paket terbaik. Jika pada tahap masa depan (misalnya Tahap 8 ke atas) pengguna memerlukan multi-bus bertingkat dengan puluhan node, struktur data `HybridSystemTopology` (`nodes`/`edges`/`viewport`) pada kontrak ini sudah kompatibel untuk bermigrasi ke pustaka graf eksternal tanpa mengubah format proyek tersimpan.

---

## 6. Rancangan Antarmuka, Panel Inspeksi, Mobile `360px`, Aksesibilitas, dan Tema

### 6.1 Tata Letak Desktop (`>= 1024px`)

- **Bilah Alat Kanvas (Toolbar):** Terletak di atas area kerja kanvas, berisi:
  - Palet tombol aksi spesifik untuk komponen opsional yang belum ada di kanvas (misalnya **"Tambah BESS"**, **"Tambah Biomass"**, **"Tambah Grid"**). Jika komponen sudah ada, tombol menampilkan status terpasang atau menyorot node tersebut saat diklik.
  - Kontrol navigasi kanvas: **"Perbesar (+)"**, **"Perkecil (-)"**, tampilan persentase zoom (`tabular-nums`), dan **"Reset Tata Letak"**.
  - Indikator status topologi ringkas (chip hijau **"Topologi Valid"** atau chip merah/kuning dengan jumlah galat/peringatan).
- **Area Kanvas Interaktif (~62% lebar desktop):**
  - Latar berpola grid titik halus dengan *snap-to-grid* 20px saat node digeser (*drag-and-drop*) memakai Web Pointer Events (`setPointerCapture`) sehingga gerakan mulus baik memakai mouse maupun layar sentuh.
  - Menyeret area kosong kanvas melakukan geser (*pan*); gulir roda mouse dengan `Ctrl` atau tombol `+`/`-` mengubah tingkat zoom antara `60%` sampai `160%`.
  - Menghubungkan komponen ke `AC Bus` dapat dilakukan lewat **dua cara** agar tidak menyulitkan pengguna awam: (1) menyeret titik port koneksi komponen menuju `AC Bus`, atau (2) memilih komponen lalu menekan tombol **"Hubungkan ke AC Bus"** / **"Putuskan Koneksi"** di panel inspeksi.
- **Panel Inspeksi Parameter (~38% lebar desktop):**
  - Saat pengguna mengeklik atau memilih sebuah node pada kanvas, panel kanan langsung menampilkan parameter komponen tersebut memakai `RangeNumberField` (angka tersinkron slider dua arah) dan validasi langsung per field.
  - Komponen yang dapat diinspeksi:
    - **Solar PV:** Model simulasi (`detailed_v1` / `pvwatts_v1`), kapasitas DC (kWp), kapasitas AC inverter (kW), kemiringan (tilt), azimuth, model transposisi, mode tracking.
    - **BESS:** Kapasitas nominal (kWh), daya charge/discharge maks (kW), batas SOC min/maks (%), efisiensi, status koneksi AC Bus.
    - **Biomass:** Sampel pembangkit `[REAL DATA]`, kapasitas terpasang (kW), preset bahan bakar `[REAL DATA]`, periode dan batas pasokan, status koneksi AC Bus.
    - **Beban Listrik:** Ringkasan mode (`Sintetis` atau `CSV`) dan beban puncak dari Halaman 3, serta tautan langsung **"Ubah Profil Beban di Halaman 3"**.
    - **Jaringan Listrik (Grid):** Toggle izin impor dan ekspor listrik, ringkasan tarif impor/ekspor dari Halaman 6, serta status koneksi AC Bus.
    - **AC Bus:** Daftar koneksi aktif yang terhubung ke bus, strategi EMS aktif saat ini (tautan ke Halaman 5), dan ringkasan status validasi topologi.

### 6.2 Mode Ringkas Layar Mobile (`360px` sampai `< 768px`)

Untuk menjaga aturan `AGENTS.md` 9.3 dan `DESIGN.md` 4.2 (nyaman mulai lebar `360px` tanpa horizontal overflow, target sentuh minimal `44px`):
1. Halaman memakai satu kolom vertikal penuh tanpa gulir mendatar pada `document.documentElement`.
2. Di bagian atas tampil **Pratinjau Skema SVG Ringkas** (*auto-fit* responsif) tempat pengguna mengetuk node untuk memilih komponen atau memantau koneksi, lengkap dengan tombol zoom dan **"Reset Tata Letak"** berukuran minimal `44px x 44px`.
3. Di bawah SVG tampil **Daftar Kartu Komponen Ringkas** bertumpuk vertikal. Setiap kartu menampilkan status koneksi ke AC Bus dan tombol aksi spesifik berlabel jelas berukuran minimal `44px` tinggi (misalnya **"Hubungkan ke AC Bus"**, **"Putuskan"**, **"Hapus"**, **"Atur Parameter"**), sehingga pengguna layar sempit tidak dipaksa melakukan *drag-and-drop* kabel yang sulit di layar `360px`.
4. Di bawah daftar atau langsung saat komponen dipilih tampil **Panel Inspeksi Parameter** yang sama dengan desktop.

### 6.3 Aksesibilitas Keyboard dan Pembaca Layar

- Tidak ada penggunaan `focus:outline-none` tanpa pengganti; seluruh node kanvas, port, dan tombol memakai cincin fokus `:focus-visible` berketebalan jelas yang memenuhi kontras WCAG AA.
- Urutan `Tab` berjalan logis: Toolbar -> Node-node di kanvas -> Panel Inspeksi.
- Saat fokus berada pada node di kanvas:
  - `Enter` atau `Space` memilih node tersebut dan memperbarui panel inspeksi.
  - Tombol panah (`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`) memindahkan posisi node sebesar `20px` (`40px` bila menahan `Shift`) dan mengumumkan koordinat baru lewat region `aria-live="polite"`.
  - `Delete` atau `Backspace` menghapus node opsional yang sedang terpilih (dengan pengumuman status di `aria-live="polite"`).
- Tersedia ringkasan teks terstruktur (atau tabel koneksi alternatif yang dapat diakses keyboard/pembaca layar) yang mencantumkan setiap komponen, status aktifnya, dan status hubungannya ke AC Bus.

### 6.4 Dukungan Tema Terang dan Gelap Penuh

Seluruh warna garis, latar kanvas, grid titik, kotak node, penanda seleksi, dan status validasi wajib memakai token CSS semantik `DESIGN.md` (`--bg`, `--surface`, `--surface-subtle`, `--ink`, `--ink-strong`, `--muted`, `--border`, `--field-border`, `--accent`, `--series-pv`, `--series-bess`, `--series-biomass`, `--series-load`, `--series-grid`, `--series-unmet`, `--success`, `--errtext`, `--warntext`). Saat pengguna mengganti toggle Mode Terang / Gelap di header, kanvas SVG di Halaman 4 maupun Skema Aliran SVG di Halaman 8 berubah seketika dan tetap lolos rasio kontras WCAG AA (`>= 4,5:1` teks, `>= 3:1` kontrol/grafik) yang diverifikasi lewat `apps/web/lib/contrast.test.ts`.

---

## 7. Skema SVG Rapi dengan Angka Aliran Nyata di Dasbor Hasil (Halaman 8) dan Kesiapan PDF

### 7.1 Perilaku Render Ulang di Halaman 8 (`SystemSchematicSvg.tsx`)

Komponen `SystemSchematicSvg` ditingkatkan agar tidak lagi sekadar menggambar 5 posisi kotak statis, melainkan:
1. Membaca koordinat `nodes` dan koneksi `edges` dari `project.topology` (atau fallback `deriveDefaultTopology(project)` untuk proyek lama Tahap 5), lalu menghitung batas pembungkus (*bounding box*) secara otomatis agar `viewBox` SVG selalu pas, simetris, dan tidak terpotong berapa pun pengguna menggeser posisi node di Halaman 4.
2. Menampilkan garis penghubung berpanah arah aliran daya nyata dengan ketebalan proporsional terhadap status aktif dan warna seri `DESIGN.md`:
   - **PV -> AC Bus:** Menampilkan `summary.pv_generation_kwh` dalam `MWh/thn` (serta catatan curtailment `summary.curtailment_kwh` bila `> 0`), dengan kapasitas DC/AC sebagai sub-label.
   - **BESS <-> AC Bus:** Menampilkan panah dua arah beserta `bess_summary.total_charge_kwh` (masuk ke BESS) dan `bess_summary.total_discharge_kwh` (keluar ke AC Bus) dalam `MWh/thn`, ditambah jumlah siklus `bess_summary.equivalent_full_cycles` (EFC). Bila nonaktif, tampil penanda "Nonaktif" tanpa angka palsu.
   - **Biomass -> AC Bus:** Menampilkan `biomass_summary.total_generation_kwh` (`MWh/thn`) beserta jam operasi (`biomass_summary.total_operating_hours`) dan konsumsi bahan bakar (`biomass_summary.total_fuel_tons`). Bila nonaktif, tampil penanda "Nonaktif".
   - **AC Bus -> Beban Listrik:** Menampilkan `summary.served_load_kwh` (`MWh/thn`), serta penanda status merah/peringatan untuk `summary.unmet_load_kwh` apabila terdapat beban tidak terpenuhi (`> 0`).
   - **AC Bus <-> Grid:** Membaca `lifetime_summary.yearly[0]?.grid_import_kwh` dan `lifetime_summary.yearly[0]?.grid_export_kwh` dalam `MWh/thn` (atau penanda `Off-grid / Terisolasi` bila grid nonaktif/tidak terhubung).
3. Menyediakan tiga keadaan wajib (`kosong / belum disimulasikan` yang menampilkan ukuran desain terpasang, `memuat`, dan `galat` bila hasil tidak lengkap) serta teks `aria-label` lengkap yang merangkum seluruh aliran energi.

### 7.2 Kesiapan Ekspor PDF pada Tahap 7

Agar skema SVG hasil Halaman 8 dapat langsung disematkan ke laporan PDF pada Tahap 7 tanpa ditulis ulang:
- Seluruh elemen di dalam `SystemSchematicSvg` wajib **SVG murni** (`<rect>`, `<path>`, `<line>`, `<polygon>`, `<text>`, `<g>`) tanpa menyisipkan elemen `<foreignObject>` HTML yang sering gagal dirender saat konversi SVG ke kanvas/PDF.
- Sediakan fungsi bantu murni (misalnya `serializeSchematicSvgWithLightTheme`) yang menyertakan atribut ukuran eksplisit dan memetakan token CSS ke nilai hex tema cetak terang (`DESIGN.md` bagian 2.1 & 2.3) agar SVG tetap tajam saat dicetak atau diekspor di Tahap 7.

---

## 8. Kriteria Selesai dan Rencana Verifikasi Tahap 6A

PR implementasi kode Tahap 6A (setelah kontrak ini disetujui) baru boleh dinyatakan selesai apabila seluruh kriteria berikut lulus:

1. **Tes Backend (`pytest`):**
   `cd services/calculation-engine && pytest` lulus 100% (memastikan seluruh 212+ tes backend termasuk `/v1/pv/*` dan `/v1/hybrid/*` tetap hijau tanpa regresi).
2. **Tes & Build Frontend (`npm test && npm run build`):**
   `cd apps/web && npm test && npm run build` lulus 100%, mencakup tes unit baru untuk topologi kanvas, validasi topologi, sinkronisasi dua arah, kompatibilitas mundur proyek Tahap 5, serta bukti tes kesetaraan payload kanvas vs JSON (`hybrid-topology.test.ts`).
3. **Verifikasi Antarmuka Langsung:**
   - Menjalankan aplikasi web dan backend lokal, lalu menguji langsung alur Halaman 4 -> Halaman 5 -> Halaman 7 -> Halaman 8:
     - Menambah, memindahkan (*drag-and-drop*), menghubungkan, memutuskan, dan menghapus komponen opsional di kanvas, serta menguji kontrol zoom/pan/reset tata letak.
     - Memeriksa panel inspeksi parameter di kanan kanvas dan validasi topologi (memutus PV atau Beban memblokir simulasi dengan pesan yang jelas).
     - Memverifikasi navigasi keyboard penuh (`Tab`, panah, `Enter`, `Delete`).
     - Memverifikasi tampilan responsif pada layar desktop dan mobile lebar `360px` tanpa horizontal overflow.
     - Memverifikasi Mode Terang dan Mode Gelap di Halaman 4 dan Halaman 8, serta memastikan konsol browser bebas dari error.
   - Melaporkan hasil verifikasi per elemen secara jujur pada deskripsi PR.

---

## 9. Pertanyaan Keputusan untuk Pemilik Proyek

Sebelum masuk ke pembuatan PR implementasi Tahap 6A (atau PR dependensi jika memilih Opsi B), mohon konfirmasi pemilik proyek untuk 4 keputusan berikut:

1. **Pilihan implementasi kanvas (Evaluasi Bagian 5):**
   - **Opsi A (Direkomendasikan):** Kanvas SVG + Web Pointer Events buatan sendiri tanpa dependensi baru, sehingga berbagi satu mesin renderer SVG dengan Skema Aliran Halaman 8 dan ekspor PDF Tahap 7.
   - **Opsi B:** Memakai pustaka eksternal `@xyflow/react` melalui PR dependensi terpisah terlebih dahulu (dengan konsekuensi tetap membangun renderer SVG terpisah untuk Halaman 8 dan PDF Tahap 7).
2. **Perlakuan node opsional (`BESS`, `Biomass`, `Grid`) yang ada di kanvas tetapi kabelnya belum dihubungkan ke `AC Bus`:**
   - **Pilihan 2a (Direkomendasikan):** Tampilkan **peringatan kuning (non-blokir)** yang menjelaskan bahwa komponen belum terhubung sehingga diperlakukan nonaktif saat simulasi, namun simulasi tetap boleh dijalankan.
   - **Pilihan 2b:** Tampilkan **galat merah (memblokir simulasi)** sampai pengguna menghubungkan kabelnya ke `AC Bus` atau menghapus komponen tersebut dari kanvas.
3. **Penghapusan komponen wajib (`AC Bus`, `Solar PV`, `Beban Listrik`) di kanvas:**
   - **Pilihan 3a (Direkomendasikan):** Komponen wajib **dikunci agar tidak bisa dihapus** dari kanvas (hanya bisa dipindah dan diatur parameternya), sementara kabel koneksinya tetap bisa diputus untuk menguji dan melihat validasi topologi.
   - **Pilihan 3b:** Semua komponen termasuk `PV` dan `Beban` **boleh dihapus** dari kanvas, lalu memicu galat validasi pemblokir sampai pengguna menambahkannya kembali lewat palet.
4. **Periode angka aliran energi pada Skema SVG di Dasbor Hasil (Halaman 8):**
   - **Pilihan 4a (Direkomendasikan):** Menampilkan total energi **Tahun 1 (`MWh/thn`)** agar konsisten langsung dengan grafik energi bulanan dan diagram waterfall rugi PV di tab yang sama.
   - **Pilihan 4b:** Menyediakan tombol pilih ringkas (**Tahun 1** vs **Akumulasi Umur Proyek 25 Tahun**) langsung di header kartu Skema SVG Halaman 8.
