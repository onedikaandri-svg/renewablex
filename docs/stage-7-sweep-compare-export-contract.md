# Kontrak Tahap 7: Sapuan Kombinasi Gaya HOMER, Perbandingan Skenario, Sensitivitas Hybrid, dan Ekspor Laporan PDF/Excel

**Status dokumen:** Disetujui pemilik proyek (keputusan Bagian 7 telah dikonfirmasi pada 2026-11-26).  
**Cabang usulan kontrak:** `docs/stage-7-contract` (berbasis `main` setelah penggabungan Tahap 6A, commit `64e6d5f`).  
**Cakupan:** Endpoint backend sapuan kombinasi gaya HOMER asinkron, endpoint analisis sensitivitas hybrid (Tornado dan Matriks `5x5`), pembaruan navigasi `HybridShell.tsx` menjadi alur lengkap 10 halaman, rancangan antarmuka Halaman 9 (`/hybrid/[projectId]/compare`) dan Halaman 10 (`/hybrid/[projectId]/export`), strategi performa untuk instance gratis Render, serta evaluasi jujur pustaka ekspor PDF dan Excel (`.xlsx`) sesuai aturan Diet Paket.

---

## 1. Prinsip Kompatibilitas dan Batas Cakupan Tahap 7

1. **Mode Cepat Screening PV tetap 100% utuh:**
   Halaman utama `/` serta endpoint backend `POST /v1/pv/preliminary`, `POST /v1/pv/sensitivity`, dan `GET /health` tidak diubah struktur data, validasi, maupun perhitungannya.
2. **Kompatibilitas mundur API Hybrid v0.5 terjaga:**
   Keenam endpoint `/v1/hybrid/*` dari Tahap 5 tetap menerima `contract_version: "0.5"` tanpa perubahan yang memutus klien lama. Saat PR implementasi kode Tahap 7 digabungkan nanti, versi mesin (`ENGINE_VERSION` di `services/calculation-engine/app/version.py`) akan naik dari `"0.5.0"` ke `"0.6.0"` dengan dukungan `contract_version: "0.6"` (dan tetap menerima `"0.5"` pada endpoint v0.5).
3. **Rumus energi, sapuan, sensitivitas, dan keuangan 100% hanya di backend:**
   Sesuai `AGENTS.md` bagian 3 dan 9.2, frontend dilarang keras menghitung ulang LCOE, NPV, IRR, payback, neraca daya, pergeseran sensitivitas, atau penskalaan sapuan. Frontend hanya mengirimkan konfigurasi ke mesin Python, menampilkan angka yang dikembalikan mesin (`tabular-nums`), memilih satuan tampilan, dan menyaring/mengurutkan baris hasil dari backend.
4. **Kompatibilitas proyek JSON dan kunci cache terpisah di `localStorage`:**
   `apps/web/lib/hybrid-storage.ts` tetap membaca proyek versi `schemaVersion: "0.5"` dan `"0.6"` secara penuh. Cache hasil sapuan kombinasi dan sensitivitas hybrid untuk suatu proyek disimpan pada kunci terpisah (`renewablex.hybrid.sweep.v1.<projectId>` dan `renewablex.hybrid.sensitivity.v1.<projectId>`) agar ukuran cache simulasi utama (`renewablex.hybrid.result.v1.<projectId>`) tidak membengkak dan mudah dihapus saat proyek dihapus.
5. **Batas terhadap Tahap 3B dan Tahap 6B:**
   Tahap 3B (interpreter aturan EMS kustom JSON) dan Tahap 6B (editor EMS visual) tetap ditunda sementara menunggu berkas skema EMS resmi dari pemilik proyek. Halaman 5 (`/hybrid/[projectId]/ems`) tetap memakai 5 strategi dispatch bawaan.

---

## 2. Kontrak API Backend Baru (`services/calculation-engine/app/api/hybrid.py` dan `hybrid_schemas.py`)

Seluruh skema permintaan baru mewarisi `HybridStrictModel` (`ConfigDict(extra="forbid")`), sehingga field yang tidak dikenal langsung ditolak. Semua galat validasi, `EngineError`, dan `ResourceError` mengembalikan HTTP `422` (atau `404` untuk ID job yang tidak ditemukan/kedaluwarsa) dengan format `detail` standar berisi `code` stabil agar frontend bercabang berdasarkan `code`, bukan teks `msg`.

### 2.1 Daftar Endpoint Baru Tahap 7

