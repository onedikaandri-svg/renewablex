# Kontrak Tahap 5: UI Inti Next.js dan Integrasi Endpoint Hybrid

**Status dokumen:** Disetujui pemilik proyek (keputusan Bagian 6 telah dikonfirmasi).
**Cakupan:** Integrasi endpoint HTTP FastAPI untuk mesin simulasi hybrid (Tahap 1 sampai 4), penyesuaian middleware ukuran badan permintaan dan kompresi respons, rancangan arsitektur antarmuka web Next.js 16 untuk alur halaman 1 sampai 7 dan dasbor hasil dasar (Halaman 8) beserta tiga keadaan wajib (kosong, memuat, galat), serta evaluasi pilihan pustaka grafik.

---

## 1. Prinsip Kompatibilitas dan Batasan Tahap 5

1. **Mode cepat screening PV tetap 100% utuh:**
   Endpoint screening PV tahunan (`POST /v1/pv/preliminary` dan `POST /v1/pv/sensitivity`), pemeriksaan kesehatan layanan (`GET /health`), serta halaman utama mode cepat (`/`) pada `apps/web/` tidak diubah struktur JSON, perilaku validasi, maupun perhitungannya.
2. **Rumus hanya di backend:**
   Sesuai `AGENTS.md` bagian 3 dan 9.2, frontend dilarang keras menghitung ulang rumus energi atau keuangan (NPV, IRR, LCOE, payback, neraca daya per jam, degradasi, maupun agregasi bulanan). Frontend hanya menampilkan angka dari mesin hitung backend, memformat tampilan angka (`tabular-nums`), memilih satuan tampilan, dan menyederhanakan jumlah titik grafik (decimation) bila diperlukan agar grafik tetap ringan.
3. **Data jujur dan bersumber jelas:**
   Seluruh angka bawaan atau sampel (lokasi, preset bahan bakar, sampel pembangkit, asumsi ekonomi) bersumber dari `docs/assumptions.md` dan diberi label `[REAL DATA]` sampai pemilik proyek menetapkan data resmi atau datasheet nyata. Tidak boleh ada angka karangan atau statistik palsu di antarmuka.
4. **Batas cakupan Tahap 5 terhadap Tahap 3B, 6, dan 7:**
   - **Masuk Tahap 5 (UI inti & integrasi endpoint hybrid):** Enam endpoint HTTP hybrid baru di FastAPI, alur halaman 1 sampai 7 (Halaman 4 memakai panel konfigurasi komponen beserta pratinjau skema blok sistem SVG otomatis, dan Halaman 5 memakai 5 strategi dispatch bawaan), serta Halaman 8 berupa dasbor hasil dasar (KPI, energi bulanan bertumpuk, waterfall rugi PV, dispatch harian/mingguan + kurva SOC baterai, peta panas 8.760 jam, arus kas tahunan & kumulatif, rincian LCOE, dan ekspor JSON/CSV).
   - **Ditunda ke tahap berikutnya:** Interpreter aturan dan editor visual EMS kustom berbasis JSON (Tahap 3B dan Tahap 6, menunggu berkas EMS terpisah dari pemilik di GitHub), kanvas skema interaktif tarik-lepas (drag-and-drop) di Tahap 6, serta sapuan kombinasi gaya HOMER, perbandingan banyak skenario berdampingan, tornado sensitivitas hybrid, dan laporan PDF/Excel penuh di Tahap 7.

---

## 2. Kontrak Endpoint API Hybrid Baru (`services/calculation-engine/app/api/hybrid.py`)

Saat kontrak ini disetujui dan diimplementasikan, versi mesin (`ENGINE_VERSION` di `app/version.py`) akan naik dari `"0.4.0"` menjadi `"0.5.0"` dengan `contract_version: "0.5"`.

Seluruh skema masukan memakai validasi ketat Pydantic (`extra="forbid"`) sehingga field yang tidak dikenal ditolak dengan jelas. Seluruh galat validasi, `EngineError`, dan `ResourceError` mengembalikan HTTP `422` dengan format `detail` standar yang membawa `code` stabil (konsisten dengan `docs/api.md`), sehingga frontend selalu bercabang berdasarkan `code`, bukan berdasarkan teks `msg`.

### 2.1 Daftar Endpoint Baru (Tidak Mengubah `/v1/pv/*`)

