# Kontrak Mesin Hybrid Tahap 2: PV Detail, BESS, dan Strategi Dispatch

**Status dokumen:** Usulan kontrak (menunggu persetujuan pemilik proyek sebelum penulisan kode Tahap 2).
**Cakupan:** Rantai model PV detail setara SAM, model baterai BESS dengan degradasi dan penggantian, 5 strategi dispatch bawaan, serta uji banding PV terhadap `pvlib`.

---

## 1. Kompatibilitas Mundur dan Prinsip Arsitektur

1. **Mode cepat tetap utuh:** Endpoint screening PV tahunan (`/v1/pv/preliminary` dan `/v1/pv/sensitivity`) tidak berubah.
2. **Kompatibilitas Tahap 1:** Konfigurasi `pvwatts_v1` dan kasus acuan Jakarta pada Tahap 1 tetap berjalan tanpa mengubah hasil maupun kontrak CLI yang sudah ada.
3. **Semua tetap berbasis komponen:** Baik PV detail maupun BESS mengimplementasikan antarmuka seragam `EnergyComponent` (`validate`, `available_power_kw`, `step`, `lifecycle_events`).

---

## 2. Rantai Model PV Detail (8 Tahap Terpilih)

Seluruh perhitungan produksi PV berjalan secara vektorisasi menggunakan **NumPy murni** pada lingkungan produksi (tanpa menambah beban memori `pvlib`/`scipy`/`pandas` ke server produksi). Setiap tahap dapat dipilih melalui konfigurasi `PVDetailedConfig`:

| Tahap | Pilihan Model | Parameter Utama | Keluaran / Rugi Tercatat |
|---|---|---|---|
| **1. Posisi matahari & dekomposisi** | `spencer` + opsional `erbs` (Erbs 1982) | `latitude`, `longitude`, `decompose_ghi_if_missing` | Sudut zenith, azimuth matahari, serta DNI/DHI bila cuaca hanya memuat GHI |
| **2. Transposisi POA** | `isotropic`, `hay_davies`, `perez` (Perez 1990, 8 kelas epsilon) | `albedo` | Irradiansi bidang panel `poa_w_m2` (beam, diffuse langit, pantulan tanah) |
| **3. Geometri array & tracking** | `fixed`, `single_axis` (utara-selatan), `two_axis` | `tilt_degrees`, `azimuth_degrees`, `max_angle_deg`, `backtracking`, `gcr` | Sudut kemiringan & orientasi dinamis tiap jam serta cos(AOI) |
| **4. Optik & permukaan** | `ashrae_iam`, soiling bulanan, salju opsional | `iam_b0`, `soiling_monthly` (12 nilai), `snow_loss_monthly` (12 nilai) | `iam_loss_kwh`, `soiling_loss_kwh`, `snow_loss_kwh` |
| **5. Suhu sel** | `noct` atau `faiman` (memakai `T2m` dan `WS10m`) | `noct_c` atau `faiman_u0`, `faiman_u1` | Suhu sel `cell_temp_c` tiap jam |
| **6. Daya DC modul** | `pvwatts` atau `single_diode` (parameter datasheet 5-parameter) | `capacity_kwp`, `temp_coeff_per_c`; atau `i_sc`, `v_oc`, `i_mp`, `v_mp`, `alpha_sc`, `beta_voc`, `cells_in_series`, `n_modules_series`, `n_strings_parallel` | `dc_nominal_kwh`, `temperature_loss_kwh`, `dc_after_temp_kw` |
| **7. Rugi sistem rinci** | Multiplikatif per faktor + degradasi tahunan | `mismatch_fraction`, `dc_wiring_fraction`, `shading_fraction`, `availability_fraction`, `lid_fraction`, `annual_degradation_fraction` (dari tahun 2) | `mismatch_loss_kwh`, `dc_wiring_loss_kwh`, `shading_loss_kwh`, `availability_loss_kwh`, `lid_loss_kwh`, `degradation_loss_kwh` |
| **8. Inverter** | `constant` atau `efficiency_curve` (`efficiency_curve_points`) | `inverter_ac_kw`, `inverter_efficiency` atau kurva beban parsial, `night_tare_kw` | `inverter_loss_kwh`, `clipping_loss_kwh`, `night_tare_kwh`, dan daya AC bersih |

