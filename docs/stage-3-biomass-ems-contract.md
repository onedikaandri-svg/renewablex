# Kontrak Mesin Hybrid Tahap 3: Model Biomass dan Kesiapan EMS Kustom

**Status dokumen:** Usulan kontrak revisi sesuai keputusan pemilik proyek:
- **Tahap 3A (Model Biomass, Preset Bahan Bakar, dan Integrasi Simulator):** Siap diimplementasikan setelah PR kontrak ini disetujui.
- **Tahap 3B (EMS Kustom):** Ditunda sampai pemilik proyek selesai menyiapkan berkas skema EMS terpisah di GitHub untuk digabungkan ke sistem.

---

## 1. Kompatibilitas Mundur, Prinsip Arsitektur, dan Pembagian Tahap 3A vs 3B

1. **Mode cepat tetap utuh:** Endpoint screening PV tahunan (`/v1/pv/preliminary` dan `/v1/pv/sensitivity`) tidak diubah struktur JSON maupun perhitungannya.
2. **Kompatibilitas Tahap 1 dan Tahap 2 terjaga penuh:** Ketika komponen `biomass` tidak diaktifkan, seluruh keluaran, `config_hash`, dan kasus acuan Jakarta pada Tahap 1 (`contract_version: "0.1"`) serta Tahap 2 (`contract_version: "0.2"`) tetap identik.
3. **Tanpa dependensi baru:** Seluruh implementasi memakai pustaka standar Python dan NumPy yang sudah terpasang.
4. **Pembagian cakupan Tahap 3:**
   - **Tahap 3A (Aktif sekarang):**
     - Implementasi `BiomassComponent` sesuai kontrak `EnergyComponent` (`validate`, `available_power_kw`, `step`, `lifecycle_events`) di `app/hybrid/biomass.py`.
     - Katalog preset sampel beberapa jenis bahan bakar biomassa (`fuel_preset`, berlabel `[REAL DATA]`) beserta aturan timpa (override) per parameter.
     - Profil sampel pembangkit biomassa (`[REAL DATA]`) untuk uji dan contoh siap jalan, tanpa menutup input bebas dari pengguna.
     - Perluasan `PowerBalanceSeries` (`pv_generation_kw` dan `biomass_generation_kw`), perluasan 5 strategi dispatch bawaan Tahap 2 agar mendukung Biomass, serta perluasan `DispatchContext` dan `DispatchDecision` untuk slot Biomass.
     - Pembaruan CLI (`run`) dan rangkaian tes unit, tes properti, serta tes neraca daya tertutup.
   - **Tahap 3B (Ditunda):**
     - Penggabungan berkas skema EMS baru yang sedang dibuat pemilik di GitHub.
     - Interpreter aturan EMS kustom (`CustomEMSStrategy` di `app/hybrid/ems.py`), validator skema EMS, dan perintah CLI `trace` khusus inspeksi aturan kustom.

---

## 2. Model Komponen Biomass (`BiomassComponent` dan `BiomassConfig`)

Model pembangkit listrik biomassa melacak status operasi, batasan ramp rate (kecepatan perubahan daya per jam), durasi menyala dan mati minimum, kuota bahan bakar, ketersediaan unit, emisi, dan kejadian overhaul pada setiap langkah waktu secara berurutan.

### 2.1 Parameter Konfigurasi (`BiomassConfig`)

#### A. Kapasitas dan Dinamika Operasi
- `rated_capacity_kw` (> 0): kapasitas daya listrik maksimum pembangkit dalam satuan kW.
- `min_load_fraction` (0 sampai 1) atau `min_load_kw` (>= 0): batas beban teknis minimum saat unit berstatus beroperasi (`running`). Jika diisi salah satu, nilai lain diturunkan dari `rated_capacity_kw`.
- `ramp_up_kw_per_hour` dan `ramp_down_kw_per_hour` (> 0): laju maksimum kenaikan dan penurunan daya listrik per jam. Pada langkah waktu `step_hours`, batas perubahan daya per langkah adalah `ramp_rate * step_hours`.
- `startup_time_hours` dan `shutdown_time_hours` (>= 0): durasi transisi untuk menyalakan dan mematikan unit. Selama unit berstatus transisi (`starting` atau `stopping`), daya listrik ke bus adalah `0.0 kW`.
- `min_up_time_hours` dan `min_down_time_hours` (>= 0): durasi minimum unit harus tetap menyala sebelum boleh dimatikan, serta durasi minimum unit harus tetap mati sebelum boleh dinyalakan kembali.
- `startup_fuel_tons` (>= 0, bawaan `0.0`): konsumsi bahan bakar tambahan setiap kali terjadi proses penyalaan (start).