| Metode | Jalur (Path) | Peran Utama |
|---|---|---|
| `GET` | `/v1/hybrid/presets` | Mengembalikan katalog `fuel_presets` (5 preset biomassa: `efb`, `wood_pellet`, `pks`, `woodchip`, `rice_husk`), `plant_samples` (`sample_gasifier_250kw`, `sample_steam_turbine_1000kw`), daftar 5 strategi dispatch bawaan beserta parameter standarnya, dan nilai sampel acuan `[REAL DATA]` agar frontend tidak menyimpan angka hardcode terpisah. |
| `POST` | `/v1/hybrid/weather/preview` | Mengambil dan memvalidasi data cuaca per jam berdasarkan `latitude`, `longitude`, `timezone`, dan `weather_source` (default `"pvgis_tmy"`). Mengembalikan metadata sumber cuaca (`provider`, `dataset`, `dataset_version`, `period`, `elevation_m`, `timezone`), ringkasan tahunan (total GHI, DNI, DHI dalam kWh/m2/tahun, suhu rata-rata/min/maks dalam C, kecepatan angin rata-rata dalam m/s), dan ringkasan 12 bulan untuk pratinjau di Halaman 2. |
| `POST` | `/v1/hybrid/load/preview` | Menerima `time_config` (`step_minutes`, `timezone`) dan `load_profile` (`mode`: `"synthetic"` atau `"csv"` dengan `csv_text`). Mengembalikan ringkasan beban (`total_load_kwh`, `peak_load_kw`, `average_load_kw`, `load_factor`), profil harian rata-rata 24 jam (`avg_kw`, `min_kw`, `max_kw`), ringkasan 12 bulan, dan deret per jam `hourly_load_kw` (dibulatkan 3 desimal) untuk peta panas 365 x 24 di Halaman 3. |
| `POST` | `/v1/hybrid/simulate` | Menjalankan simulasi hybrid lengkap secara langsung (sinkron) dan mengembalikan ringkasan teknis, rugi PV, agregasi bulanan, hasil multi-tahun, ringkasan keuangan, rincian LCOE, emisi, jadwal arus kas, serta deret waktu Tahun 1 bila diminta lewat `output_options.include_hourly`. Cocok untuk simulasi 1 tahun, mode `"scaled_year_1"`, atau `"full_hourly"` dengan umur pendek. |
| `POST` | `/v1/hybrid/jobs` | Mendaftarkan simulasi asinkron (antrean background) untuk simulasi `"full_hourly"` multi-tahun (misalnya 25 sampai 40 tahun) agar permintaan HTTP tidak terkena batas waktu (timeout) di server gratis Render. Mengembalikan HTTP `202` berisi `job_id`, `status: "queued"`, dan `progress_percent: 0`. |
| `GET` | `/v1/hybrid/jobs/{job_id}` | Memeriksa status job (`queued`, `running`, `completed`, `failed`), `progress_percent` (0 sampai 100), `current_step_label` (contoh: `"Menjalankan tahun 12 dari 25"`), `result` lengkap (identik dengan respons `/v1/hybrid/simulate` saat `completed`), atau `error` terstruktur saat `failed`. Pada Tahap 5 penyimpan job berjalan di memori proses dengan batas retensi (TTL 30 menit, maksimal 50 job tersimpan), sambil menyiapkan antarmuka yang cocok dengan tabel `simulation_runs` Supabase pada tahap persistensi cloud. |

### 2.2 Contoh JSON Request `POST /v1/hybrid/simulate` (dan `POST /v1/hybrid/jobs`)

Seluruh angka pada contoh berikut bersifat **sampel ilustratif (`[REAL DATA]`)** mengikuti `docs/assumptions.md` dan kontrak Tahap 1 sampai 4:

```json
{
  "contract_version": "0.5",
  "project": {
    "project_name": "Pabrik Hybrid Cikarang [REAL DATA]",
    "latitude": -6.28,
    "longitude": 107.15,
    "elevation_m": 25.0,
    "timezone": "Asia/Jakarta",
    "currency_code": "IDR"
  },
  "simulation": {
    "step_minutes": 60,
    "leap_day_policy": "ignore_feb_29",
    "weather_source": "pvgis_tmy",
    "dispatch_strategy": "load_following",
    "dispatch_params": {
      "allow_grid_import": false,
      "allow_grid_export": false,
      "target_soc_fraction": 0.8
    },
    "project_lifetime_years": 25,
    "multi_year_mode": "scaled_year_1"
  },
  "load_profile": {
    "mode": "synthetic",
    "base_load_kw": 120.0,
    "peak_load_kw": 350.0,
    "seed": 42,
    "noise_fraction": 0.05
  },
  "components": {
    "pv": {
      "enabled": true,
      "model": "detailed_v1",
      "capacity_kwp": 500.0,
      "inverter_ac_kw": 420.0,
      "transposition_model": "perez",
      "tracking_mode": "fixed",
      "tilt_degrees": 10.0,
      "azimuth_degrees": 0.0,
      "cell_temp_model": "faiman",
      "dc_model": "pvwatts",
      "annual_degradation_fraction": 0.005
    },
    "bess": {
      "enabled": true,
      "nominal_capacity_kwh": 600.0,
      "max_charge_kw": 300.0,
      "max_discharge_kw": 300.0,
      "soc_min_fraction": 0.2,
      "soc_max_fraction": 0.95,
      "initial_soc_fraction": 0.5,
      "replacement_cost": 1800000000.0
    },
    "biomass": {
      "enabled": true,
      "plant_sample": "sample_gasifier_250kw",
      "fuel_preset": "efb",
      "supply_period": "monthly",
      "supply_limit_tons": 220.0,
      "overhaul_cost": 150000000.0
    }
  },
  "finance": {
    "tax_model": "pre_tax",
    "revenue_mode": "avoided_cost",
    "discount_rate": 0.1,
    "tariff_escalation_rate": 0.02,
    "om_escalation_rate": 0.02,
    "fuel_escalation_rate": 0.02,
    "replacement_escalation_rate": 0.0,
    "electricity_tariff_per_kwh": 1445.0,
    "grid_import_tariff_per_kwh": 1445.0,
    "grid_export_tariff_per_kwh": 0.0,
    "pv_capex_per_kwp": 11500000.0,
    "bess_capex_per_kwh": 3500000.0,
    "biomass_capex_per_kw": 18000000.0,
    "pv_om_fraction_of_capex": 0.015,
    "bess_fixed_om_per_kwh_year": 50000.0,
    "inverter_replacement_year": 13,
    "inverter_replacement_cost": 420000000.0,
    "bess_design_life_years": 10,
    "inverter_design_life_years": 12,
    "biomass_overhaul_life_years": 5,
    "grid_emission_factor_kg_co2e_per_kwh": 0.78
  },
  "output_options": {
    "include_hourly": true,
    "include_daily": false
  }
}
```

Catatan untuk masukan beban mode CSV: `load_profile` memakai `{"mode": "csv", "csv_text": "..."}` (teks CSV per jam yang diunggah pengguna lewat browser, langsung divalidasi oleh `load_profile_from_csv`).

### 2.3 Contoh JSON Response `POST /v1/hybrid/simulate`

Format `hourly_year_1` memakai struktur kolom (array per variabel, bukan array berisi 8.760 objek berulang) agar ukuran JSON ringkas untuk transfer web:

```json
{
  "engine_version": "0.5.0",
  "contract_version": "0.5",
  "config_hash": "sha256:...",
  "calculated_at": "2026-11-26T06:30:00+00:00",
  "project_name": "Pabrik Hybrid Cikarang [REAL DATA]",
  "dispatch_strategy": "load_following",
  "weather_source": {
    "provider": "pvgis",
    "dataset": "PVGIS-ERA5",
    "dataset_version": "v5_3",
    "period": "2005-2023",
    "latitude": -6.28,
    "longitude": 107.15,
    "elevation_m": 25.0,
    "timezone": "Asia/Jakarta"
  },
  "summary": {
    "steps_count": 8760,
    "step_minutes": 60,
    "total_load_kwh": 1800000.0,
    "pv_generation_kwh": 725000.0,
    "biomass_generation_kwh": 640000.0,
    "served_load_kwh": 1765000.0,
    "unmet_load_kwh": 35000.0,
    "curtailment_kwh": 12000.0,
    "renewable_fraction": 0.9806,
    "pv_capacity_factor": 0.1655,
    "pv_specific_yield_kwh_per_kwp": 1450.0,
    "max_balance_error_kw": 0.0
  },
  "pv_loss_breakdown_kwh": {
    "poa_nominal_kwh": 950000.0,
    "iam_loss_kwh": 18000.0,
    "soiling_loss_kwh": 19000.0,
    "snow_loss_kwh": 0.0,
    "temperature_loss_kwh": 68000.0,
    "dc_system_loss_kwh": 52000.0,
    "inverter_loss_kwh": 34000.0,
    "clipping_loss_kwh": 4000.0
  },
  "monthly": [
    {
      "month": 1,
      "load_kwh": 152000.0,
      "pv_generation_kwh": 58000.0,
      "biomass_generation_kwh": 56000.0,
      "bess_charge_kwh": 14000.0,
      "bess_discharge_kwh": 12800.0,
      "grid_import_kwh": 0.0,
      "grid_export_kwh": 0.0,
      "served_load_kwh": 149500.0,
      "unmet_load_kwh": 2500.0,
      "curtailment_kwh": 900.0
    }
  ],
  "bess_summary": {
    "total_charge_kwh": 155000.0,
    "total_discharge_kwh": 137000.0,
    "conversion_losses_kwh": 18000.0,
    "aux_load_kwh": 0.0,
    "equivalent_full_cycles": 245.0,
    "final_soc_fraction": 0.42,
    "final_effective_capacity_kwh": 583.5,
    "replacement_count": 0
  },
  "biomass_summary": {
    "fuel_name": "Empty Fruit Bunch (Tandan Kosong Kelapa Sawit) [REAL DATA]",
    "fuel_preset": "efb",
    "total_generation_kwh": 640000.0,
    "total_operating_hours": 3950.0,
    "startup_count": 142,
    "overhaul_count": 0,
    "total_fuel_tons": 1120.0,
    "total_fuel_cost": 392000000.0,
    "total_logistics_cost": 168000000.0,
    "total_variable_om_cost": 76800000.0,
    "total_fixed_om_cost": 112500000.0,
    "total_startup_cost": 0.0,
    "total_co2e_kg": 39200.0,
    "total_thermal_output_kwh_th": 0.0,
    "is_renewable": true
  },
  "lifetime_summary": {
    "project_lifetime_years": 25,
    "multi_year_mode": "scaled_year_1",
    "total_load_kwh": 45000000.0,
    "total_pv_generation_kwh": 17070000.0,
    "total_biomass_generation_kwh": 16000000.0,
    "total_served_load_kwh": 43800000.0,
    "total_unmet_load_kwh": 1200000.0,
    "total_curtailment_kwh": 260000.0,
    "total_grid_import_kwh": 0.0,
    "total_grid_export_kwh": 0.0,
    "total_bess_replacements": 2,
    "total_biomass_overhauls": 4,
    "max_balance_error_kw": 0.0,
    "lifecycle_events": [],
    "yearly": []
  },
  "finance_summary": {
    "currency_code": "IDR",
    "tax_model": "pre_tax",
    "revenue_mode": "avoided_cost",
    "project_lifetime_years": 25,
    "discount_rate": 0.1,
    "gross_capex": 12350000000.0,
    "capital_grant": 0.0,
    "net_capex": 12350000000.0,
    "total_npc": 21450000000.0,
    "lcoe": 1285.4,
    "npv": 4120000000.0,
    "irr": 0.142,
    "irr_status": "ok",
    "simple_payback_years": 6.8,
    "simple_payback_status": "recovered",
    "discounted_payback_years": 10.4,
    "discounted_payback_status": "recovered",
    "viability_status": "viable",
    "total_discounted_energy_kwh": 16687000.0,
    "total_undiscounted_revenue": 78500000000.0,
    "total_undiscounted_opex_and_fuel": 24500000000.0,
    "total_undiscounted_replacements": 4620000000.0,
    "total_salvage_value": 540000000.0
  },
  "lcoe_breakdown": {
    "capex_pv": 344.5,
    "capex_bess": 125.8,
    "capex_biomass": 269.6,
    "capex_bos": 0.0,
    "om": 152.3,
    "fuel_and_logistics": 348.1,
    "replacement_and_overhaul": 58.2,
    "grid_import": 0.0,
    "unmet_load_penalty": 0.0,
    "tax_net_credit": 0.0,
    "salvage_credit": -13.1,
    "export_credit": 0.0
  },
  "emissions_summary": {
    "grid_emission_factor_kg_co2e_per_kwh": 0.78,
    "baseline_grid_emissions_kg_co2e": 34164000.0,
    "project_emissions_kg_co2e": 980000.0,
    "avoided_emissions_kg_co2e": 33184000.0,
    "avoided_emissions_tons_co2e": 33184.0
  },
  "cashflow_schedule": [],
  "hourly_year_1": {
    "steps_count": 8760,
    "step_minutes": 60,
    "local_time": ["01-01 00:00"],
    "load_kw": [120.5],
    "pv_generation_kw": [0.0],
    "biomass_generation_kw": [120.5],
    "bess_charge_kw": [0.0],
    "bess_discharge_kw": [0.0],
    "grid_import_kw": [0.0],
    "grid_export_kw": [0.0],
    "served_load_kw": [120.5],
    "unmet_load_kw": [0.0],
    "curtailment_kw": [0.0],
    "losses_kw": [0.0],
    "bess_soc_fraction": [0.5],
    "biomass_status": ["running"],
    "trace_reason": ["load_following: biomass covers residual load"]
  },
  "warnings": [],
  "warning_codes": []
}
```

*(Catatan: seluruh angka pada contoh respons di atas adalah ilustrasi struktur JSON `[REAL DATA]`, bukan hasil eksekusi aktual.)*

### 2.4 Penyesuaian Middleware, Kompresi, dan Daftar Kode Galat HTTP 422

1. **Batas ukuran badan permintaan (`app/middleware.py`):**
   - Untuk endpoint mode cepat (`/v1/pv/*`), batas `MAX_BODY_BYTES = 65.536` byte (64 KB) **dipertahankan persis** agar kontrak dan tes yang sudah ada tetap lolos.
   - Untuk seluruh rute berawalan `/v1/hybrid/`, batas ukuran badan permintaan dinaikkan menjadi `2.097.152` byte (2 MB) agar unggahan teks CSV beban 8.760 baris (umumnya 100 sampai 250 KB) tidak ditolak oleh HTTP 413.