| Metode | Jalur (Path) | Kode HTTP Sukses | Peran Utama |
|---|---|---|---|
| `POST` | `/v1/hybrid/sweep/jobs` | `202` | Mendaftarkan job sapuan kombinasi ukuran komponen (PV, BESS, Biomass) sebagai proses asinkron (*background job*). |
| `GET` | `/v1/hybrid/sweep/jobs/{job_id}` | `200` | Memeriksa status (`queued`, `running`, `completed`, `failed`, `cancelled`), progres nyata (`completed_combinations / total_combinations`), dan daftar ringkasan kombinasi yang sudah terurut. |
| `POST` | `/v1/hybrid/sweep/jobs/{job_id}/cancel` | `200` | Mengirim sinyal pembatalan kooperatif (*cooperative cancellation*) ke job sapuan yang masih `queued` atau `running` agar tidak membuang CPU Render jika pengguna mengubah rentang atau menutup halaman. |
| `POST` | `/v1/hybrid/sensitivity` | `200` | Menjalankan analisis sensitivitas hybrid satu arah (grafik Tornado terhadap NPV dan LCOE) serta opsi Matriks Sensitivitas 2D (`5 x 5`) dari konfigurasi proyek aktif. |
| `POST` | `/v1/hybrid/export/excel` | `200` | *(Hanya ditambahkan jika pemilik menyetujui Opsi E1 backend `openpyxl` pada Bagian 4.1.)* Menghasilkan berkas buku kerja Excel `.xlsx` multi-sheet dari data proyek dan hasil simulasi nyata (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`). |

*(Catatan: apabila pada Bagian 4.2 pemilik memilih Opsi P2 pembuatan PDF di backend, akan ditambahkan endpoint `POST /v1/hybrid/export/pdf` dengan skema input serupa `/export/excel` ditambah field opsional `schematic_svg` yang telah disanitasi. Jika Opsi P1 atau Opsi P3 di browser dipilih, endpoint PDF backend tidak diperlukan.)*

---

### 2.2 Kontrak Sapuan Kombinasi Gaya HOMER (`POST /v1/hybrid/sweep/jobs` dan `GET /v1/hybrid/sweep/jobs/{job_id}`)

#### Aturan Penskalaan Ukuran Komponen Selama Sapuan
Agar pengguna tidak perlu memasukkan puluhan angka turunan untuk setiap titik kombinasi, mesin melakukan penskalaan deterministik dari konfigurasi dasar proyek:

1. **Sumbu PV (`pv_capacity_kwp_values`):**
   - Wajib berisi minimal `1` dan maksimal `10` nilai unik yang semuanya `> 0`.
   - `pv_inverter_sizing_mode`:
     - `"keep_dc_ac_ratio"` (bawaan): Rasio DC/AC dari konfigurasi dasar (`base_pv.capacity_kwp / base_pv.inverter_ac_kw`, atau `1.19` jika `inverter_ac_kw` kosong) dipertahankan untuk setiap ukuran PV kandidat. Jika `scale_replacement_costs: true` (bawaan), `finance.inverter_replacement_cost` juga diskalakan proporsional terhadap kapasitas inverter baru.
     - `"fixed"`: Kapasitas inverter tetap memakai nilai konfigurasi dasar.
2. **Sumbu BESS (`bess_capacity_kwh_values`):**
   - Wajib berisi minimal `1` dan maksimal `10` nilai unik `>= 0`. Nilai `0` menonaktifkan BESS (`enabled = false`) pada kombinasi tersebut sehingga pengguna dapat membandingkan sistem dengan dan tanpa baterai sekaligus.
   - Untuk nilai `> 0`:
     - Jika BESS pada konfigurasi dasar aktif (`nominal_capacity_kwh > 0`), rasio daya `max_charge_kw / nominal_capacity_kwh` dan `max_discharge_kw / nominal_capacity_kwh` (*C-rate*) dipertahankan. Jika BESS dasar tidak aktif, dipakai rasio bawaan `0.5 C` (`0.5 * kwh`).
     - Jika `scale_replacement_costs: true`, biaya penggantian baterai dihitung proporsional dari rasio `base_bess.replacement_cost / base_bess.nominal_capacity_kwh` (atau bila BESS dasar nonaktif/nol, memakai `bess_replacement_cost_per_kwh` jika diisi, atau `finance.bess_capex_per_kwh`).
3. **Sumbu Biomass (`biomass_capacity_kw_values`):**
   - Wajib berisi minimal `1` dan maksimal `10` nilai unik `>= 0`. Nilai `0` menonaktifkan Biomass (`enabled = false`) pada kombinasi tersebut.
   - Untuk nilai `> 0`:
     - Kapasitas acuan diambil dari `base_biomass.rated_capacity_kw` (atau dari `plant_sample` jika Biomass dasar nonaktif). Parameter terikat daya seperti `min_load_kw`, `ramp_up_kw_per_hour`, `ramp_down_kw_per_hour`, dan `overhaul_cost` (jika `scale_replacement_costs: true`) diskalakan proporsional dengan rasio `candidate_kw / base_rated_kw`.
4. **Batasan Kelayakan (`constraints`, opsional) dan Pengurutan (`ranking`):**
   - `max_unmet_load_fraction` (rentang `[0.0, 1.0]`, opsional): batas maksimum rasio beban tak terpenuhi (`unmet_load_kwh / total_load_kwh`) sepanjang Tahun 1 (atau umur proyek).
   - `min_renewable_fraction` (rentang `[0.0, 1.0]`, opsional): batas minimum pangsa energi terbarukan.
   - Setiap kombinasi diberi `feasible: bool` dan `infeasible_reasons: list[str]` (berisi kode stabil seperti `unmet_load_exceeded`, `renewable_fraction_below_min`, `simulation_error`).
   - `sort_by`: salah satu dari `"lcoe_asc"`, `"total_npc_asc"`, `"npv_desc"`, `"irr_desc"`, `"renewable_fraction_desc"` (bawaan `"lcoe_asc"`). Jika `feasible_first: true` (bawaan), seluruh konfigurasi yang lolos batasan ditempatkan di peringkat atas sebelum konfigurasi yang tidak lolos batasan.
5. **Ringkasan hasil tanpa deret 8.760 jam:**
   Respons sapuan hanya menyimpan ringkasan metrik teknis, keuangan, dan emisi per kombinasi agar penggunaan RAM server dan ukuran transfer JSON tetap kecil. Jika pengguna memilih satu kombinasi pemenang untuk diteliti lebih lanjut, konfigurasi pemenang diterapkan ke proyek dan disimulasikan penuh lewat Halaman 7/8.

#### Contoh JSON Request `POST /v1/hybrid/sweep/jobs` (`[REAL DATA]`)

```json
{
  "contract_version": "0.6",
  "base_request": {
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
        "allow_grid_export": false
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
        "inverter_ac_kw": 420.0
      },
      "bess": {
        "enabled": true,
        "nominal_capacity_kwh": 600.0,
        "max_charge_kw": 300.0,
        "max_discharge_kw": 300.0,
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
      "discount_rate": 0.10,
      "electricity_tariff_per_kwh": 1445.0,
      "pv_capex_per_kwp": 11500000.0,
      "bess_capex_per_kwh": 3500000.0,
      "biomass_capex_per_kw": 18000000.0
    },
    "output_options": {
      "include_hourly": false,
      "include_daily": false,
      "include_trace_reasons": false
    }
  },
  "sweep": {
    "pv_capacity_kwp_values": [300.0, 500.0, 700.0],
    "bess_capacity_kwh_values": [0.0, 400.0, 800.0],
    "biomass_capacity_kw_values": [0.0, 250.0],
    "pv_inverter_sizing_mode": "keep_dc_ac_ratio",
    "scale_replacement_costs": true
  },
  "constraints": {
    "max_unmet_load_fraction": 0.05,
    "min_renewable_fraction": 0.80
  },
  "ranking": {
    "sort_by": "lcoe_asc",
    "feasible_first": true
  }
}
```

#### Contoh JSON Response `GET /v1/hybrid/sweep/jobs/{job_id}` saat `completed` (`[REAL DATA]`)

*(Seluruh angka keluaran di bawah ini adalah ilustrasi struktur JSON `[REAL DATA]`, bukan hasil eksekusi aktual.)*

```json
{
  "job_id": "a9d4f2c1-7b2e-4f88-9b34-12c9e6409a11",
  "engine_version": "0.6.0",
  "contract_version": "0.6",
  "status": "completed",
  "progress_percent": 100,
  "completed_combinations": 18,
  "total_combinations": 18,
  "current_step_label": "Sapuan selesai: 18 kombinasi dievaluasi",
  "created_at": "2026-11-26T08:15:00+00:00",
  "result": {
    "sort_by": "lcoe_asc",
    "feasible_count": 11,
    "total_combinations": 18,
    "best_combination_id": "pv500-bess400-bio250",
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
    "combinations": [
      {
        "rank": 1,
        "combination_id": "pv500-bess400-bio250",
        "feasible": true,
        "infeasible_reasons": [],
        "sizing": {
          "pv_capacity_kwp": 500.0,
          "pv_inverter_ac_kw": 420.0,
          "bess_enabled": true,
          "bess_nominal_capacity_kwh": 400.0,
          "bess_max_charge_kw": 200.0,
          "bess_max_discharge_kw": 200.0,
          "biomass_enabled": true,
          "biomass_rated_capacity_kw": 250.0
        },
        "technical": {
          "pv_generation_kwh": 725000.0,
          "biomass_generation_kwh": 612000.0,
          "served_load_kwh": 1785000.0,
          "unmet_load_kwh": 15000.0,
          "unmet_load_fraction": 0.0083,
          "curtailment_kwh": 18000.0,
          "renewable_fraction": 0.9917,
          "bess_equivalent_full_cycles": 260.0,
          "biomass_fuel_tons": 1070.0,
          "avoided_emissions_tons_co2e": 32900.0
        },
        "finance": {
          "currency_code": "IDR",
          "gross_capex": 11650000000.0,
          "net_capex": 11650000000.0,
          "total_npc": 20420000000.0,
          "lcoe": 1223.6,
          "npv": 4890000000.0,
          "irr": 0.151,
          "irr_status": "ok",
          "simple_payback_years": 6.4,
          "discounted_payback_years": 9.6,
          "viability_status": "viable"
        }
      }
    ]
  },
  "error": null
}
```

---

### 2.3 Kontrak Analisis Sensitivitas Hybrid (`POST /v1/hybrid/sensitivity`)

Endpoint ini menguji pergeseran satu variabel pada satu waktu (*one-at-a-time*) untuk grafik Tornado dan opsional Matriks `5 x 5` pada proyek hybrid aktif.

1. **Daftar variabel yang didukung (`SensitivityVariableId`):**
   - **Kelompok Keuangan Murni (1x simulasi energi dasar + pengulangan `run_financial_analysis`):**
     - `capex_total`: Menggeser serentak seluruh komponen CAPEX (`pv_capex`/`pv_capex_per_kwp`, `bess_capex`/`bess_capex_per_kwh`, `biomass_capex`/`biomass_capex_per_kw`, `bos_and_other_capex`).
     - `electricity_tariff`: Menggeser `electricity_tariff_per_kwh` (dan bila `allow_grid_import: true`, `grid_import_tariff_per_kwh` ikut digeser proporsional kecuali diatur terpisah nanti).
     - `discount_rate`: Menggeser tingkat diskonto WACC (`discount_rate`, divalidasi `> -1.0` dan umumnya `>= 0`).
     - `biomass_fuel_price`: Menggeser `fuel_price_per_ton` (dan harga preset bahan bakar efektif).
     - `om_total`: Menggeser serentak O&M tetap PV, BESS, dan Biomass.
   - **Kelompok Teknis (menjalankan ulang simulasi energi + keuangan per kasus geser):**
     - `pv_degradation_rate`: Menggeser laju degradasi tahunan PV (`annual_degradation_fraction`).
     - `load_scale`: Mengalikan deret beban per jam `load_kw` dengan faktor `(1 + shift)`.
     - `pv_capacity`: Menggeser `capacity_kwp` PV (dan `inverter_ac_kw` bila proporsional).
2. **Daftar variabel default (bila `variables` dikosongkan):**
   `["capex_total", "electricity_tariff", "discount_rate", "biomass_fuel_price", "om_total", "pv_degradation_rate"]` dengan `shifts` default `[-0.20, -0.10, 0.10, 0.20]`.
3. **Perlakuan jujur untuk komponen nonaktif atau nilai dasar nol:**
   Jika pengguna menguji `biomass_fuel_price` padahal Biomass tidak aktif (`enabled: false`), atau nilai dasar sebuah variabel `0`, mesin **tidak** menyembunyikannya dengan angka palsu:
   - Jika komponen nonaktif: variabel tetap ada di array `variables` dengan `skipped: true`, `skip_reason: "component_disabled"`, `cases: []`.
   - Jika nilai dasar `0`: kasus tetap dikembalikan dengan `npv_delta: 0.0` dan `zero_base: true`, sehingga UI dapat memberi catatan jujur persis seperti pola mode cepat screening PV.
4. **Matriks Sensitivitas 2D (`matrix`, opsional):**
   Pengguna dapat memilih 2 variabel (`x_variable`, `y_variable` yang berbeda) masing-masing maksimal 5 nilai pergeseran (maks `5 x 5 = 25` sel), dan backend mengembalikan kisi sel berisi `npv`, `lcoe`, `irr`, `viability_status`, `npv_delta`, dan `lcoe_delta`.

#### Contoh JSON Request & Response `POST /v1/hybrid/sensitivity` (`[REAL DATA]`)

```json
{
  "contract_version": "0.6",
  "base_request": {
    "contract_version": "0.5",
    "project": { "project_name": "Pabrik Hybrid Cikarang [REAL DATA]", "latitude": -6.28, "longitude": 107.15, "timezone": "Asia/Jakarta", "currency_code": "IDR" },
    "simulation": { "step_minutes": 60, "weather_source": "pvgis_tmy", "dispatch_strategy": "load_following", "project_lifetime_years": 25, "multi_year_mode": "scaled_year_1" },
    "load_profile": { "mode": "synthetic", "base_load_kw": 120.0, "peak_load_kw": 350.0, "seed": 42, "noise_fraction": 0.05 },
    "components": { "pv": { "enabled": true, "capacity_kwp": 500.0, "inverter_ac_kw": 420.0 }, "bess": { "enabled": true, "nominal_capacity_kwh": 600.0 }, "biomass": { "enabled": true, "plant_sample": "sample_gasifier_250kw", "fuel_preset": "efb" } },
    "finance": { "discount_rate": 0.10, "electricity_tariff_per_kwh": 1445.0, "pv_capex_per_kwp": 11500000.0, "bess_capex_per_kwh": 3500000.0, "biomass_capex_per_kw": 18000000.0 },
    "output_options": { "include_hourly": false, "include_daily": false, "include_trace_reasons": false }
  },
  "variables": ["capex_total", "electricity_tariff", "discount_rate", "biomass_fuel_price", "om_total", "pv_degradation_rate"],
  "shifts": [-0.20, -0.10, 0.10, 0.20],
  "matrix": {
    "x_variable": "capex_total",
    "x_shifts": [-0.20, -0.10, 0.0, 0.10, 0.20],
    "y_variable": "electricity_tariff",
    "y_shifts": [-0.20, -0.10, 0.0, 0.10, 0.20]
  }
}
```

```json
{
  "engine_version": "0.6.0",
  "contract_version": "0.6",
  "calculated_at": "2026-11-26T08:20:00+00:00",
  "currency_code": "IDR",
  "base": {
    "npv": 4120000000.0,
    "lcoe": 1285.4,
    "total_npc": 21450000000.0,
    "irr": 0.142,
    "irr_status": "ok",
    "simple_payback_years": 6.8,
    "discounted_payback_years": 10.4,
    "viability_status": "viable"
  },
  "variables": [
    {
      "variable": "electricity_tariff",
      "category": "finance_only",
      "base_value": 1445.0,
      "unit": "IDR/kWh",
      "skipped": false,
      "skip_reason": null,
      "zero_base": false,
      "max_abs_npv_delta": 5210000000.0,
      "max_abs_lcoe_delta": 0.0,
      "cases": [
        {
          "shift_fraction": -0.20,
          "input_value": 1156.0,
          "npv": -1090000000.0,
          "npv_delta": -5210000000.0,
          "lcoe": 1285.4,
          "lcoe_delta": 0.0,
          "irr": 0.089,
          "irr_status": "ok",
          "simple_payback_years": 8.7,
          "discounted_payback_years": 15.8,
          "viability_status": "unviable"
        }
      ]
    }
  ],
  "matrix_result": {
    "x_variable": "capex_total",
    "x_shifts": [-0.20, -0.10, 0.0, 0.10, 0.20],
    "y_variable": "electricity_tariff",
    "y_shifts": [-0.20, -0.10, 0.0, 0.10, 0.20],
    "cells": [
      {
        "x_index": 0,
        "y_index": 0,
        "x_shift": -0.20,
        "y_shift": -0.20,
        "npv": 1380000000.0,
        "npv_delta": -2740000000.0,
        "lcoe": 1138.0,
        "lcoe_delta": -147.4,
        "irr": 0.116,
        "viability_status": "marginal"
      }
    ]
  }
}
```

---

### 2.4 Kontrak Ekspor Excel Backend (`POST /v1/hybrid/export/excel`, bila Opsi E1 disetujui)

1. **Struktur permintaan ketat (`HybridExcelExportRequest`, `extra="forbid"`):**
   - `contract_version`: `"0.6"`
   - `language`: `"id" | "en"` (bawaan `"id"`)
   - `project_config`: ringkasan `HybridSimulateRequest` (tanpa teks CSV beban raksasa jika tidak diperlukan, atau cukup metadata + komponen + ekonomi)
   - `simulation_result`: objek ringkasan hasil simulasi (tanpa array `hourly_year_1` agar payload permintaan jauh di bawah batas `2 MB` pada `app/middleware.py` dan cepat dirangkai menjadi `.xlsx`)
   - `sweep_result` (opsional): ringkasan hasil sapuan bila pengguna ingin menyertakan sheet `Hasil_Sapuan`
   - `sensitivity_result` (opsional): ringkasan sensitivitas bila pengguna ingin menyertakan sheet `Sensitivitas`
2. **Respons HTTP `200`:**
   - `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
   - `Content-Disposition: attachment; filename="<slug-proyek>-laporan-hybrid.xlsx"`
   - Berkas `.xlsx` multi-sheet siap buka di Microsoft Excel maupun LibreOffice Calc.