#### B. Kurva Konsumsi Bahan Bakar Beban Parsial (`fuel_curve_model`)
Kurva konsumsi bahan bakar bersifat eksplisit melalui konfigurasi (mesin tidak menanam kurva tersembunyi tanpa sumber, dan sampel pengujian memakai profil berlabel `[REAL DATA]` pada Sub-bagian 2.3):
1. **`piecewise_heat_rate`:** daftar pasangan titik `(load_fraction, heat_rate_kj_per_kwh)` minimal 2 titik berurutan naik mencakup rentang `[min_load_fraction, 1.0]`. Heat rate adalah energi panas bahan bakar (kJ) untuk menghasilkan 1 kWh listrik; nilai di antara titik dihitung dengan interpolasi linear.
2. **`piecewise_efficiency`:** daftar pasangan titik `(load_fraction, electrical_efficiency_fraction)` dengan efisiensi di `(0, 1]`, dikonversi menjadi `heat_rate_kj_per_kwh = 3600.0 / efficiency` (1 kWh setara 3.600 kJ).
3. **`willans_linear`:** model linear beban parsial bergaya HOMER memakai `no_load_fuel_kw_th` (konsumsi panas tanpa beban, kW termal) dan `slope_kw_th_per_kw_el` (kemiringan konsumsi panas per kW listrik tambahan), dengan energi panas per langkah `(no_load_fuel_kw_th + slope_kw_th_per_kw_el * output_kw) * 3.6 * step_hours` (dalam MJ).

#### C. Karakteristik Bahan Bakar, Preset (`fuel_preset`), Pasokan, dan Logistik
- `fuel_preset`: opsional (`"efb"`, `"wood_pellet"`, `"pks"`, `"woodchip"`, `"rice_husk"`, atau `"custom"`).
  - **Aturan resolusi:** Jika `fuel_preset` diisi (selain `"custom"`), nilai bawaan sampel `[REAL DATA]` dari katalog Sub-bagian 2.2 dimuat terlebih dahulu, lalu setiap field bahan bakar yang diisi eksplisit oleh pengguna pada konfigurasi akan **menimpa (override)** nilai preset tersebut.
  - Jika `fuel_preset` tidak diisi atau bernilai `"custom"`, seluruh parameter bahan bakar wajib disediakan eksplisit oleh pengguna.
- `fuel_name`: nama jenis bahan bakar.
- `lhv_mj_per_kg` (> 0): Lower Heating Value atau nilai kalor bawah bahan bakar (MJ/kg).
- `lhv_basis`: `"as_received"` (kondisi siap bakar/diterima) atau `"dry"` (basis kering bebas air).
- `moisture_fraction` (0 sampai kurang dari 1): kadar air dalam fraksi massa.
  - Jika `lhv_basis == "as_received"`, `lhv_effective_mj_per_kg = lhv_mj_per_kg`.
  - Jika `lhv_basis == "dry"`, nilai kalor efektif kondisi terima dihitung dengan rumus termodinamika standar:
    `lhv_effective_mj_per_kg = lhv_mj_per_kg * (1.0 - moisture_fraction) - 2.443 * moisture_fraction`
    (konstanta `2,443 MJ/kg` adalah kalor laten penguapan air pada suhu acuan 25 C). Validator menolak jika `lhv_effective_mj_per_kg <= 0`.
- **Konversi massa bahan bakar per langkah:**
  - `fuel_energy_mj = (heat_rate_kj_per_kwh * output_kw * step_hours) / 1000.0` (atau langsung dari rumus `willans_linear`).
  - `fuel_kg = fuel_energy_mj / lhv_effective_mj_per_kg` dan `fuel_tons = fuel_kg / 1000.0`.