2. **Kompresi respons (`app/main.py`):**
   - Mengaktifkan `GZipMiddleware(minimum_size=1024)` bawaan Starlette/FastAPI (tanpa paket eksternal) untuk memperkecil ukuran payload `hourly_year_1` saat dikirim ke browser.
3. **Kode galat baru yang stabil (diterjemahkan di `apps/web/lib/errors-id.ts`):**
   - Beban & CSV: `invalid_load_length`, `negative_load_value`, `non_finite_load_value`, `invalid_csv_format`, `invalid_load_parameters`, `load_csv_required`.
   - Cuaca & lokasi: `invalid_latitude`, `invalid_longitude`, `unsupported_weather_source`, `out_of_coverage`, `provider_timeout`, `provider_unavailable`, `provider_invalid_response`.
   - Konfigurasi komponen & keuangan: `invalid_pv_config`, `invalid_bess_config`, `invalid_biomass_config`, `invalid_dispatch_config`, `invalid_finance_config`, `invalid_lifetime_config`.
   - Job asinkron: `job_not_found` (HTTP 404 saat ID job tidak ditemukan atau kedaluwarsa), `job_capacity_exceeded` (bila batas antrean memori penuh).

---

## 3. Rancangan Arsitektur Frontend Next.js 16 (`apps/web/`)

### 3.1 Struktur Rute App Router (Alur Halaman 1 sampai 8)

Navigasi utama atas memisahkan dua mode kerja dengan jelas: **Mode Cepat PV** (`/`) dan **Desain Sistem Hybrid** (`/hybrid`).

| Halaman (`AGENTS.md` 9.1) | Rute Next.js | Isi & Interaksi Utama |
|---|---|---|
| **Mode Cepat (Utuh)** | `/` | Halaman screening PV tahunan yang sudah ada (`ScreeningForm`, `Results`, `Sensitivity`). Tidak diubah perhitungannya. |
| **1. Proyek** | `/hybrid` | Daftar proyek tersimpan, tombol "Buat Proyek Baru", "Muat Contoh Proyek Hybrid [REAL DATA]", duplikat proyek, hapus proyek, serta impor/ekspor proyek sebagai berkas JSON. |
| **2. Lokasi & Sumber Daya** | `/hybrid/[projectId]/location` | Input nama proyek, lintang, bujur, elevasi, zona waktu (`Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`), pilihan preset koordinat kota Indonesia `[REAL DATA]`, tombol "Ambil Data Cuaca PVGIS", serta kartu ringkasan dan grafik radiasi/suhu bulanan dari `POST /v1/hybrid/weather/preview`. |
| **3. Beban** | `/hybrid/[projectId]/load` | Dua mode: pembangkit profil sintetis (beban dasar, beban puncak, seed, derau, pola 24 jam) atau unggah berkas CSV per jam 8.760 baris. Menampilkan pratinjau dari `POST /v1/hybrid/load/preview` berupa KPI beban, grafik profil harian rata-rata 24 jam, dan peta panas beban 365 x 24. |
| **4. Desain Sistem** | `/hybrid/[projectId]/system` | Panel konfigurasi aktif/nonaktif dan parameter untuk **PV** (model `pvwatts_v1` atau `detailed_v1`, kWp, inverter AC, tilt, azimuth, tracking, model suhu/transposisi/DC, rugi sistem), **BESS** (kWh, daya charge/discharge, batas SOC, efisiensi, degradasi, biaya penggantian), dan **Biomass** (pilih sampel pembangkit atau parameter bebas, 5 preset bahan bakar + override, pasokan, outage). Input utama memakai angka tersinkron slider. Di sisi kanan tampil **Pratinjau Skema Blok Sistem SVG** otomatis yang menggambarkan komponen aktif dan aliran daya menuju bus. *(Kanvas drag-and-drop penuh masuk Tahap 6.)* |
| **5. EMS (Strategi Operasi)** | `/hybrid/[projectId]/ems` | Pemilih 5 strategi dispatch bawaan (`self_consumption`, `load_following`, `cycle_charging`, `peak_shaving`, `time_of_use_arbitrage`) beserta penjelasan berbahasa manusia, parameter spesifiknya (`target_soc_fraction`, `peak_limit_kw`, jam puncak/luar puncak TOU, izin impor/ekspor grid), dan pemberitahuan bahwa aturan EMS kustom berbasis JSON akan aktif di Tahap 3B/6. |
| **6. Ekonomi** | `/hybrid/[projectId]/economics` | Toggle mata uang (`IDR`/`USD`) dan mode pajak (`pre_tax`/`after_tax`), input CAPEX per komponen & BOS, O&M tetap/persentase CAPEX, biaya penggantian inverter/BESS & overhaul biomass, tarif listrik/impor/ekspor, tingkat diskonto (WACC), eskalasi, hibah/insentif, umur proyek, dan faktor emisi jaringan listrik. |
| **7. Jalankan** | `/hybrid/[projectId]/run` | Ringkasan konfigurasi proyek lengkap sebelum simulasi, pemilih mode multi-tahun (`scaled_year_1` cepat vs `full_hourly` akurat lewat job asinkron), tombol aksi spesifik **"Jalankan Simulasi"**, bilah progres job (`queued` -> `running` -> `completed`), serta pesan cold start server gratis Render yang jujur bila respons lambat (> 3 detik). |
| **8. Hasil (Dasbor Dasar)** | `/hybrid/[projectId]/results` | Dasbor analisis lengkap dari data nyata backend (rincian visualisasi di Sub-bagian 3.2). |