### 2.5 Kode Galat Stabil Baru (`apps/web/lib/errors-id.ts`)

| Kode Galat (`code`) | HTTP | Arti dan Penanganan Frontend |
|---|---|---|
| `sweep_combinations_exceeded` | `422` | Jumlah total kombinasi melebihi batas aman (64 untuk `scaled_year_1`, 12 untuk `full_hourly`). |
| `sweep_full_hourly_limit_exceeded` | `422` | Mode `full_hourly` dibatasi maksimal 12 kombinasi pada satu job sapuan. |
| `invalid_sweep_axis` | `422` | Daftar ukuran komponen kosong, melebihi 10 nilai, berisi duplikat, atau nilai di luar batas fisik (`PV <= 0` atau `BESS/Biomass < 0`). |
| `sweep_job_not_found` | `404` | ID job sapuan tidak ditemukan, kedaluwarsa, atau terhapus karena instance server Render tereset. |
| `sweep_job_cancelled` | `422` | Job sapuan telah dibatalkan oleh pengguna. |
| `duplicate_sensitivity_variables` | `422` | Daftar variabel sensitivitas tidak boleh berulang. |
| `duplicate_sensitivity_shifts` | `422` | Daftar nilai pergeseran sensitivitas tidak boleh berulang. |
| `invalid_sensitivity_shift` | `422` | Pergeseran harus berada di rentang `-90%` sampai `+100%` dan bukan `0%` untuk tornado. |
| `sensitivity_shift_out_of_range` | `422` | Pergeseran membuat parameter fisik/keuangan keluar dari batas sah mesin (misal `discount_rate <= -100%` atau `degradation >= 100%`). |
| `invalid_matrix_axes` | `422` | Sumbu X dan Y matriks sensitivitas harus berbeda dan masing-masing maksimal 5 nilai. |
| `export_payload_invalid` | `422` | Data proyek atau hasil simulasi tidak valid/lengkap untuk diekspor ke `.xlsx`. |