- `fuel_price_per_ton` (>= 0) dan `logistics_cost_per_ton` (>= 0): harga bahan bakar dan biaya logistik per ton dalam mata uang proyek.
- `supply_period`: `"unlimited"`, `"daily"`, `"monthly"`, atau `"annual"`, disertai `supply_limit_tons` (wajib > 0 jika bukan `"unlimited"`). Kuota pemakaian di-reset pada awal setiap periode.

#### D. Ketersediaan Terjadwal dan Tak Terjadwal
- `scheduled_outage_windows`: daftar jadwal pemeliharaan terencana dengan format `{"start_day": int, "end_day": int}` (hari 1..365, inklusif) atau `{"start_hour_of_year": float, "end_hour_of_year": float}` (independen terhadap `step_minutes`, tidak menanam angka `8760` mati).
- `unplanned_outage_rate` (Forced Outage Rate, `0` sampai kurang dari `1`), `mean_time_to_repair_hours` (> 0 jika rate > 0), dan `outage_seed` (bilangan bulat tetap).
- Jadwal gangguan acak dibangkitkan secara deterministik sebelum loop simulasi berdasarkan `outage_seed` dan `TimeConfig`.

#### E. Biaya O&M dan Overhaul
- `fixed_om_per_kw_year` (>= 0): biaya O&M tetap per kW kapasitas terpasang per tahun.
- `variable_om_per_kwh` (>= 0): biaya O&M variabel per kWh listrik yang dihasilkan.
- `startup_cost` (>= 0): biaya tambahan setiap kali unit melakukan start.
- `overhaul_interval_operating_hours` (opsional, > 0) dan `overhaul_cost` (>= 0): ketika akumulasi jam operasi sejak overhaul terakhir mencapai interval, komponen mencatat `LifecycleEvent(year, "biomass_overhaul", ..., cost_amount=overhaul_cost)` dan mereset penghitung jam sejak overhaul.

#### F. Faktor Emisi
- Mendukung `emission_factor_kg_co2e_per_kg_fuel` (>= 0) atau `emission_factor_kg_co2e_per_kwh` (>= 0) untuk emisi pembakaran, ditambah `supply_chain_emission_kg_co2e_per_ton` (>= 0) untuk emisi transportasi dan pengolahan bahan bakar.
- `biogenic_co2_accounting`: `"zero_net"` (emisi CO2 biogenik pembakaran dihitung nol secara neto, menyisakan rantai pasok dan gas non-CO2 bila diisi) atau `"gross"` (menjumlahkan total emisi pembakaran dan rantai pasok).
- `is_renewable` (boolean, bawaan `True`) dan `emission_source_note` (teks sumber acuan).

#### G. Persiapan Antarmuka CHP (Combined Heat and Power)
Pemanfaatan panas proses (ko-generasi) disiapkan pada antarmuka namun pemanfaatan termal penuh ditunda ke tahap lanjut:
- `chp_enabled: bool = False`
- `heat_to_power_ratio: float | None = None` atau `thermal_efficiency_fraction: float | None = None`
- Bila `chp_enabled = True`, komponen mencatat `thermal_output_kw_th` pada state per langkah dan total `total_thermal_output_kwh_th` di ringkasan tanpa memengaruhi neraca daya listrik.

---

### 2.2 Katalog Sampel Jenis Bahan Bakar Biomassa (`[REAL DATA]`)

Sesuai arahan pemilik proyek, Tahap 3A menyediakan 5 preset sampel bahan bakar biomassa yang siap dipilih melalui `fuel_preset`. Seluruh angka di bawah ini adalah **nilai sampel ilustratif (`[REAL DATA]`)** untuk pemodelan awal dan dapat ditimpa per field pada konfigurasi JSON ketika data kontrak pasokan nyata tersedia.

