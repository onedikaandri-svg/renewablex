# Kontrak Mesin Hybrid Tahap 4: Keuangan, Umur Proyek Multi-Tahun, dan Emisi

**Status dokumen:** Usulan kontrak (menunggu persetujuan pemilik proyek sebelum penulisan kode Tahap 4).
**Cakupan:** Simulasi umur proyek multi-tahun (degradasi PV, degradasi dan penggantian BESS, overhaul Biomass, penggantian inverter), model arus kas tahunan (`pre_tax` dan opsional `after_tax`), metrik keuangan lengkap (NPC, LCOE beserta rincian per komponen, NPV, IRR, payback sederhana, payback terdiskonto), akuntansi emisi proyek dibanding baseline jaringan listrik, serta uji pembanding terhadap kasus bawaan `docs/reference/kiyo.html`.

---

## 1. Kompatibilitas Mundur dan Prinsip Arsitektur

1. **Mode cepat tetap utuh:** Endpoint screening PV tahunan (`/v1/pv/preliminary` dan `/v1/pv/sensitivity`) serta `app/services/finance.py` tidak diubah struktur JSON maupun perhitungannya.
2. **Kompatibilitas Tahap 1, 2, dan 3A:** Ketika simulasi hanya dijalankan untuk 1 tahun tanpa blok `finance` atau `project_lifetime_years`, seluruh hasil teknis, `config_hash`, dan kasus acuan Jakarta tetap identik.
3. **Isolasi modul baru:**
   - `services/calculation-engine/app/hybrid/lifetime.py`: orkestrator simulasi umur proyek multi-tahun (`LifetimeConfig`, `YearlyTechnicalResult`, `LifetimeSimulationResult`, `run_lifetime_simulation`).
   - `services/calculation-engine/app/hybrid/finance.py`: mesin analisis keuangan dan emisi (`FinanceConfig`, `YearlyCashFlowRow`, `LCOEBreakdown`, `EmissionsSummary`, `FinanceSummary`, `FinanceResult`, `run_financial_analysis`).
4. **Tanpa dependensi produksi baru:** Seluruh perhitungan memakai pustaka standar Python dan NumPy murni. Paket `numpy-financial` di `requirements-dev.txt` hanya dipakai pada pengujian otomatis sebagai pembanding independen IRR dan NPV.
5. **Rumus hanya di backend dan presisi penuh:** Seluruh perhitungan arus kas dan metrik keuangan berjalan di backend. Pembulatan hanya dilakukan saat format tampilan atau ekspor; perhitungan payback dan arus kas kumulatif memakai angka presisi penuh tanpa pembulatan antara.

---

## 2. Simulasi Umur Proyek Multi-Tahun (`app/hybrid/lifetime.py`)

Parameter utama:
- `project_lifetime_years`: umur proyek dalam tahun (bawaan `25`, rentang valid `1` sampai `40`).
- `multi_year_mode`: pilihan `"full_hourly"` (bawaan) atau `"scaled_year_1"`.

Dua mode eksekusi:
1. **`"full_hourly"` (bawaan, akurasi penuh):**
   Menjalankan simulasi per langkah waktu (`run_simulation`) untuk setiap tahun proyek `y = 1..N` sambil membawa state nyata komponen dari akhir tahun `y - 1` ke awal tahun `y`:
   - **PV:** menerapkan degradasi tahunan majemuk mulai Tahun 2 (`simulation_year = y`, faktor `(1 - annual_degradation_fraction)^(y - 1)`), serta mencatat jadwal penggantian inverter bila `inverter_replacement_year` diisi.
   - **BESS:** meneruskan state `soc_fraction`, `effective_capacity_kwh`, `equivalent_full_cycles`, `calendar_age_years`, `cycles_since_replacement`, `age_since_replacement`, dan `replacement_count` antar tahun, sehingga `LifecycleEvent("bess_replacement")` terpicu tepat pada tahun kapasitas baterai menyentuh batas akhir umur (EOL).
   - **Biomass:** meneruskan `hours_since_overhaul`, `total_operating_hours`, `overhaul_count`, serta state operasi antar tahun sehingga `LifecycleEvent("biomass_overhaul")` terpicu tepat pada tahun akumulasi jam operasi mencapai interval overhaul.
2. **`"scaled_year_1"` (estimasi cepat untuk sapuan konfigurasi besar di Tahap 7):**
   Menjalankan simulasi per langkah waktu untuk Tahun 1 saja, lalu menskalakan produksi PV tahun ke-`y` dengan faktor degradasi `(1 - annual_degradation_fraction)^(y - 1)` dan menyisipkan penggantian komponen sesuai interval tahunan tetap (jika ditentukan). Metadata keluaran menandai mode yang dipakai secara jujur agar pengguna mengetahui penyederhanaan ini.