---

## 3. Strategi Batas Kombinasi Sapuan, Performa, dan Cold Start Render Gratis

Layanan gratis Render memiliki kendala nyata: **RAM 512 MB**, CPU bersama, tidur otomatis setelah 15 menit tidak aktif (waktu bangun / *cold start* bisa mencapai **30 sampai 60 detik**), dan seluruh memori proses hilang apabila container di-restart atau tidur di tengah pekerjaan.

Untuk menjaga stabilitas layanan tanpa mengorbankan akurasi perhitungan:

1. **Batas Aman Jumlah Kombinasi per Job Sapuan:**
   - Untuk mode multi-tahun `"scaled_year_1"`: maksimal **64 kombinasi** per job (misalnya `4 PV x 4 BESS x 4 Biomass = 64`), dengan maksimal **10 nilai unik** per sumbu.
   - Untuk mode `"full_hourly"` (simulasi per jam di seluruh 25 sampai 40 tahun): maksimal **12 kombinasi** per job agar waktu komputasi dan pemakaian CPU tetap terkendali.
   - Antarmuka Halaman 9 menghitung pratinjau `total_kombinasi = n_pv * n_bess * n_biomass` secara langsung (ini murni perkalian jumlah chip pilihan UI, bukan rumus energi) dan menampilkan peringatan jelas sebelum pengguna menekan **"Jalankan Sapuan Kombinasi"**.