| `fuel_preset` | Nama Bahan Bakar | Kadar Air (`moisture_fraction`) | LHV Kondisi Terima (`lhv_mj_per_kg`, `as_received`) | Harga Sampel (`fuel_price_per_ton`, IDR) | Biaya Logistik (`logistics_cost_per_ton`, IDR) | Emisi Rantai Pasok (`supply_chain_emission_kg_co2e_per_ton`) | Status |
|---|---|---|---|---|---|---|---|
| `efb` | Empty Fruit Bunch (Tandan Kosong Kelapa Sawit) | `0.45` (45%) | `8.5` | `350000` | `150000` | `35.0` | `[REAL DATA]` |
| `wood_pellet` | Wood Pellet (Pelet Kayu) | `0.08` (8%) | `17.5` | `2200000` | `200000` | `65.0` | `[REAL DATA]` |
| `pks` | Palm Kernel Shell (Cangkang Kelapa Sawit) | `0.12` (12%) | `16.5` | `1100000` | `150000` | `45.0` | `[REAL DATA]` |
| `woodchip` | Woodchip (Serpihan Kayu) | `0.30` (30%) | `12.2` | `650000` | `150000` | `40.0` | `[REAL DATA]` |
| `rice_husk` | Rice Husk (Sekam Padi) | `0.12` (12%) | `13.5` | `400000` | `120000` | `30.0` | `[REAL DATA]` |

*(Catatan: seluruh preset di atas menggunakan `biogenic_co2_accounting = "zero_net"`, `is_renewable = true`, dan `supply_period = "unlimited"` kecuali ditimpa pada konfigurasi proyek.)*

---

### 2.3 Profil Sampel Pembangkit Biomassa (`[REAL DATA]`)

Sesuai arahan pemilik proyek, disediakan dua profil sampel pembangkit untuk contoh konfigurasi dan pengujian awal (pengguna tetap bebas memasukkan parameter sendiri sesuai datasheet proyek nyata):

1. **Sampel A (`sample_gasifier_250kw`, Skala Menengah 250 kW, Gasifikasi / Gas Engine `[REAL DATA]`):**
   - `rated_capacity_kw = 250.0`, `min_load_fraction = 0.40` (100 kW)
   - `ramp_up_kw_per_hour = 125.0`, `ramp_down_kw_per_hour = 125.0`
   - `startup_time_hours = 1.0`, `shutdown_time_hours = 1.0`, `min_up_time_hours = 4.0`, `min_down_time_hours = 2.0`
   - `fuel_curve_model = "piecewise_heat_rate"`, titik: `[(0.40, 16500.0), (0.75, 14200.0), (1.00, 13500.0)]` kJ/kWh
   - `unplanned_outage_rate = 0.03`, `mean_time_to_repair_hours = 6.0`, `overhaul_interval_operating_hours = 8000.0`
2. **Sampel B (`sample_steam_turbine_1000kw`, Skala Industri 1.000 kW, Boiler + Turbin Uap `[REAL DATA]`):**
   - `rated_capacity_kw = 1000.0`, `min_load_fraction = 0.45` (450 kW)
   - `ramp_up_kw_per_hour = 200.0`, `ramp_down_kw_per_hour = 250.0`
   - `startup_time_hours = 3.0`, `shutdown_time_hours = 2.0`, `min_up_time_hours = 8.0`, `min_down_time_hours = 4.0`
   - `fuel_curve_model = "piecewise_heat_rate"`, titik: `[(0.45, 17800.0), (0.75, 15200.0), (1.00, 14400.0)]` kJ/kWh
   - `unplanned_outage_rate = 0.04`, `mean_time_to_repair_hours = 12.0`, `overhaul_interval_operating_hours = 16000.0`

---

### 2.4 Mesin State (`BiomassState`) dan Invarian Fisik Wajib

State per langkah untuk `BiomassComponent` mencakup:
- `status`: salah satu dari `"off"`, `"starting"`, `"running"`, `"stopping"`, `"outage"`.
- `current_power_kw`: daya listrik aktual saat ini (kW).
- `hours_in_state`: durasi unit berada di `status` saat ini (jam).
- `hours_running_continuous`: durasi terus-menerus unit berstatus `"running"` (jam).
- `hours_stopped_continuous`: durasi terus-menerus unit tidak berproduksi untuk evaluasi `min_down_time_hours` (jam).
- `total_operating_hours`: total kumulatif jam unit menghasilkan listrik (jam).
- `hours_since_overhaul`: akumulasi jam operasi sejak overhaul terakhir (jam).
- `startup_count`, `overhaul_count`: jumlah kejadian start dan overhaul.
- `fuel_consumed_period_tons`, `fuel_consumed_total_tons`: pemakaian bahan bakar pada periode pasokan aktif dan total kumulatif.
- `co2e_emitted_kg`: total emisi CO2e kumulatif (kg).
- `thermal_output_kw_th`: keluaran panas CHP pada langkah berjalan (kW termal, `0.0` jika CHP nonaktif).