Catatan penting:
- Seluruh rugi dari irradiansi POA nominal hingga AC bersih disimpan terpisah pada `pv_loss_breakdown_kwh` sehingga diagram rugi waterfall tertutup tanpa selisih.
- Konsumsi daya malam inverter (`night_tare_kw`) saat PV tidak berproduksi dicatat eksplisit pada neraca daya sistem.

---

## 3. Model BESS (`BESSComponent`)

Model baterai menyimpan dan memperbarui state pada setiap langkah waktu secara berurutan.

### 3.1 Parameter Konfigurasi (`BESSConfig`)
- **Kapasitas & daya:** `nominal_capacity_kwh`, batas daya `max_charge_kw` dan `max_discharge_kw` (atau diturunkan dari `c_rate_charge` dan `c_rate_discharge` bila diberikan).
- **Batas SOC:** `soc_min_fraction` (bawaan `0,20`), `soc_max_fraction` (bawaan `0,95`), `initial_soc_fraction` (bawaan `0,50`).
- **Efisiensi & rugi:** `charge_efficiency`, `discharge_efficiency`, `pcs_loss_fraction` (rugi Power Conversion System pada AC/DC), dan `aux_load_kw` (konsumsi pendingin/kontrol tambahan baterai).
- **Degradasi & umur (semi-empiris aditif):**
  - `calendar_fade_per_year`: penurunan kapasitas akibat umur kalender.
  - `cycle_fade_per_efc`: penurunan kapasitas per Equivalent Full Cycle (EFC, dihitung dari total energi discharge dibagi kapasitas efektif).
  - `eol_capacity_fraction`: ambang batas akhir umur baterai (misalnya `0,80` atau 80% dari kapasitas nominal awal).

### 3.2 State & Invarian Fisik Wajib
- **State baterai:** `soc_fraction`, `effective_capacity_kwh`, `equivalent_full_cycles`, `calendar_age_years`, `replacement_count`.
- **Penggantian baterai:** Ketika `effective_capacity_kwh <= nominal_capacity_kwh * eol_capacity_fraction`, komponen mencatat `LifecycleEvent(year, "bess_replacement", ...)` dan mereset kapasitas efektif ke kapasitas nominal.
- **Invarian wajib (diuji lewat tes properti):**
  1. Dilarang melakukan charge dan discharge bersamaan dalam satu langkah waktu (`charge_kw * discharge_kw == 0.0`).
  2. `soc_min_fraction <= soc_fraction <= soc_max_fraction` di setiap langkah waktu.
  3. Neraca energi internal baterai tertutup: perubahan energi tersimpan di baterai sama dengan energi masuk (setelah efisiensi charge) dikurangi energi keluar (sebelum efisiensi discharge).

---

## 4. Antarmuka `DispatchStrategy` dan 5 Strategi Bawaan

Untuk mencegah strategi dispatch ditanam mati di dalam kode simulator (menyiapkan jalur bersih bagi interpreter aturan EMS JSON dari pemilik di Tahap 3), dispatch dipisahkan ke antarmuka `DispatchStrategy`:

- **Masukan per langkah `t`:** `DispatchContext` berisi `step_idx`, `hour_of_day`, `month`, `load_kw`, `pv_available_kw`, `bess_soc`, `bess_max_charge_kw`, `bess_max_discharge_kw`, dan parameter tarif/grid bila berlaku.
- **Keluaran per langkah `t`:** `DispatchDecision` berisi `bess_command_kw` (positif untuk charge, negatif untuk discharge, 0 untuk diam), `grid_import_kw`, `grid_export_kw`, `curtailment_kw`, dan `trace_reason` (teks singkat alasan keputusan untuk mendukung mode trace EMS nanti).