2. **Optimasi Bersih di Backend Tanpa Mengubah Rumus:**
   - **Ambil cuaca dan beban 1 kali per job:** `_resolve_weather` dan `_resolve_load` dipanggil hanya sekali di awal job sapuan, lalu dibagikan (read-only) ke seluruh kombinasi.
   - **Cache hasil PV per `(pv_capacity_kwp, inverter_ac_kw)` unik:** Dalam grid `4 PV x 4 BESS x 4 Biomass = 64` kombinasi, komponen PV hanya memiliki 4 konfigurasi unik. Perhitungan PV 8 tahap (posisi matahari, Perez, suhu sel Faiman, inverter) dihitung 1 kali per ukuran PV unik dan hasilnya (vektor `PVHourlyOutput` yang tidak berubah oleh BESS/Biomass) dipakai ulang untuk seluruh kombinasi BESS dan Biomass yang memakai ukuran PV tersebut. Pengujian `pytest` wajib membuktikan selisih hasil sapuan dengan cache PV terhadap eksekusi satu per satu tanpa cache adalah tepat `0.0`.
   - **Jalur cepat sensitivitas keuangan murni:** Pada `/v1/hybrid/sensitivity`, variabel kelompok keuangan murni (`capex_total`, `electricity_tariff`, `discount_rate`, `biomass_fuel_price`, `om_total`) cukup menjalankan simulasi energi (`run_lifetime_simulation`) **1 kali** pada kasus dasar, lalu mengevaluasi ulang `run_financial_analysis` untuk setiap pergeseran. Hanya variabel teknis (`pv_degradation_rate`, `load_scale`, `pv_capacity`) yang mengulang simulasi energi. *(Catatan khusus: untuk `biomass_fuel_price`, karena biaya bahan bakar tahunan pada `YearlyTechnicalResult` linear terhadap harga per ton + logistik, jika `biomass_fuel_cost` per ton berubah tanpa mengubah dispatch teknis, hasil keuangan dapat dihitung ulang secara eksak dari total konsumsi ton bahan bakar; verifikasi kesetaraan terhadap simulasi ulang penuh wajib ada di `pytest`.)*
3. **Manajemen Memori, Antrean, dan Pembatalan:**
   - Maksimal **1 job sapuan berjalan bersamaan** (`MAX_CONCURRENT_SWEEPS = 1`) pada executor khusus sapuan agar dua permintaan sapuan bersamaan tidak membuat RAM 512 MB habis (*Out-of-Memory*).
   - Penyimpan job sapuan menyimpan maksimal **15 job terakhir** dengan **TTL 30 menit** (`MAX_SWEEP_JOBS = 15`, `SWEEP_JOB_TTL_SECONDS = 1800`).
   - Karena hasil sapuan tidak menyimpan deret 8.760 jam per kombinasi, 1 job dengan 64 kombinasi hanya membutuhkan sekitar **50 sampai 80 KB** di RAM.
   - Setiap selesai mengevaluasi 1 kombinasi, worker memeriksa bendera pembatalan (`cancel_requested`) sehingga pengguna bisa membatalkan sapuan di tengah jalan via `POST /v1/hybrid/sweep/jobs/{job_id}/cancel`.
4. **Penanganan Cold Start & Reset Render di Frontend:**
   - Frontend melakukan *polling* `GET /v1/hybrid/sweep/jobs/{job_id}` tiap **1,5 detik** (berhenti otomatis jika komponen unmount atau dibatalkan).
   - Jika permintaan awal `POST /v1/hybrid/sweep/jobs` atau `POST /v1/hybrid/sensitivity` belum merespons setelah **3 detik**, tampilkan pesan jujur: *"Mesin hitung di Render mungkin sedang bangun dari mode tidur (cold start), proses awal dapat memakan waktu 30 hingga 60 detik."*
   - Jika saat *polling* server mengembalikan `404 sweep_job_not_found` (misalnya instance Render gratis tereset saat proses berjalan), UI menampilkan galat yang ramah berisi penjelasan jujur bahwa sesi memori server sementara tereset serta tombol **"Jalankan Ulang Sapuan"** tanpa menghapus rentang input pengguna.

---

## 4. Evaluasi Jujur Pilihan Pustaka Ekspor PDF dan Excel (`.xlsx`) (Diet Paket `AGENTS.md` Bagian 4 dan 11)

Saat ini `services/calculation-engine/requirements.txt` berisi 5 paket produksi (`fastapi`, `uvicorn`, `pydantic`, `httpx`, `numpy`) dan `apps/web/package.json` berisi 5 paket (`@fontsource/dm-sans`, `echarts`, `next`, `react`, `react-dom`). Sesuai `AGENTS.md` bagian 4 dan 11, setiap penambahan dependensi baru wajib melewati evaluasi alternatif bawaan, mencantumkan lisensi, serta diajukan lewat **PR dependensi terpisah** untuk persetujuan pemilik proyek.

### 4.1 Evaluasi Pilihan Ekspor Excel (`.xlsx` Multi-Sheet)

| Opsi | Pustaka & Lisensi | Kelebihan | Kekurangan / Pertimbangan |
|---|---|---|---|
| **Opsi E1 (Direkomendasikan)** | **Backend Python `openpyxl`** (Lisensi: **MIT**) | Paket Python murni (tanpa kompilasi C/OS), sangat ringan untuk RAM, langsung menghasilkan `.xlsx` multi-sheet asli dengan lebar kolom rapi, format angka akuntansi (`#,##0`), dan nama sheet terstruktur (`Ringkasan`, `Energi_Bulanan`, `Arus_Kas_Tahunan`, `Asumsi_Konfigurasi`, `Hasil_Sapuan`). Nol tambahan ukuran bundel JavaScript browser. Data dan struktur `.xlsx` mudah diuji langsung di `pytest`. | Menambah 1 paket di `services/calculation-engine/requirements.txt` (butuh 1 PR dependensi backend terpisah, mis. `deps/add-engine-openpyxl`) dan membutuhkan koneksi ke backend saat tombol unduh Excel ditekan. |
| **Opsi E2** | **Browser `exceljs`** atau **`write-excel-file`** (Lisensi: **MIT**) | Unduhan `.xlsx` berjalan langsung di browser pengguna tanpa memanggil server Render (tahan terhadap cold start Render). *(Catatan keamanan: paket `xlsx` SheetJS versi npm komunitas tidak dipilih karena versi lama memiliki kerentanan keamanan CVE yang belum ditambal di registry npm publik.)* | Menambah ukuran bundel JavaScript di `apps/web` (`exceljs` cukup besar, perlu *dynamic import* khusus Halaman 10), membutuhkan PR dependensi frontend terpisah, dan logika penataan sheet berada di sisi klien. |
| **Opsi E3** | **Tanpa dependensi baru** (beberapa berkas `.csv` terpisah atau format HTML/XML `.xls` lama) | Nol dependensi baru dan nol PR dependensi. | Tidak memenuhi syarat buku kerja **Excel `.xlsx` multi-sheet** yang sesungguhnya; berkas `.xls` berbasis XML/HTML memunculkan dialog peringatan keamanan ("format file tidak cocok") saat dibuka di Microsoft Excel modern. |

### 4.2 Evaluasi Pilihan Ekspor PDF