Aturan transisi status:
- `off -> starting` (atau langsung `running` jika `startup_time_hours == 0`) hanya boleh terjadi jika tidak sedang `outage`, `hours_stopped_continuous >= min_down_time_hours`, dan sisa pasokan bahan bakar mencukupi minimal beban `min_load_kw`.
- `running -> stopping` (atau langsung `off` jika `shutdown_time_hours == 0`) pada kondisi normal hanya boleh terjadi jika `hours_running_continuous >= min_up_time_hours`.
- **Pemberhentian paksa (`forced_stop`):** Jika terjadi gangguan (`outage`) atau kuota bahan bakar habis di tengah operasi, unit langsung dipaksa berhenti ke `outage` atau `off` meskipun `min_up_time_hours` belum terpenuhi, dan alasan paksa ini dicatat eksplisit pada jejak langkah (`trace_reason`).

Enam invarian fisik wajib (diuji lewat tes unit dan tes properti):
1. Ketika berstatus `"running"`, `min_load_kw <= output_kw <= rated_capacity_kw`.
2. Perubahan daya antar langkah saat `"running"` selalu berada dalam batas `[-ramp_down_kw_per_hour * step_hours, +ramp_up_kw_per_hour * step_hours]` (kecuali saat baru masuk `"running"` pada `min_load_kw`, atau pada `forced_stop`).
3. Batas `min_up_time_hours` dan `min_down_time_hours` dipatuhi pada seluruh transisi normal (kecuali `forced_stop`).
4. Selama status `"off"`, `"starting"`, `"stopping"`, atau `"outage"`, keluaran daya listrik ke bus selalu `0.0 kW`.
5. Total konsumsi bahan bakar pada setiap periode pasokan tidak pernah melebihi `supply_limit_tons`.
6. Pembangkitan jadwal gangguan tak terjadwal bersifat 100% deterministik untuk `outage_seed` yang sama.

---

## 3. Kesiapan Titik Sambung EMS Kustom untuk Tahap 3B (Ditunda)

Sesuai keputusan pemilik proyek, berkas skema EMS kustom akan dibuat oleh pemilik secara terpisah di GitHub dan digabungkan nanti ketika sistem siap (**Tahap 3B**).

Agar proses penggabungan berkas EMS pemilik nanti berjalan mulus tanpa menulis ulang simulator, **Tahap 3A** menyiapkan titik colok (plugin point) bersih sebagai berikut:

1. **Perluasan `DispatchContext` (masukan per langkah waktu untuk pengambil keputusan):**
   Selain variabel PV, beban, tarif, dan BESS yang sudah ada pada Tahap 2, konteks diperluas dengan:
   - `pv_surplus_kw`: kelebihan daya PV setelah beban dan beban parasitik.
   - `net_load_kw`: selisih beban total terhadap `pv_available_kw`.
   - `biomass_status`: status operasi Biomass saat ini (`"off"`, `"starting"`, `"running"`, `"stopping"`, `"outage"`).
   - `biomass_available_kw`: daya maksimum yang mampu dipasok Biomass pada langkah ini dengan mempertimbangkan ramp rate, status, dan kuota bahan bakar.
   - `biomass_current_power_kw`: daya keluaran Biomass dari langkah sebelumnya.
   - `biomass_min_load_kw`: batas beban minimum Biomass.
   - `biomass_can_start`: apakah Biomass memenuhi syarat `min_down_time_hours`, tidak outage, dan punya bahan bakar cukup.
   - `biomass_can_stop`: apakah Biomass memenuhi syarat `min_up_time_hours` untuk berhenti normal.
   - `biomass_fuel_remaining_tons`: sisa kuota bahan bakar pada periode berjalan (`None` jika `"unlimited"`).