---

## 3. Model Arus Kas, Pajak, Nilai Sisa, dan Metrik Keuangan (`app/hybrid/finance.py`)

### 3.1 Masukan Keuangan (`FinanceConfig`)

1. **Mata uang dan modal awal (CAPEX, biaya investasi awal Tahun 0):**
   - `currency_code` (bawaan `"IDR"`, dapat diganti mis. `"USD"`).
   - CAPEX per komponen dapat diisi sebagai nilai nominal total (`pv_capex`, `bess_capex`, `biomass_capex`, `bos_and_other_capex`) atau diturunkan otomatis dari biaya satuan dikali kapasitas terpasang (`pv_capex_per_kwp`, `bess_capex_per_kwh`, `biomass_capex_per_kw`).
   - **Insentif:** `capital_grant_amount` atau `capital_grant_fraction` (hibah modal yang mengurangi CAPEX bersih Tahun 0), serta `tax_credit_fraction` (kredit pajak investasi pada Tahun 1 untuk mode `after_tax`).
2. **Biaya operasi dan pemeliharaan (OPEX, dimulai Tahun 1):**
   - PV: `pv_fixed_om_per_kwp_year` atau `pv_om_fraction_of_capex` (persentase terhadap CAPEX PV, misalnya untuk kasus uji pembanding `kiyo.html`).
   - BESS: `bess_fixed_om_per_kwh_year` (atau `bess_om_fraction_of_capex`).
   - Biomass: otomatis mengambil biaya tahunan nyata dari `biomass_summary` (`total_fixed_om_cost`, `total_variable_om_cost`, `total_fuel_cost`, `total_logistics_cost`, `total_startup_cost`), atau dapat ditimpa secara eksplisit bila diperlukan.
3. **Biaya penggantian dan overhaul:**
   - Otomatis ditarik dari `LifecycleEvent` tahun `y` (`bess_replacement` dan `biomass_overhaul`), ditambah `inverter_replacement_year` dan `inverter_replacement_cost` bila dikonfigurasi.
4. **Pendapatan dan biaya transaksi jaringan listrik:**
   - `revenue_mode`:
     - `"avoided_cost"` (bawaan untuk proyek swakonsumsi industri/komersial): penghematan biaya listrik dari beban yang dipasok sistem sendiri (`max(served_load_kwh - grid_import_kwh, 0.0) * electricity_tariff_per_kwh`), ditambah pendapatan ekspor listrik ke jaringan (`grid_export_kwh * grid_export_tariff_per_kwh`) bila ekspor diizinkan.
     - `"ppa_generation"`: pendapatan penjualan energi terpakai pada tarif jual listrik PPA (`served_load_kwh * electricity_tariff_per_kwh` atau energi dibangkitkan sesuai kontrak), ditambah ekspor bila berlaku.
   - `electricity_tariff_per_kwh`, `grid_import_tariff_per_kwh` (biaya beli listrik dari jaringan saat defisit), `grid_export_tariff_per_kwh`, dan `unmet_load_penalty_per_kwh` (bawaan `0.0`).
5. **Diskonto dan eskalasi (konvensi seragam):**
   - Seluruh eskalasi majemuk dimulai pada Tahun 2 (`(1 + rate)^(y - 1)`), sehingga Tahun 1 memakai nilai dasar.
   - `discount_rate` (WACC atau biaya modal rata-rata tertimbang nominal, wajib `> -1.0`), `tariff_escalation_rate`, `om_escalation_rate`, `fuel_escalation_rate`, `replacement_escalation_rate`.
6. **Nilai sisa pada akhir umur proyek (Salvage Value pada Tahun `N`):**
   - Menggunakan metode depresiasi umur pakai linear bergaya HOMER untuk komponen yang mengalami penggantian atau overhaul pada tahun `y_repl`:
     `salvage = replacement_cost_y * (remaining_life_years / component_life_years)`
     dengan `remaining_life_years = component_life_years - (N - y_repl)` bila `remaining_life_years > 0`.
   - Umur desain rujukan untuk nilai sisa: `bess_design_life_years`, `inverter_design_life_years`, `biomass_overhaul_life_years`, ditambah opsi `residual_salvage_fraction_of_capex` (bawaan `0.0`).
   - Nilai sisa masuk sebagai arus kas positif pada akhir Tahun `N` dan mengurangi Net Present Cost (NPC).
7. **Pajak dan depresiasi:**
   - `tax_model`: `"pre_tax"` (bawaan, sebelum pajak) atau `"after_tax"` (setelah pajak).
   - Pada `"after_tax"`: memakai `corporate_tax_rate` (0 sampai kurang dari 1) dan depresiasi garis lurus atas CAPEX yang dapat didepresiasi selama `depreciation_years` (bawaan `min(project_lifetime_years, 10)`). Pajak tahun `y` dihitung dari `max(operating_income_y - annual_depreciation_y, 0.0) * corporate_tax_rate`, dikurangi `tax_credit` pada Tahun 1 bila ada.