Lima strategi bawaan yang diimplementasikan di Tahap 2:
1. **`self_consumption`:** Surplus PV mengisi BESS terlebih dahulu; kekurangan beban ditutup oleh discharge BESS, sisanya unmet load (atau impor grid bila diaktifkan).
2. **`load_following`:** BESS hanya menambal kekurangan beban terhadap PV dan menyerap surplus PV agar daya netto titik sambung mengikuti beban.
3. **`cycle_charging`:** Saat generator atau impor sumber pengisi aktif pada jam kekurangan, BESS ikut diisi menuju target `target_soc_fraction` sampai penuh atau mencapai batas daya.
4. **`peak_shaving`:** BESS discharge untuk memangkas beban puncak agar daya yang harus ditanggung sumber lain tidak melebihi ambang `peak_limit_kw`, dan charge di luar jam puncak dari surplus PV atau grid.
5. **`time_of_use_arbitrage`:** BESS mengisi saat tarif waktu rendah (`off_peak_hours` atau surplus PV) dan melepaskan energi saat tarif waktu tinggi (`peak_hours`) berdasarkan jadwal tarif yang dikonfigurasi.

---

## 5. Kebijakan `pvlib` dan Validasi Akurasi (Bagian 7.9 dan 11)

1. **Produksi memakai NumPy murni:** Paket `pvlib` tidak dimasukkan ke `requirements.txt` produksi agar image layanan tetap ringan dan menghindari ketergantungan pada `pandas`, `scipy`, dan `h5py` di lingkungan gratis Render.
2. **`pvlib` khusus di lingkungan dev/tes (`requirements-dev.txt`):** `pvlib` diusulkan lewat PR dependensi terpisah sebagai pembanding independen pada pengujian otomatis (sama seperti `numpy-financial` yang dipakai hanya untuk memvalidasi IRR di tes).
3. **Laporan uji banding wajib:** Selama implementasi Tahap 2, setiap model PV (posisi matahari, Erbs, Perez, tracking + backtracking, IAM, Faiman, satu-dioda) akan dibandingkan langsung terhadap `pvlib` untuk kasus uji Jakarta dan lintang sedang, dan seluruh selisih beserta penyebabnya akan dicatat jujur di `docs/pv-benchmark-report.md`.

---

## 6. Contoh Perluasan JSON Konfigurasi Tahap 2 (Kompatibel Mundur)

```json
{
  "contract_version": "0.2",
  "project": {
    "project_name": "Pabrik Hybrid PV BESS Tahap 2",
    "latitude": -6.2,
    "longitude": 106.8,
    "timezone": "Asia/Jakarta"
  },
  "simulation": {
    "step_minutes": 60,
    "leap_day_policy": "ignore_feb_29",
    "dispatch_strategy": "self_consumption"
  },
  "components": {
    "pv": {
      "model": "detailed_v1",
      "capacity_kwp": 500.0,
      "inverter_ac_kw": 420.0,
      "tracking_mode": "fixed",
      "transposition_model": "perez",
      "cell_temp_model": "faiman",
      "dc_model": "pvwatts",
      "tilt_degrees": 10.0,
      "azimuth_degrees": 0.0
    },
    "bess": {
      "enabled": true,
      "nominal_capacity_kwh": 600.0,
      "max_charge_kw": 300.0,
      "max_discharge_kw": 300.0,
      "charge_efficiency": 0.94,
      "discharge_efficiency": 0.94,
      "soc_min_fraction": 0.20,
      "soc_max_fraction": 0.95,
      "initial_soc_fraction": 0.50,
      "pcs_loss_fraction": 0.02,
      "aux_load_kw": 1.0,
      "eol_capacity_fraction": 0.80,
      "calendar_fade_per_year": 0.015,
      "cycle_fade_per_efc": 0.00005
    }
  }
}
```