2. **Perluasan `DispatchDecision` (keluaran keputusan per langkah waktu):**
   - `biomass_command_kw: float = 0.0` (permintaan daya listrik Biomass dalam kW).
   - `biomass_start_request: bool = False` dan `biomass_stop_request: bool = False`.
   - `trace_reason: str` (penjelasan keputusan untuk setiap langkah).
3. **Antarmuka `DispatchStrategy` (`decide(ctx) -> DispatchDecision`):**
   - Menjadi satu-satunya titik sambung bagi `CustomEMSStrategy` saat berkas EMS pemilik dari GitHub digabungkan di Tahap 3B.
4. **Prinsip keamanan wajib saat Tahap 3B digabungkan nanti:**
   - Skema EMS murni berupa data JSON terversi (dilarang `eval`, `exec`, `compile`, atau eksekusi kode bebas).
   - Seluruh variabel, operator, aksi, validator, dan mode jejak keputusan (`trace`) wajib mengikuti daftar putih (whitelist) dan tidak boleh melanggar invarian fisik komponen (seperti `charge_kw * discharge_kw == 0` atau batas ramp rate/SOC).

---

## 4. Integrasi Simulator, Neraca Daya, dan Keluaran Tahap 3A

1. **Neraca daya tertutup per jam:**
   Persamaan neraca daya tetap berlaku penuh dengan `generation_kw = pv_generation_kw + biomass_generation_kw`:
   ```text
   generation_kw + discharge_kw + grid_import_kw
     = served_load_kw + charge_kw + grid_export_kw + curtailment_kw + losses_kw
   ```
   ```text
   served_load_kw + unmet_load_kw = load_kw
   ```
   Pada `PowerBalanceSeries`, deret `pv_generation_kw` dan `biomass_generation_kw` disimpan terpisah (bernilai `0.0` bila tidak aktif).
2. **Perluasan 5 strategi dispatch bawaan Tahap 2 saat Biomass aktif:**
   - `self_consumption`: PV melayani beban dan mengisi BESS; defisit ditutup BESS dulu, lalu sisa defisit ditutup Biomass jika masih ada.
   - `load_following`: Biomass beroperasi mengikuti sisa beban bersih setelah PV dan BESS.
   - `cycle_charging`: Saat Biomass perlu menyala untuk menutup defisit atau mengisi BESS menuju `target_soc_fraction`, Biomass beroperasi pada daya lebih tinggi (dalam batas kapasitas dan ramp) untuk sekaligus mengisi BESS.
   - `peak_shaving`: PV dan BESS memangkas puncak di atas `peak_limit_kw`; bila tidak cukup, Biomass membantu menahan beban di bawah batas puncak.
   - `time_of_use_arbitrage`: Mengikuti jadwal jam puncak/luar puncak BESS, dengan Biomass sebagai penutup sisa defisit beban sesuai batas operasionalnya.
3. **Keluaran ringkasan dan CSV:**
   - `summary.json` menambah objek `biomass_summary` (energi listrik dihasilkan kWh, jam operasi, jumlah start, total bahan bakar ton, biaya bahan bakar dan logistik, emisi CO2e kg, jumlah overhaul, serta keluaran termal CHP jika aktif).
   - `hourly_balance.csv` menambahkan kolom `biomass_generation_kw`, `biomass_status`, dan `biomass_fuel_tons` saat Biomass aktif.
   - Metrik `renewable_fraction` menghitung pangsa beban yang dipasok energi terbarukan (PV ditambah Biomass jika `is_renewable = True`, tidak termasuk `grid_import`).
4. **Kriteria selesai Tahap 3A (pengujian wajib):**
   - Tes unit `BiomassComponent` (3 model kurva bahan bakar, konversi LHV basis kering ke terima, ramp rate, min up/down time, startup/shutdown, kuota pasokan, dan event overhaul).
   - Tes seluruh 5 `fuel_preset` (`efb`, `wood_pellet`, `pks`, `woodchip`, `rice_husk`) beserta mekanisme override per field.
   - Tes kedua profil sampel pembangkit (`250 kW` dan `1.000 kW`).
   - Tes properti untuk 6 invarian fisik Biomass dan sifat deterministik `outage_seed`.
   - Tes integrasi simulasi tertutup PV + BESS + Biomass pada strategi dispatch bawaan dengan selisih neraca daya selalu di bawah `1e-6 kW`.
   *(Catatan: Tes validator dan interpreter aturan EMS kustom JSON masuk cakupan Tahap 3B setelah berkas EMS pemilik digabungkan.)*