### 3.2 Rumus Metrik Keuangan (`FinanceSummary`)

1. **Total Net Present Cost (NPC):**
   Nilai kini seluruh biaya proyek selama `N` tahun dikurangi pendapatan ekspor dan nilai sisa terdiskonto:
   ```text
   NPC = Net_CAPEX_0
       + sum_{y=1..N} (OM_y + Fuel_Logistics_y + Grid_Import_Cost_y + Replacement_y + Tax_y - Export_Revenue_y) / (1 + r)^y
       - Salvage_N / (1 + r)^N
   ```
2. **LCOE (Levelized Cost of Energy, biaya pokok pembangkitan rata-rata terdiskonto per kWh):**
   ```text
   LCOE = PV_Energy_Supply_Costs / sum_{y=1..N} (Served_Load_kWh_y / (1 + r)^y)
   ```
   dengan komponen biaya terbagi rapi dalam objek `lcoe_breakdown` (`capex_pv`, `capex_bess`, `capex_biomass`, `capex_bos`, `om`, `fuel_and_logistics`, `replacement_and_overhaul`, `grid_import`, `tax_net_credit`, `salvage_credit`, dan `export_credit`). Jumlah seluruh pos pada `lcoe_breakdown` wajib tepat sama dengan `lcoe` total.
3. **NPV (Net Present Value, nilai bersih kini):**
   ```text
   NPV = sum_{y=0..N} (CF_y / (1 + r)^y)
   ```
   dengan `CF_0 = -Net_CAPEX_0` dan `CF_y` adalah arus kas bersih proyek pada Tahun `y`.
4. **IRR (Internal Rate of Return, tingkat pengembalian internal):**
   Dicari menggunakan metode bisection terkurung pada rentang `[-0.99, 100.0]` terhadap vektor arus kas `[CF_0, CF_1, ..., CF_N]`, mengembalikan pasangan `(irr, irr_status)` dengan status `ok`, `no_sign_change`, `ambiguous`, atau `not_found` (tidak pernah menghasilkan `NaN`).
5. **Simple Payback dan Discounted Payback:**
   - **Simple Payback:** tahun pertama saat arus kas kumulatif tak terdiskonto menjadi `>= 0`, diinterpolasi secara linear di dalam tahun tersebut menggunakan nilai presisi penuh.
   - **Discounted Payback:** tahun pertama saat arus kas kumulatif terdiskonto menjadi `>= 0`, diinterpolasi secara linear di dalam tahun tersebut.
   - Keduanya mengembalikan `(years, "recovered")` atau `(None, "not_recovered")`.
6. **Status kelayakan (`viability_status`):**
   - `"viable"` jika `npv > 0` dan `irr_status == "ok"` serta `irr >= discount_rate + viability_irr_margin` (bawaan margin `0.02` atau 2%).
   - `"marginal"` jika `npv >= 0` dan tidak memenuhi syarat `"viable"`.
   - `"unviable"` jika `npv < 0`.

### 3.3 Jadwal Arus Kas Tahunan (`YearlyCashFlowRow` untuk Tahun `0..N`)

Setiap baris jadwal memuat `year`, `served_load_kwh`, `pv_generation_kwh`, `biomass_generation_kwh`, `grid_import_kwh`, `capex_outflow`, `gross_revenue_or_savings`, `export_revenue`, `om_cost`, `fuel_and_logistics_cost`, `grid_import_cost`, `replacement_and_overhaul_cost`, `salvage_inflow`, `tax_outflow`, `net_cash_flow`, `discounted_cash_flow`, `cumulative_cash_flow`, dan `cumulative_discounted_cash_flow`. Struktur ini langsung dipakai tabel dan grafik arus kas di frontend Tahap 5 tanpa perhitungan ulang.

---

## 4. Model Emisi Umur Proyek (`EmissionsSummary`)

- `grid_emission_factor_kg_co2e_per_kwh`: faktor emisi jaringan listrik referensi (diambil dari konfigurasi atau sampel berlabel `[REAL DATA]` sampai nilai resmi ditetapkan pemilik).
- Perhitungan selama `N` tahun:
  - `baseline_grid_emissions_kg_co2e = sum_y(served_load_kwh_y) * grid_emission_factor_kg_co2e_per_kwh`
  - `project_emissions_kg_co2e = sum_y(grid_import_kwh_y * grid_emission_factor_kg_co2e_per_kwh + biomass_co2e_kg_y)`
  - `avoided_emissions_kg_co2e = baseline_grid_emissions_kg_co2e - project_emissions_kg_co2e`
  - `avoided_emissions_tons_co2e = avoided_emissions_kg_co2e / 1000.0`