| Opsi | Pendekatan / Pustaka & Lisensi | Kelebihan | Kekurangan / Pertimbangan |
|---|---|---|---|
| **Opsi P1 (Direkomendasikan untuk Diet Paket & Kualitas Vektor)** | **Tampilan Laporan Cetak A4 Khusus Next.js + CSS `@media print` (`window.print()`)** | **Nol dependensi baru** (tidak butuh PR dependensi PDF). **Nol beban RAM** di server gratis Render. Menyematkan **SVG vektor 100% tajam** langsung dari `serializeSchematicSvgWithLightTheme` (`apps/web/lib/hybrid-topology.ts`) dan grafik ECharts resolusi tinggi (`getDataURL({ pixelRatio: 2 })`), lengkap dengan *page break* rapi, header/footer halaman cetak, dan pemaksaan tema cetak terang meski pengguna sedang memakai Mode Gelap. | Pengguna perlu melakukan 1 klik tambahan di dialog cetak browser (memilih tujuan **"Simpan sebagai PDF"** / *"Save as PDF"*), dan hasil tata letak antar browser (Chrome/Edge vs Firefox) sedikit dipengaruhi pengaturan margin cetak pengguna (dapat dikendalikan lewat aturan `@page { size: A4; margin: 14mm; }`). |
| **Opsi P3 (Alternatif Unduh 1-Klik di Browser)** | **Browser `jspdf` + `jspdf-autotable`** (Lisensi: **MIT**) | Menghasilkan unduhan berkas `.pdf` **langsung 1-klik** tanpa dialog cetak browser dan tanpa membebani RAM Render. Dapat dimuat secara dinamis (`await import(...)`) hanya saat tombol diklik di Halaman 10 sehingga tidak membebani halaman lain. | Menambah 2 dependensi frontend (`jspdf` dan `jspdf-autotable`) yang wajib diajukan lewat PR dependensi terpisah. Untuk menyematkan skema SVG dari `serializeSchematicSvgWithLightTheme`, SVG harus dirasterisasi ke PNG resolusi tinggi via `<canvas>` HTML5 terlebih dahulu sebelum dimasukkan ke PDF. |
| **Opsi P2 (Tidak Direkomendasikan untuk Render Gratis)** | **Backend Python `reportlab` (BSD)** atau **`weasyprint` (BSD)** | Menghasilkan berkas PDF seragam di server. | **`weasyprint`** bergantung pada pustaka sistem C tingkat OS (`Cairo`, `Pango`, `GDK-PixBuf`) dan mengonsumsi RAM besar yang berisiko menyebabkan *build failure* atau kehabisan RAM 512 MB di Render gratis. **`reportlab`** memang Python murni, tetapi penulisan tata letak tabel multi-halaman jauh lebih kaku serta konverter `svglib` sering gagal merender elemen `<marker>` panah SVG dari `SystemSchematicSvg`, sehingga tetap memerlukan pustaka rasterisasi tambahan. |

### 4.3 Ekspor CSV dan JSON (Nol Dependensi Baru)

Ekspor berkas **CSV deret waktu 8.760 jam Tahun 1**, **CSV jadwal arus kas tahunan**, **CSV tabel hasil sapuan kombinasi**, dan **JSON proyek/hasil lengkap** tidak membutuhkan pustaka pihak ketiga apa pun. Utilitas pembuat CSV akan dilengkapi fungsi *escaping* standar (tanda kutip ganda dan koma aman) serta penanda UTF-8 BOM opsional agar langsung terbaca rapi saat dibuka di Excel Indonesia.

### 4.4 Kebijakan PR Dependensi Terpisah

Jika pemilik proyek menyetujui paket baru (misalnya **Opsi E1 `openpyxl`** untuk Excel, dan bila memilih **Opsi P3 `jspdf` + `jspdf-autotable`** untuk PDF):
1. Penambahan paket akan diajukan terlebih dahulu dalam **PR dependensi terpisah** (`deps/add-stage-7-export-libs`) yang mencatat ukuran paket, lisensi, dan bukti build/tes lulus.
2. Setelah PR dependensi tersebut disetujui dan digabungkan ke `main`, barulah PR implementasi kode Tahap 7 dimulai.

---

## 5. Rancangan UI Halaman 9 (Bandingkan), Halaman 10 (Ekspor), dan Navigasi 10 Halaman

### 5.1 Pembaruan Navigasi `HybridShell.tsx` (Halaman 1 sampai 10)

Daftar `STEPS` pada `apps/web/components/hybrid/HybridShell.tsx` diperluas dari 8 langkah menjadi **10 langkah penuh** sesuai `AGENTS.md` bagian 9.1:

| No | Kunci (`key`) | Rute Next.js | Label ID | Label EN |
|---|---|---|---|---|
| 1 sampai 8 | `projects` .. `results` | *(tetap sama seperti Tahap 5/6A)* | Proyek .. Hasil | Projects .. Results |
| 9 | `compare` | `/hybrid/[projectId]/compare` | Bandingkan | Compare |
| 10 | `export` | `/hybrid/[projectId]/export` | Ekspor | Export |

Tombol **"Lanjut: Bandingkan"** otomatis muncul di bawah Halaman 8 (`/results`), dan **"Lanjut: Ekspor"** muncul di bawah Halaman 9 (`/compare`). Pada layar sempit (`360px`), daftar `stepper` tetap dapat digulir horizontal dengan nyaman tanpa membuat `document.documentElement` melebar melebihi viewport.

---

### 5.2 Halaman 9: Bandingkan (`/hybrid/[projectId]/compare`)

Halaman ini memiliki **3 tab bergaris bawah** (`role="tablist"`, `role="tab"`, `role="tabpanel"`):