### 3.2 Katalog Visualisasi Dasbor Dasar Tahap 5 (`AGENTS.md` Bagian 9.2)

Seluruh angka pada dasbor memakai `font-variant-numeric: tabular-nums`. Di atas area tab terdapat strip KPI utama (NPV, IRR, LCOE, Payback sederhana & terdiskonto, Pangsa Energi Terbarukan, Unmet Load, dan Emisi Dihindari) serta chip status kelayakan (`Layak`, `Marjinal`, `Tidak Layak`).

Empat tab dengan pola tab bergaris bawah (`role="tablist"`, `role="tab"`, `role="tabpanel"`):
1. **Tab Ringkasan & Bulanan:**
   - Grafik batang bertumpuk energi bulanan per sumber (PV, Biomass, BESS discharge, Grid import) disertai garis total beban bulanan.
   - Diagram waterfall rugi PV dari irradiansi POA nominal hingga AC bersih (`pv_loss_breakdown_kwh`).
   - Kartu ringkasan kinerja teknis, BESS (siklus penuh ekuivalen, kapasitas akhir Tahun 1, jumlah penggantian), Biomass (jam operasi, pemakaian bahan bakar ton, biaya, jumlah overhaul), dan emisi CO2e.
2. **Tab Dispatch & SOC:**
   - Grafik area bertumpuk aliran daya per jam (PV, Biomass, BESS discharge, Unmet load, terhadap garis Beban dan BESS charge/Curtailment) dengan penggeser pilihan hari awal (1 sampai 365) dan pilihan rentang tampilan (24 jam, 3 hari, atau 7 hari).
   - Grafik kurva State of Charge (SOC %) baterai tersinkron pada rentang waktu yang sama, disertai inspeksi teks alasan keputusan EMS (`trace_reason`) saat pengguna mengarahkan kursor ke jam tertentu.
3. **Tab Peta Panas 8.760 Jam:**
   - Peta panas matriks Hari (1 sampai 365 pada sumbu X) x Jam (0 sampai 23 pada sumbu Y) dengan pemilih metrik: **Beban (kW)**, **Produksi PV (kW)**, **SOC BESS (%)**, dan **Unmet Load (kW)**.
   - Tooltip menampilkan hari, jam lokal, dan nilai numerik eksak, disertai ringkasan statistik teks (minimum, rata-rata, puncak) untuk aksesibilitas pembaca layar.
4. **Tab Keuangan & Arus Kas:**
   - Grafik kombinasi arus kas tahunan (batang) dan arus kas kumulatif (garis, menandai titik balik modal / payback).
   - Grafik rincian kontribusi biaya LCOE (`lcoe_breakdown`: CAPEX PV, CAPEX BESS, CAPEX Biomass, O&M, bahan bakar & logistik, penggantian/overhaul, kredit nilai sisa & ekspor).
   - Tabel jadwal arus kas tahunan Tahun 0 sampai N dengan header lengket (`sticky`), angka rata kanan, baris total di bawah, serta tombol **Ekspor JSON** dan **Ekspor CSV** (jadwal arus kas dan neraca per jam Tahun 1).

### 3.3 Tiga Keadaan Wajib, Tema, Bahasa, Aksesibilitas, dan Kebersihan Kode

1. **Tiga keadaan wajib di setiap komponen:**
   Setiap halaman pratinjau, grafik, dan tabel memiliki tampilan keadaan **kosong** (instruksi langkah berikutnya yang jelas), **memuat** (indikator proses + peringatan cold start Render bila menunggu > 3 detik), dan **galat** (pesan ramah Bahasa Indonesia berdasar kode galat backend, tombol coba lagi, tanpa menghapus input pengguna).