---

## 5. Kasus Uji Pembanding `docs/reference/kiyo.html` dan Kriteria Selesai Tahap 4

Sesuai `AGENTS.md` bagian 9.4, konfigurasi bawaan prototipe `kiyo.html` dijadikan **kasus uji pembanding resmi** pada backend Python:
- Kapasitas PV `500 kWp`, specific yield `1.450 kWh/kWp/tahun`, degradasi `0,55%/tahun`, CAPEX `Rp 11.500.000/kWp`, O&M `1,5%` CAPEX dengan inflasi `2%/tahun`, tarif `Rp 1.445/kWh` dengan eskalasi `2%/tahun`, WACC `9,5%`, umur `25` tahun, faktor emisi grid `0,78 kg CO2/kWh`, pajak `pre_tax`.
- Pengujian akan memverifikasi kesesuaian NPV, IRR, simple payback, discounted payback, LCOE, dan emisi terhadap rumus prototipe serta mendokumentasikan bila ada selisih kecil akibat definisi penyebut LCOE atau konvensi pembulatan.

Kriteria selesai Tahap 4:
1. Tes unit rumus arus kas, NPV, IRR (termasuk validasi silang terhadap `numpy-financial`), simple & discounted payback, NPC, LCOE + penjumlahan `lcoe_breakdown`, salvage value linear, mode `pre_tax` vs `after_tax`, insentif hibah/kredit pajak, dan emisi terhadap hitungan tangan.
2. Tes kasus uji pembanding `kiyo.html` lulus dalam toleransi ketat.
3. Tes simulasi multi-tahun (`full_hourly`) memverifikasi degradasi PV tahunan, perpindahan state BESS yang memicu `bess_replacement`, perpindahan jam operasi Biomass yang memicu `biomass_overhaul`, serta neraca daya tertutup (`< 1e-6 kW`) di setiap tahun.
4. Tes CLI (`contract_version: "0.4"`) menghasilkan `summary.json` (dengan `finance_summary` dan `emissions_summary`) serta `cashflow_schedule.csv`.

---

## 6. Contoh Perluasan JSON Konfigurasi Tahap 4 (Ilustratif `[REAL DATA]`)

Seluruh nilai biaya, tarif, dan faktor emisi di bawah ini bersifat **sampel ilustratif (`[REAL DATA]`)** hanya untuk memperlihatkan struktur skema `contract_version: "0.4"`:

```json
{
  "contract_version": "0.4",
  "project": {
    "project_name": "Pabrik Hybrid 25 Tahun [REAL DATA]",
    "latitude": -6.2,
    "longitude": 106.8,
    "timezone": "Asia/Jakarta",
    "currency_code": "IDR"
  },
  "simulation": {
    "step_minutes": 60,
    "leap_day_policy": "ignore_feb_29",
    "weather_source": "pvgis_tmy",
    "dispatch_strategy": "load_following",
    "project_lifetime_years": 25,
    "multi_year_mode": "full_hourly"
  },
  "components": {
    "pv": {
      "model": "detailed_v1",
      "capacity_kwp": 500.0,
      "inverter_ac_kw": 420.0,
      "annual_degradation_fraction": 0.005
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
      "overhaul_cost": 150000000.0
    }
  },
  "finance": {
    "tax_model": "pre_tax",
    "revenue_mode": "avoided_cost",
    "discount_rate": 0.10,
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
  }
}
```

---

## 7. Konfirmasi yang Dibutuhkan dari Pemilik Proyek

Sebelum penulisan kode implementasi Tahap 4 dimulai, mohon konfirmasi 3 hal berikut:

1. **Asumsi ekonomi sampel / default (`[REAL DATA]`):** Apakah Anda menyetujui pemakaian nilai sampel ilustratif berlabel `[REAL DATA]` seperti pada contoh di atas (misalnya WACC 10%, umur 25 tahun, tarif Rp 1.445/kWh, eskalasi 2%, faktor emisi grid 0,78 kg CO2/kWh) untuk pengembangan dan contoh pengujian, atau ada angka resmi tertentu yang ingin langsung ditetapkan sekarang?
2. **Mode pajak bawaan:** Apakah mode bawaan tetap `pre_tax` (sebelum pajak) dengan dukungan opsional `after_tax` (depresiasi garis lurus + tarif pajak badan, misalnya PPh Badan Indonesia 22%)?
3. **Mode simulasi multi-tahun bawaan:** Apakah Anda setuju mode bawaan memakai `"full_hourly"` (simulasi per jam penuh di seluruh tahun umur proyek) dengan opsi `"scaled_year_1"` untuk estimasi cepat?