1. **Tab 1: Sapuan Kombinasi HOMER**
   - **Panel Konfigurasi Rentang Sapuan (kolom kiri / atas pada mobile):**
     - Input daftar ukuran untuk **PV (`kWp`)**, **BESS (`kWh`, boleh `0`)**, dan **Biomass (`kW`, boleh `0`)** menggunakan pemilih nilai cepat + input manual angka yang langsung tervalidasi.
     - Opsi ukuran inverter PV (`Ikuti Rasio DC/AC Dasar` vs `Tetap`), batas kelayakan opsional (`Maks. Unmet Load %`, `Min. Pangsa Terbarukan %`), pilihan metrik peringkat awal (`LCOE Terendah`, `NPC Terendah`, `NPV Tertinggi`, `IRR Tertinggi`, `Pangsa Terbarukan Tertinggi`), serta penghitung langsung jumlah kombinasi (mis. `18 / 64 kombinasi`).
     - Tombol aksi spesifik: **"Jalankan Sapuan Kombinasi"** (dan **"Batalkan Sapuan"** saat job berjalan).
   - **Area Hasil Sapuan (kolom kanan / bawah pada mobile):**
     - **Keadaan Kosong:** Instruksi singkat cara menentukan rentang kWp/kWh/kW dan tombol pintas memuat rentang contoh `[REAL DATA]`.
     - **Keadaan Memuat:** Bilah progres nyata (`X dari Y kombinasi`, persentase `tabular-nums`) dan banner cold start Render bila menunggu > 3 detik.
     - **Keadaan Galat:** Pesan ramah berbahasa Indonesia berdasar kode galat backend + tombol **"Jalankan Ulang Sapuan"** tanpa menghapus rentang input.
     - **Hasil Terisi:**
       - Kartu sorotan **Konfigurasi Pemenang (#1)** dengan ringkasan ukuran, LCOE, NPV, IRR, NPC, dan pangsa terbarukan.
       - Grafik sebar Pareto ECharts (**LCOE vs Pangsa Energi Terbarukan**, membedakan titik layak vs tidak layak lewat bentuk simbol dan warna `DESIGN.md`).
       - Tabel seluruh kombinasi dengan header lengket (`sticky`), filter ("Hanya yang memenuhi batasan", filter komponen aktif), pengurutan ulang per kolom, chip status (`Layak`, `Marjinal`, `Tidak Layak`), dan dua tombol aksi pada setiap baris:
         1. **"Terapkan ke Proyek Aktif"**: Memperbarui ukuran PV/BESS/Biomass dan status topologi proyek saat ini (lewat `syncProjectFromTopology` agar kanvas Halaman 4 tetap sinkron) dan menandai hasil simulasi lama perlu dihitung ulang atau mengarahkan ke Halaman 7.
         2. **"Simpan sebagai Skenario Baru"**: Membuat duplikat proyek baru di `localStorage` dengan ukuran kombinasi terpilih sehingga langsung dapat dibandingkan di Tab 2.
       - Tombol **"Ekspor CSV Hasil Sapuan"**.

2. **Tab 2: Bandingkan Skenario Proyek**
   - Mengambil daftar proyek tersimpan dari `hybrid-storage.ts` yang sudah memiliki hasil simulasi tersimpan (`getSimulationResult(id)`). Proyek aktif otomatis dipilih bersama opsi memilih hingga **4 skenario** sekaligus.
   - **Keadaan Kosong:** Penjelasan bahwa minimal 2 skenario tersimulasikan dibutuhkan untuk perbandingan, disertai tautan ke Halaman 1 (`/hybrid`) atau Tab 1 (simpan hasil sapuan sebagai skenario baru).
   - **Tabel Perbandingan Berdampingan:** Membandingkan strategi dispatch, ukuran PV/BESS/Biomass, LCOE, NPC, NPV, IRR, Payback, Pangsa Terbarukan, Unmet Load, dan Emisi Dihindari secara `tabular-nums`, dengan lencana teks **"Terbaik"** (bukan warna saja) pada sel pemenang tiap metrik.
   - **Grafik Pembanding ECharts:** Grafik batang berdampingan membandingkan bauran energi tahunan (PV, Biomass, Grid) dan grafik perbandingan LCOE / NPC antar skenario.

3. **Tab 3: Sensitivitas Hybrid (Tornado & Matriks)**
   - **Kontrol Variabel & Pergeseran:** Pemilih variabel sensitivitas yang ingin diuji, pilihan rentang geser (bawaan `-20%, -10%, +10%, +20%`), opsi menyertakan **Matriks Sensitivitas `5 x 5`** (pemilih sumbu X dan sumbu Y yang berbeda), serta tombol aksi spesifik **"Hitung Sensitivitas Hybrid"**.
   - **Grafik Tornado ECharts:** Batang horizontal dua arah terhadap NPV (atau pilihan tampilan LCOE) yang diurutkan dari dampak absolut terbesar di atas ke terkecil di bawah, memakai warna status positif/negatif yang kontras.
   - **Matriks Sensitivitas `5 x 5` + Panel Inspeksi:** Grid interaktif 25 sel yang dapat dinavigasi dengan keyboard (`Tab` dan `Enter`/`Space` memilih sel) untuk membaca nilai eksak NPV, LCOE, IRR, dan status kelayakan tanpa mengandalkan warna semata.
   - **Catatan Jujur & Aksesibilitas:** Catatan otomatis untuk variabel komponen nonaktif (`skipped: true`) atau nilai dasar nol (`zero_base: true`), ditambah tabel data sensitivitas beraksesibilitas pembaca layar di bawah grafik.

---

### 5.3 Halaman 10: Ekspor Laporan (`/hybrid/[projectId]/export`)

Halaman ini menampilkan tiga kartu ekspor utama dan pratinjau isi laporan, semuanya dari data nyata hasil simulasi terakhir (`getSimulationResult(projectId)`) serta opsional hasil sapuan terakhir (`getSweepResult(projectId)`):

1. **Keadaan Kosong (jika proyek belum disimulasikan):**
   Menampilkan penjelas singkat bahwa laporan membutuhkan hasil simulasi nyata dari mesin hitung, beserta tombol langsung **"Buka Halaman 7: Jalankan Simulasi"**.
2. **Kartu Ekspor Laporan PDF:**
   - Pilihan cakupan lampiran (Ringkasan Eksekutif, Skema Aliran SVG Tahun 1 dari `serializeSchematicSvgWithLightTheme`, Ringkasan Teknis & Bulanan, Tabel Arus Kas Tahunan, Lampiran Asumsi `[REAL DATA]`, serta opsional Ringkasan Sapuan Kombinasi bila tersedia).
   - Tombol aksi spesifik: **"Buat Laporan PDF"** / **"Cetak / Simpan sebagai PDF"** (sesuai opsi PDF yang dipilih pemilik di Bagian 4.2).
   - Area pratinjau tata letak cetak (`A4`, selalu memakai token tema terang `DESIGN.md` agar kontras di atas kertas putih).
3. **Kartu Ekspor Buku Kerja Excel (`.xlsx`):**
   - Menampilkan pratinjau daftar sheet yang akan dibuat:
     1. `Ringkasan`: Metadata proyek, sumber cuaca, ukuran sistem, KPI teknis & keuangan, status kelayakan, serta emisi CO2e.
     2. `Energi_Bulanan`: Tabel 12 bulan (beban, PV, biomass, BESS charge/discharge, grid impor/ekspor, unmet load, curtailment).
     3. `Arus_Kas_Tahunan`: Jadwal lengkap Tahun 0 sampai Tahun N beserta rincian LCOE.
     4. `Asumsi_Konfigurasi`: Seluruh parameter PV, BESS, Biomass, EMS, dan Keuangan dengan penanda sumber `[REAL DATA]`.
     5. `Hasil_Sapuan` *(opsional bila sudah menjalankan sapuan)*: Tabel peringkat kombinasi gaya HOMER.
   - Tombol aksi spesifik: **"Unduh Buku Kerja Excel (.xlsx)"** dengan keadaan memuat dan penanganan galat yang jelas.
4. **Kartu Ekspor Data Mentah (CSV & JSON):**
   - **"Unduh CSV Deret Waktu 8.760 Jam"** (`hourly_year_1.csv` dari hasil simulasi; jika simulasi sebelumnya tidak menyertakan `hourly_year_1`, tampilkan catatan jujur dan tautan jalankan ulang dengan opsi deret per jam).
   - **"Unduh CSV Arus Kas Tahunan"** (`cashflow_schedule.csv`).
   - **"Unduh CSV Hasil Sapuan"** (aktif bila hasil sapuan tersedia).
   - **"Unduh Berkas Proyek & Hasil JSON"**.

### 5.4 Kepatuhan Kualitas Antarmuka (`AGENTS.md` 9.3 & `DESIGN.md`)

- **Tiga keadaan wajib:** Setiap panel (Sapuan, Perbandingan Skenario, Tornado, Matriks `5 x 5`, Ekspor PDF, Ekspor Excel) memiliki state **kosong**, **memuat**, dan **galat**.
- **Responsif mulai lebar `360px`:** Tidak ada horizontal overflow pada `document.documentElement`. Tabel lebar (sapuan kombinasi, perbandingan skenario, matriks 5x5, arus kas) ditempatkan di dalam wadah `.tw` dengan `overflow-x: auto` dan `tabIndex={0}`. Seluruh tombol memenuhi minimal tinggi sentuh `44px`.
- **Aksesibilitas keyboard:** Tidak ada `focus:outline-none` tanpa pengganti. Semua kontrol, tab (`role="tab"`), sel matriks `5 x 5`, dan baris aksi memakai `:focus-visible` yang kontras dan nama aksesibel yang jelas.
- **Mode Terang & Gelap Penuh:** Seluruh kartu, tabel, grafik ECharts (Pareto, Pembanding Skenario, Tornado), dan warna status memakai token semantik `DESIGN.md` dan ikut berubah saat toggle tema ditekan; khusus dokumen cetak PDF dipaksa ke tema terang agar hemat tinta dan tajam.

---

## 6. Kriteria Selesai dan Rencana Pengujian Tahap 7

PR implementasi kode Tahap 7 (setelah kontrak ini disetujui dan PR dependensi bila ada telah digabung) baru boleh dinyatakan selesai apabila seluruh kriteria berikut lulus:

1. **Tes Backend (`cd services/calculation-engine && pytest`):**
   - Tes job sapuan kombinasi asinkron (`POST /v1/hybrid/sweep/jobs`, `GET /v1/hybrid/sweep/jobs/{job_id}`, `POST .../cancel`), termasuk skenario kombinasi PV + BESS (`0` dan `>0`) + Biomass (`0` dan `>0`) serta penyaringan batasan kelayakan.
   - **Tes kesetaraan cache PV pada sapuan:** Membuktikan bahwa hasil sapuan dengan cache PV per ukuran unik memiliki selisih tepat `0.0` terhadap eksekusi terpisah tanpa cache.
   - Tes batas keamanan: penolakan `422 sweep_combinations_exceeded` (> 64 kombinasi), `422 sweep_full_hourly_limit_exceeded` (> 12 kombinasi pada `full_hourly`), `422 invalid_sweep_axis`, serta `404 sweep_job_not_found`.
   - Tes sensitivitas hybrid (`POST /v1/hybrid/sensitivity`): verifikasi urutan dampak Tornado, kesetaraan jalur cepat variabel keuangan murni terhadap simulasi penuh, perlakuan `skipped: true` untuk variabel komponen nonaktif, serta validasi Matriks `5 x 5`.
   - Tes ekspor `.xlsx` (bila Opsi E1 disetujui): membaca ulang biner `.xlsx` hasil endpoint di `pytest` untuk memverifikasi keberadaan seluruh sheet dan kecocokan angka terhadap hasil simulasi.
   - Regresi penuh seluruh 212+ tes yang sudah ada di `main` (termasuk seluruh tes `/v1/pv/*`) tetap lulus tanpa satu pun tes dilemahkan.
2. **Tes & Build Frontend (`cd apps/web && npm test && npm run build`):**
   - Tes unit klien API Tahap 7 (`hybrid-api.test.ts`), penerjemah kode galat baru (`errors-id.test.ts`), helper penerapan & penyimpanan skenario pemenang sapuan (`hybrid-storage.test.ts` + kesetaraan topologi), utilitas ekspor CSV (`hybrid-export.test.ts`), serta tes kontras WCAG AA (`contrast.test.ts`).
   - `npm run build` dan `tsc --noEmit` lulus bersih tanpa galat.
3. **Verifikasi UI Langsung:**
   - Menjalankan backend FastAPI dan frontend Next.js secara lokal, menguji langsung alur Halaman 8 -> Halaman 9 (Sapuan kombinasi, Pareto, Terapkan ke proyek, Simpan skenario, Bandingkan 2+ skenario, Tornado & Matriks 5x5) -> Halaman 10 (Ekspor PDF dengan skema SVG, Excel `.xlsx`, CSV 8.760 jam, JSON).
   - Memverifikasi layout desktop dan mobile `360px` tanpa horizontal overflow, menguji mode terang dan gelap penuh, navigasi keyboard penuh, serta memastikan konsol browser bebas error.

---

## 7. Keputusan Pemilik Proyek yang Telah Dikonfirmasi

Seluruh 4 keputusan desain, pustaka ekspor, batas sapuan, dan sensitivitas Tahap 7 telah dikonfirmasi oleh pemilik proyek pada 2026-11-26:

1. **Pilihan Ekspor PDF (Bagian 4.2):** **Opsi P1** disetujui (Tampilan Laporan Cetak A4 khusus Next.js + CSS `@media print` / `window.print()`, nol dependensi baru untuk PDF, nol beban RAM Render, dan memakai SVG vektor murni dari `serializeSchematicSvgWithLightTheme`). Endpoint `POST /v1/hybrid/export/pdf` tidak dibuat.
2. **Pilihan Ekspor Excel `.xlsx` (Bagian 4.1):** **Opsi E1** disetujui (Backend Python `openpyxl` berlisensi MIT melalui PR dependensi terpisah `deps/add-engine-openpyxl`, dengan endpoint `POST /v1/hybrid/export/excel`).
3. **Batas Aman Kombinasi Sapuan dan Penskalaan Otomatis (Bagian 2.2 dan 3):** Disetujui (maksimal **64 kombinasi** untuk `scaled_year_1`, maksimal **12 kombinasi** untuk `full_hourly`, maksimal 10 nilai unik per sumbu, rasio DC/AC inverter `keep_dc_ac_ratio`, serta C-rate BESS mengikuti konfigurasi dasar atau `0,5 C` bila BESS dasar nonaktif).
4. **Variabel Bawaan Sensitivitas Tornado Hybrid dan Matriks `5 x 5` (Bagian 2.3):** Disetujui (6 variabel bawaan `capex_total`, `electricity_tariff`, `discount_rate`, `biomass_fuel_price`, `om_total`, `pv_degradation_rate`, pergeseran `-20%, -10%, +10%, +20%`, serta Matriks Sensitivitas `5 x 5`).