2. **Perbaikan kebersihan token CSS dan dari `kiyo.html` (`apps/web/app/globals.css`):**
   - Menghapus seluruh komentar atau referensi penamaan produk lain (`Stripe Modern` maupun `stripe-*`).
   - Menstandardisasi token semantik (`--surface`, `--surface-subtle`, `--ink`, `--ink-strong`, `--muted`, `--border`, `--field-border`, `--brand`, `--brand-hover`, `--brand-soft`, `--positive`, `--negative`, `--warning`) sambil menjaga kompatibilitas kelas CSS mode cepat yang sudah teruji.
   - Menambahkan toggle manual **Mode Terang / Gelap** di header (yang juga memperbarui tema warna grafik), selain mengikuti `prefers-color-scheme`.
   - Menambahkan toggle dwibahasa (**ID / EN**) dengan `aria-pressed` dan mata uang (**IDR / USD**) dengan `aria-pressed`.
   - Mempertahankan indikator `:focus-visible` berketebalan jelas di semua elemen interaktif (tidak memakai `focus:outline-none` tanpa pengganti setara), minimal target sentuh `44px`, dan responsif mulai lebar layar `360px` tanpa gulir mendatar pada halaman.
   - Memperluas tes otomatis `apps/web/lib/contrast.test.ts` agar memverifikasi rasio kontras WCAG AA (>= 4,5:1 untuk teks, >= 3:1 untuk kontrol dan seri grafik utama) di mode terang maupun gelap.

### 3.4 Persistensi Proyek Tahap 5

Pada Tahap 5, daftar proyek, konfigurasi lokasi, profil beban, desain komponen, konfigurasi EMS, parameter ekonomi, dan cache hasil simulasi terakhir disimpan di **`localStorage` browser** memakai skema JSON terversi (yang strukturnya dipetakan 1-ke-1 dengan entitas `project`, `system_config`, `ems_config`, dan `load_profile` pada `AGENTS.md` bagian 8) serta dilengkapi ekspor/impor berkas JSON. Pendekatan ini membuat alur Halaman 1 sampai 8 langsung dapat digunakan penuh end-to-end sebelum migrasi tabel baru Supabase dan autentikasi pengguna ditambahkan pada PR database terpisah.

---

## 4. Evaluasi Pilihan Pustaka Grafik (Aturan Diet Paket `AGENTS.md` Bagian 4 dan 11)

Kondisi saat ini di `apps/web/package.json`: belum terpasang pustaka grafik apa pun (hanya `next`, `react`, `react-dom`, `@fontsource/dm-sans`; mode cepat saat ini menggunakan 1 grafik garis SVG sederhana di `Chart.tsx`).

Karena Tahap 5 membutuhkan peta panas 8.760 sel (365 x 24), grafik dispatch interaktif dengan penggeser waktu, batang bertumpuk bulanan, waterfall rugi PV, dan kombinasi batang + garis arus kas (serta persiapan Sankey & tornado di tahap berikutnya), berikut perbandingan 3 opsi:

| Opsi | Pustaka & Lisensi | Kelebihan | Kekurangan / Pertimbangan |
|---|---|---|---|
| **Opsi A (Direkomendasikan)** | **Apache ECharts (`echarts`)** (Lisensi: Apache-2.0) + wrapper komponen React tipis buatan sendiri | Renderer **Canvas** bawaan mampu menggambar peta panas **8.760 sel** dengan sangat mulus di desktop maupun mobile; mendukung seluruh katalog grafik `AGENTS.md` 9.2 (batang bertumpuk, area dispatch + slider `dataZoom`, heatmap, waterfall, kombinasi arus kas, hingga Sankey & tornado di tahap lanjut); tidak butuh wrapper React pihak ketiga yang sering telat mendukung React 19; modul dapat di-import selektif (tree-shaking). | Menambah 1 dependensi runtime di `apps/web/package.json` (harus lewat PR dependensi terpisah sebelum PR kode Tahap 5). |
| **Opsi B** | **Recharts (`recharts`)** (Lisensi: MIT) + Canvas HTML5 kustom untuk Peta Panas 8.760 jam | API komponen SVG terasa alami di React; cukup ringan untuk grafik batang dan garis standar. | Peta panas 8.760 elemen SVG terlalu berat di DOM browser mobile sehingga tetap harus menulis komponen Canvas kustom terpisah; beberapa grafik tahap lanjut (waterfall, Sankey, zoom dispatch mulus) memerlukan penyesuaian manual lebih rumit; perlu verifikasi kompatibilitas peer dependency dengan React 19. |
| **Opsi C** | **Tanpa dependensi baru** (SVG + Canvas HTML5 murni buatan sendiri, meneruskan pola `Chart.tsx`) | Nol dependensi baru (paling ketat mengikuti Diet Paket); ukuran bundel terkecil dan tidak memerlukan PR dependensi terpisah. | Membutuhkan kode internal dan pengujian manual jauh lebih banyak untuk sumbu otomatis, tooltip interaktif, zoom/slider dispatch 8.760 jam, heatmap 365x24, waterfall, serta berisiko memperlambat Tahap 5 dan Tahap 7 (Sankey & tornado). |