---

## 5. Contoh JSON Konfigurasi Tahap 3A (Siap Uji dengan Sampel Preset)

Seluruh angka pada contoh berikut bersifat **sampel ilustratif (`[REAL DATA]`)** dan sudah dapat langsung dijalankan pada Tahap 3A memakai strategi dispatch bawaan `load_following` serta `fuel_preset: "efb"`:

```json
{
  "contract_version": "0.3",
  "project": {
    "project_name": "Pabrik Hybrid PV BESS Biomass EFB",
    "latitude": -6.2,
    "longitude": 106.8,
    "timezone": "Asia/Jakarta",
    "currency_code": "IDR"
  },
  "simulation": {
    "step_minutes": 60,
    "leap_day_policy": "ignore_feb_29",
    "weather_source": "pvgis_tmy",
    "dispatch_strategy": "load_following"
  },
  "components": {
    "pv": {
      "model": "detailed_v1",
      "capacity_kwp": 500.0,
      "inverter_ac_kw": 420.0
    },
    "bess": {
      "enabled": true,
      "nominal_capacity_kwh": 600.0,
      "max_charge_kw": 300.0,
      "max_discharge_kw": 300.0
    },
    "biomass": {
      "enabled": true,
      "rated_capacity_kw": 250.0,
      "min_load_fraction": 0.40,
      "ramp_up_kw_per_hour": 125.0,
      "ramp_down_kw_per_hour": 125.0,
      "startup_time_hours": 1.0,
      "shutdown_time_hours": 1.0,
      "min_up_time_hours": 4.0,
      "min_down_time_hours": 2.0,
      "fuel_curve_model": "piecewise_heat_rate",
      "fuel_curve_points": [
        [0.40, 16500.0],
        [0.75, 14200.0],
        [1.00, 13500.0]
      ],
      "fuel_preset": "efb",
      "supply_period": "monthly",
      "supply_limit_tons": 220.0,
      "unplanned_outage_rate": 0.03,
      "mean_time_to_repair_hours": 6.0,
      "outage_seed": 42,
      "fixed_om_per_kw_year": 450000.0,
      "variable_om_per_kwh": 120.0,
      "overhaul_interval_operating_hours": 8000.0,
      "overhaul_cost": 150000000.0,
      "chp_enabled": false
    }
  }
}
```

Contoh variasi memakai preset pelet kayu dengan penimpaan (override) harga dan kadar air proyek tertentu:

```json
"biomass": {
  "enabled": true,
  "fuel_preset": "wood_pellet",
  "fuel_price_per_ton": 2050000.0,
  "moisture_fraction": 0.09
}
```

---

## 6. Ringkasan Keputusan Pemilik dan Langkah Berikutnya

Keempat keputusan pemilik proyek pada 2026-11-26 sudah diterapkan pada dokumen kontrak ini:
1. **EMS Kustom (Tahap 3B) ditunda** sampai berkas EMS terpisah dari pemilik di GitHub siap digabungkan ke sistem; Tahap 3A menyiapkan titik sambung `DispatchContext`, `DispatchDecision`, dan `DispatchStrategy`.
2. **Datasheet pembangkit biomassa memakai profil sampel ilustratif (`[REAL DATA]`)** pada Sub-bagian 2.3 (250 kW dan 1.000 kW) sambil tetap mendukung parameter bebas pengguna.
3. **Katalog preset bahan bakar biomassa (`[REAL DATA]`)** menyediakan 5 pilihan (`efb`, `wood_pellet`, `pks`, `woodchip`, `rice_husk`) yang dapat langsung dipakai atau ditimpa per field.
4. **Implementasi Tahap 3A siap dimulai** pada cabang baru (`engine/stage-3a-biomass`) segera setelah PR kontrak `docs/stage-3-contract` disetujui dan digabungkan ke `main`.