**Kebijakan PR Dependensi (`AGENTS.md` Bagian 11):**
Jika pemilik proyek menyetujui **Opsi A** (atau **Opsi B**), penambahan paket grafik akan diajukan **terlebih dahulu dalam satu PR dependensi terpisah** (misalnya `deps/add-web-charting`) yang menjelaskan ukuran bundel, lisensi, dan verifikasi kompatibilitas build dengan Next.js 16 + React 19, sebelum PR implementasi kode Tahap 5 dimulai.

---

## 5. Kriteria Selesai dan Rencana Pengujian Tahap 5

1. **Pengujian Backend (`pytest`):**
   - Tes seluruh 6 endpoint hybrid (`/presets`, `/weather/preview`, `/load/preview`, `/simulate`, `/jobs`, `/jobs/{job_id}`).
   - Tes verifikasi batas ukuran badan permintaan `BodyLimit`: payload > 64 KB ke `/v1/pv/*` tetap ditolak HTTP 413, sedangkan unggahan CSV beban 8.760 baris (> 64 KB dan <= 2 MB) ke `/v1/hybrid/*` diterima.
   - Tes header kompresi `GZip` pada respons deret waktu besar.
   - Tes pemetaan kode galat HTTP 422 (`invalid_load_length`, `negative_load_value`, `out_of_coverage`, `provider_timeout`, dan lainnya) serta HTTP 404 (`job_not_found`).
   - Tes regresi memastikan seluruh 205+ tes yang sudah ada di `main` (termasuk seluruh tes `/v1/pv/*`) tetap lulus tanpa perubahan.
2. **Pengujian Frontend (`npm test && npm run build`):**
   - Tes unit untuk serialisasi/validasi skema proyek, formatter angka/mata uang, penerjemah kode galat Bahasa Indonesia (`errors-id.test.ts`), klien API hybrid (`api.test.ts`), dan rasio kontras WCAG AA di mode terang dan gelap (`contrast.test.ts`).
   - Build produksi `next build` dan `tsc --noEmit` lulus bersih tanpa galat tipe maupun warning yang merusak.
   - Verifikasi manual antarmuka langsung pada aplikasi berjalan: klik seluruh kontrol dari Halaman 1 sampai Halaman 8, cek konsol browser bersih dari error, cek tata letak mobile lebar `360px`, cek mode terang dan mode gelap, serta cek tiga keadaan (kosong, memuat, galat).

---

## 6. Keputusan Pemilik Proyek yang Telah Dikonfirmasi (`AGENTS.md` Bagian 12)

Seluruh 6 keputusan desain dan arsitektur Tahap 5 telah dikonfirmasi oleh pemilik proyek pada 2026-11-26:

1. **Palet warna utama:** Dipertahankan. Aksen violet dari `kiyo.html` dan `DESIGN.md` (`#533AFD` mode terang / `#A78BFA` mode gelap) beserta palet seri grafik hybrid (PV violet, BESS biru langit, Biomass amber, Beban navy) tetap dipakai.
2. **Pilihan pustaka grafik:** **Opsi A (`echarts`, lisensi Apache-2.0)** disetujui dan diajukan lebih dulu melalui PR dependensi terpisah (`deps/add-web-echarts`) sebelum penulisan kode implementasi Tahap 5.
3. **Dial desain dan kontrol global:** Disetujui (`ENERGY 1 / RHYTHM 2 / MOTION 1`, toggle Mode Terang/Gelap, dwibahasa ID/EN, dan pilihan mata uang IDR/USD).
4. **Penyimpanan proyek pada Tahap 5:** Disetujui menggunakan penyimpanan lokal browser (`localStorage`) + ekspor/impor berkas JSON lebih dulu pada Tahap 5, sementara migrasi tabel Supabase dan autentikasi pengguna dikerjakan pada PR database terpisah.
5. **Mode simulasi multi-tahun bawaan di Halaman 7:** Disetujui memakai `"scaled_year_1"` sebagai bawaan tombol **"Jalankan Simulasi"**, dengan pilihan opsi `"full_hourly"` (simulasi per jam penuh lewat antrean job asinkron).
6. **Penempatan URL Mode Cepat Screening PV:** Disetujui Mode Cepat Screening PV tetap di `/` (beranda) dan Desain Sistem Hybrid di `/hybrid`, dengan navigasi atas yang jelas di antara keduanya.
