# Kontrak Mesin Hybrid Tahap 3: Model Biomass dan EMS Kustom

**Status dokumen:** Usulan kontrak (menunggu persetujuan pemilik proyek, datasheet biomassa nyata, dan skema EMS resmi sebelum penulisan kode Tahap 3).
**Cakupan:** Model komponen pembangkit biomassa (`BiomassComponent`), interpreter aturan EMS kustom berbasis data JSON (`CustomEMSStrategy`) lengkap dengan validator dan mode jejak keputusan (`trace`), serta integrasinya ke simulator neraca daya dan CLI.

---

## 1. Kompatibilitas Mundur, Prinsip Arsitektur, dan Urutan Pengerjaan

1. **Mode cepat tetap utuh:** Endpoint screening PV tahunan (`/v1/pv/preliminary` dan `/v1/pv/sensitivity`) tidak diubah struktur JSON maupun perhitungannya.
2. **Kompatibilitas Tahap 1 dan Tahap 2 terjaga penuh:** Ketika komponen `biomass` tidak diaktifkan dan strategi `ems` kustom tidak dipakai, seluruh keluaran, `config_hash`, dan kasus acuan Jakarta pada Tahap 1 (`contract_version: "0.1"`) serta Tahap 2 (`contract_version: "0.2"`) tetap identik.
3. **Kepatuhan antarmuka seragam:**
   - `BiomassComponent` mengimplementasikan antarmuka `EnergyComponent` (`validate`, `available_power_kw`, `step`, `lifecycle_events`) pada modul baru `app/hybrid/biomass.py`.
   - Interpreter EMS kustom (`CustomEMSStrategy`) mengimplementasikan antarmuka `DispatchStrategy` (`decide`) pada modul baru `app/hybrid/ems.py` dan disambungkan melalui `app/hybrid/dispatch.py`.
4. **Tanpa dependensi baru:** Seluruh model Biomass dan interpreter aturan EMS memakai pustaka standar Python dan NumPy yang sudah terpasang.
5. **Pembagian kerja bertahap (sesuai `AGENTS.md` bagian 10):**
   - **Tahap 3A (Biomass):** Boleh dikerjakan lebih dulu setelah kontrak model Biomass ini dan parameter datasheet nyata dari pemilik proyek disetujui.
   - **Tahap 3B (EMS Kustom):** Mulai diimplementasikan setelah skema EMS resmi dan contoh konfigurasi EMS dari pemilik proyek diterima lalu dikunci pada dokumen ini.

---

## 2. Model Komponen Biomass (`BiomassComponent` dan `BiomassConfig`)

Model pembangkit listrik biomassa melacak status operasi, batasan ramp rate (kecepatan perubahan daya), durasi menyala dan mati minimum, kuota bahan bakar, ketersediaan unit, emisi, dan kejadian overhaul pada setiap langkah waktu secara berurutan.

### 2.1 Parameter Konfigurasi (`BiomassConfig`)

#### A. Kapasitas dan Dinamika Operasi
- `rated_capacity_kw` (> 0): kapasitas daya listrik maksimum pembangkit dalam satuan kW.
- `min_load_fraction` (0 sampai 1) atau `min_load_kw` (>= 0): batas beban teknis minimum saat unit dalam status beroperasi (`running`). Jika diisi salah satu, yang lain diturunkan dari `rated_capacity_kw`.
- `ramp_up_kw_per_hour` dan `ramp_down_kw_per_hour` (> 0): laju maksimum kenaikan dan penurunan daya listrik per jam. Pada langkah waktu `step_hours`, perubahan daya maksimum per langkah adalah `ramp_rate * step_hours`.
- `startup_time_hours` dan `shutdown_time_hours` (>= 0): waktu transisi yang dibutuhkan untuk menyalakan dan mematikan unit. Selama unit berada pada status transisi (`starting` atau `stopping`), daya listrik yang dikirim ke bus adalah `0.0 kW`.
- `min_up_time_hours` dan `min_down_time_hours` (>= 0): durasi minimum unit harus tetap menyala sebelum diizinkan dimatikan, serta durasi minimum unit harus tetap mati sebelum diizinkan dinyalakan kembali.
- `startup_fuel_tons` (>= 0, bawaan `0.0`): konsumsi bahan bakar tambahan setiap kali terjadi proses start (dihitung saat transisi masuk ke proses penyalaan).

#### B. Kurva Konsumsi Bahan Bakar Beban Parsial (`fuel_curve_model`)
Sesuai aturan `AGENTS.md` bagian 7.5 dan 11, mesin **tidak menanam kurva generator tebakan**. Parameter kurva wajib diisi eksplisit dari datasheet pembangkit:
1. **`piecewise_heat_rate`:** daftar pasangan titik `(load_fraction, heat_rate_kj_per_kwh)` minimal 2 titik yang berurutan naik dan mencakup rentang `[min_load_fraction, 1.0]`. Heat rate adalah jumlah energi panas bahan bakar (dalam kilojoule, kJ) yang dibutuhkan untuk menghasilkan 1 kWh listrik. Nilai di antara titik dihitung dengan interpolasi linear.
2. **`piecewise_efficiency`:** daftar pasangan titik `(load_fraction, electrical_efficiency_fraction)` dengan efisiensi berada di `(0, 1]`, lalu dikonversi menjadi `heat_rate_kj_per_kwh = 3600.0 / efficiency` (karena 1 kWh setara 3.600 kJ).
3. **`willans_linear`:** model linear beban parsial bergaya HOMER menggunakan `no_load_fuel_kw_th` (konsumsi panas tanpa beban, kW termal) dan `slope_kw_th_per_kw_el` (kemiringan konsumsi panas per kW listrik tambahan), sehingga kebutuhan energi panas per langkah adalah `(no_load_fuel_kw_th + slope_kw_th_per_kw_el * output_kw) * 3.6 * step_hours` (dalam MJ).

#### C. Karakteristik Bahan Bakar, Pasokan, dan Logistik
- `fuel_name`: nama jenis biomassa (misalnya cangkang sawit, woodchip, atau sekam padi).
- `lhv_mj_per_kg` (> 0): Lower Heating Value atau nilai kalor bawah bahan bakar dalam satuan MJ/kg.
- `lhv_basis`: `"as_received"` (nilai kalor bahan bakar dalam kondisi siap bakar/diterima) atau `"dry"` (basis kering bebas air).
- `moisture_fraction` (0 sampai kurang dari 1): kadar air bahan bakar dalam fraksi massa.
  - Jika `lhv_basis == "as_received"`, `lhv_effective_mj_per_kg = lhv_mj_per_kg`.
  - Jika `lhv_basis == "dry"`, nilai kalor efektif kondisi terima dihitung dengan rumus termodinamika standar:
    `lhv_effective_mj_per_kg = lhv_mj_per_kg * (1.0 - moisture_fraction) - 2.443 * moisture_fraction`
    (angka `2,443 MJ/kg` adalah kalor laten penguapan air pada suhu acuan 25 C). Validator menolak konfigurasi jika `lhv_effective_mj_per_kg <= 0`.
- **Konversi massa bahan bakar per langkah:**
  - `fuel_energy_mj = (heat_rate_kj_per_kwh * output_kw * step_hours) / 1000.0` (atau langsung dari rumus `willans_linear`).
  - `fuel_kg = fuel_energy_mj / lhv_effective_mj_per_kg` dan `fuel_tons = fuel_kg / 1000.0`.
- `fuel_price_per_ton` (>= 0) dan `logistics_cost_per_ton` (>= 0): harga pembelian bahan bakar dan biaya angkut/penanganan per ton dalam mata uang proyek.
- `supply_period`: `"unlimited"`, `"daily"`, `"monthly"`, atau `"annual"`, disertai `supply_limit_tons` (wajib > 0 jika `supply_period` bukan `"unlimited"`). Kuota pemakaian bahan bakar di-reset pada awal setiap periode.

#### D. Ketersediaan Terjadwal dan Tak Terjadwal
- `scheduled_outage_windows`: daftar jadwal pemeliharaan terencana menggunakan salah satu format:
  - `{"start_day": int, "end_day": int}` (hari ke-1 sampai 365, inklusif), atau
  - `{"start_hour_of_year": float, "end_hour_of_year": float}` (independen terhadap panjang `step_minutes`, tidak menanam angka `8760` mati).
- `unplanned_outage_rate` (Forced Outage Rate, `0` sampai kurang dari `1`), `mean_time_to_repair_hours` (> 0 jika `unplanned_outage_rate > 0`), dan `outage_seed` (bilangan bulat tetap).
- Sebelum loop simulasi dimulai, jadwal gangguan tak terjadwal dibangkitkan secara deterministik memakai `outage_seed` dan `TimeConfig` sehingga hasil simulasi selalu dapat diulang persis sama.

#### E. Biaya O&M dan Overhaul
- `fixed_om_per_kw_year` (>= 0): biaya operasi dan pemeliharaan tetap per kW kapasitas terpasang per tahun.
- `variable_om_per_kwh` (>= 0): biaya operasi dan pemeliharaan variabel per kWh listrik yang dihasilkan.
- `startup_cost` (>= 0): biaya tambahan setiap kali unit melakukan start.
- `overhaul_interval_operating_hours` (opsional, > 0) dan `overhaul_cost` (>= 0): ketika akumulasi jam operasi sejak overhaul terakhir mencapai atau melewati `overhaul_interval_operating_hours`, komponen mencatat `LifecycleEvent(year, "biomass_overhaul", ..., cost_amount=overhaul_cost)` dan mereset penghitung jam sejak overhaul.

#### F. Faktor Emisi (Wajib Diatur dan Bersumber)
- Mendukung `emission_factor_kg_co2e_per_kg_fuel` (>= 0) atau `emission_factor_kg_co2e_per_kwh` (>= 0) untuk emisi pembakaran langsung, ditambah `supply_chain_emission_kg_co2e_per_ton` (>= 0) untuk emisi rantai pasok (transportasi dan pengolahan bahan bakar).
- `biogenic_co2_accounting`:
  - `"zero_net"`: emisi CO2 biogenik dari pembakaran biomassa dihitung nol secara neto, sehingga total emisi berasal dari rantai pasok dan gas non-CO2 bila diisi pada faktor emisi.
  - `"gross"`: menjumlahkan total emisi pembakaran dan rantai pasok.
- `is_renewable` (boolean, bawaan `True`): menandai apakah pembangkit biomassa dihitung sebagai energi terbarukan pada metrik `renewable_fraction`.
- `emission_source_note` (teks): catatan sumber acuan resmi angka faktor emisi yang dipakai.

#### G. Persiapan Antarmuka CHP (Combined Heat and Power)
Pemanfaatan panas proses atau ko-generasi (CHP) disiapkan di antarmuka konfigurasi dan state, namun pemanfaatan termal penuh ditunda ke tahap lanjut:
- `chp_enabled: bool = False`
- `heat_to_power_ratio: float | None = None` atau `thermal_efficiency_fraction: float | None = None`
- Jika `chp_enabled = True`, setiap langkah mencatat `thermal_output_kw_th` pada state komponen dan mengakumulasi `total_thermal_output_kwh_th` di ringkasan, tanpa mengubah neraca daya listrik bus.

### 2.2 Mesin State (`BiomassState`) dan Invarian Fisik Wajib

State per langkah untuk `BiomassComponent` mencakup:
- `status`: salah satu dari `"off"`, `"starting"`, `"running"`, `"stopping"`, `"outage"`.
- `current_power_kw`: daya listrik aktual saat ini (kW).
- `hours_in_state`: durasi unit berada di `status` saat ini (jam).
- `hours_running_continuous`: durasi terus-menerus unit berstatus `"running"` (jam).
- `hours_stopped_continuous`: durasi terus-menerus unit berada di status tidak berproduksi untuk evaluasi `min_down_time_hours` (jam).
- `total_operating_hours`: total kumulatif jam unit menghasilkan listrik (jam).
- `hours_since_overhaul`: akumulasi jam operasi sejak overhaul terakhir (jam).
- `startup_count`, `overhaul_count`: jumlah kejadian start dan overhaul.
- `fuel_consumed_period_tons`, `fuel_consumed_total_tons`: pemakaian bahan bakar pada periode pasokan aktif dan total kumulatif.
- `co2e_emitted_kg`: total emisi CO2e kumulatif (kg).
- `thermal_output_kw_th`: keluaran panas CHP pada langkah berjalan (kW termal, `0.0` jika CHP nonaktif).

Aturan transisi status:
- `off -> starting` (atau langsung `running` jika `startup_time_hours == 0`) hanya boleh terjadi jika tidak sedang `outage`, `hours_stopped_continuous >= min_down_time_hours`, dan sisa pasokan bahan bakar mencukupi minimal beban `min_load_kw`.
- `running -> stopping` (atau langsung `off` jika `shutdown_time_hours == 0`) pada kondisi normal hanya boleh terjadi jika `hours_running_continuous >= min_up_time_hours`.
- **Pemberhentian paksa (`forced_stop`):** Jika terjadi gangguan (`outage`) atau kuota bahan bakar habis di tengah operasi, unit langsung dipaksa berhenti ke `outage` atau `off` meskipun `min_up_time_hours` belum terpenuhi, dan alasan paksa ini dicatat pada jejak langkah (`trace`).

Enam invarian fisik wajib (diuji lewat tes unit dan tes properti):
1. Ketika berstatus `"running"`, `min_load_kw <= output_kw <= rated_capacity_kw`.
2. Perubahan daya antar langkah saat `"running"` selalu berada dalam batas `[-ramp_down_kw_per_hour * step_hours, +ramp_up_kw_per_hour * step_hours]` (kecuali saat baru memasuki `"running"` dari `"starting"` pada `min_load_kw`, atau pada kondisi `forced_stop`).
3. Batas `min_up_time_hours` dan `min_down_time_hours` dipatuhi pada seluruh transisi normal (kecuali `forced_stop` akibat outage atau bahan bakar habis).
4. Selama status `"off"`, `"starting"`, `"stopping"`, atau `"outage"`, keluaran daya listrik ke bus selalu `0.0 kW`.
5. Total konsumsi bahan bakar pada setiap periode pasokan tidak pernah melebihi `supply_limit_tons`.
6. Pembangkitan jadwal gangguan tak terjadwal bersifat 100% deterministik untuk `outage_seed` yang sama.

---

## 3. EMS Kustom Berbasis Konfigurasi JSON (`CustomEMSStrategy`)

> **Catatan penting:** Struktur JSON EMS di bawah ini merupakan **draf acuan awal (`ems_version: "0.1"`)** berdasarkan draf di `AGENTS.md` bagian 7.7. Bentuk field, daftar operator, atau arah prioritas dapat disesuaikan dan dikunci segera setelah skema EMS resmi dari pemilik proyek diterima.

### 3.1 Prinsip Keamanan Wajib
1. **EMS adalah data, bukan kode:** Interpreter aturan hanya membaca dokumen JSON terversi. Dilarang keras memakai `eval`, `exec`, `compile`, atau parser ekspresi arbitrer.
2. **Daftar putih ketat (whitelist):** Seluruh nama variabel, operator, kombinasi logika, dan aksi harus terdaftar dalam daftar putih resmi. Field tak dikenal di skema ditolak oleh validator.

### 3.2 Daftar Putih Variabel Konteks (`DispatchContext` Terpadu)
Variabel yang boleh dirujuk pada kondisi `when` (hanya baca):
- **Waktu dan tarif:** `step_idx`, `hour` (jam lokal 0..23), `month` (1..12), `day_of_year` (1..365), `tariff_per_kwh`.
- **Beban dan PV:** `load_kw`, `parasitic_load_kw`, `pv_available_kw`, `pv_surplus_kw` (`max(pv_available_kw - total_demand, 0)`), `net_load_kw` (`total_demand - pv_available_kw`).
- **BESS:** `bess_soc` (fraksi 0..1), `bess_max_charge_kw`, `bess_max_discharge_kw`.
- **Biomass:** `biomass_status` (`"off"`, `"starting"`, `"running"`, `"stopping"`, `"outage"`), `biomass_available_kw`, `biomass_current_power_kw`, `biomass_min_load_kw`, `biomass_can_start` (boolean), `biomass_can_stop` (boolean), `biomass_fuel_remaining_tons`.
- **Referensi parameter (`params`):** Pada nilai pembanding kondisi atau batas aksi, pengguna boleh merujuk parameter bernama yang didefinisikan di blok `params`, misalnya `{"param": "soc_min"}`.

### 3.3 Operator Kondisi dan Kombinator Logika
- **Operator perbandingan pada daun kondisi (`var`, `op`, `value`):**
  - `==`, `!=`: kesetaraan angka, teks, atau boolean.
  - `<`, `<=`, `>`, `>=`: perbandingan numerik.
  - `in`, `not_in`: keanggotaan dalam daftar nilai (misalnya `"var": "hour", "op": "in", "value": [17, 18, 19, 20]`).
  - `between`: rentang inklusif `[bawah, atas]` (daftar tepat 2 angka).
- **Kombinator logika:**
  - `all`: daftar kondisi yang seluruhnya harus benar (AND).
  - `any`: daftar kondisi yang minimal satu harus benar (OR).
  - `not`: satu sub-kondisi yang dibalik nilainya (NOT).
  - Kedalaman bersarang maksimum dibatasi 8 tingkat agar mudah diaudit dan bebas risiko rekursi berlebih.

### 3.4 Daftar Putih Aksi (`then`), Prioritas, Resolusi Konflik, dan Fallback
- **Daftar putih aksi:**
  - BESS: `charge_bess`, `discharge_bess`, `hold_bess`.
  - Biomass: `dispatch_biomass`, `start_biomass`, `stop_biomass`.
  - Grid dan curtailment: `grid_import`, `grid_export`, `curtail_pv`.
- **Spesifikasi `limit` pada aksi:**
  - `"max"`: daya maksimum yang diizinkan komponen pada langkah ini.
  - `"deficit"`: sebesar kekurangan daya sistem setelah sumber prioritas lebih tinggi.
  - `"surplus"`: sebesar sisa kelebihan daya sistem.
  - `"min_load"`: khusus Biomass, sebesar `min_load_kw`.
  - Angka non-negatif eksplisit (kW), referensi `{"param": "..."}`, atau `{"target_soc": 0.85}` untuk BESS.
- **Evaluasi prioritas aturan:**
  - Aturan dievaluasi secara berurutan menurut angka `priority` dari **kecil ke besar** (misalnya aturan dengan `priority: 10` dievaluasi sebelum `priority: 20`; konvensi ini menunggu konfirmasi pemilik). Jika ada dua aturan dengan angka `priority` yang sama, urutan kemunculan pada daftar `rules` dipakai sebagai penentu.
  - Array `priority` tingkat atas (misalnya `["pv", "bess", "biomass"]`) menentukan urutan komponen penyeimbang untuk sisa defisit atau surplus ketika ditangani oleh fallback atau aksi `"deficit"`/`"surplus"`.
- **Resolusi konflik antar-aturan:**
  - Jika beberapa aturan yang cocok dalam satu langkah memberi perintah yang saling bertentangan pada komponen yang sama (misalnya aturan A meminta `charge_bess` dan aturan B meminta `discharge_bess`, atau `start_biomass` vs `stop_biomass`), **aturan yang sudah menang lebih dulu (prioritas lebih tinggi) tetap berlaku**, sedangkan perintah yang bertentangan diabaikan dan dicatat eksplisit sebagai konflik teratasi di jejak keputusan (`trace`).
  - Invarian fisik (seperti `charge_kw * discharge_kw == 0.0` dan batas ramp/SOC) selalu dijaga oleh komponen setelah keputusan EMS diteruskan ke simulator.
- **Fallback aman (`fallback_strategy`):**
  - Bawaan `"self_consumption"`. Setelah aturan kustom yang cocok dievaluasi, jika masih tersisa defisit atau surplus daya pada bus AC yang belum diputuskan secara eksplisit oleh aturan, mekanisme fallback menyeimbangkannya dengan menghormati aksi yang sudah dikunci aturan pada langkah tersebut.

### 3.5 Validator Konfigurasi EMS (`validate_ems_config`)
Validator memeriksa struktur EMS sebelum simulasi dimulai dan mengembalikan `EngineError` dengan kode stabil serta pesan yang menyebut `rule.id` dan lokasi field:
- `unsupported_ems_version`: versi skema `ems_version` tidak didukung.
- `invalid_ems_schema`: tipe data salah, field wajib hilang, atau terdapat field tambahan di luar skema.
- `unknown_ems_variable`: variabel di kondisi `when` tidak ada di daftar putih.
- `unknown_ems_operator`: operator atau format `value` tidak cocok untuk operator tersebut.
- `unknown_ems_action`: aksi atau nilai `limit` di `then` tidak dikenal atau bernilai negatif.
- `unknown_ems_param`: referensi `{"param": "..."}` merujuk nama yang tidak ada pada blok `params`.
- `duplicate_ems_rule_id`: terdapat dua aturan dengan `id` yang sama.
- `conflicting_ems_actions`: satu aturan tunggal berisi dua aksi yang langsung bertentangan pada dirinya sendiri (misalnya `charge_bess` dan `discharge_bess` sekaligus di satu `then`).
- `ems_nesting_too_deep`: kedalaman logika `all`/`any`/`not` melebihi batas 8 tingkat.

### 3.6 Mode Jejak Keputusan (`EMSStepTrace` dan CLI `trace`)
Untuk memenuhi `AGENTS.md` bagian 7.7 (menunjukkan aturan mana yang aktif dan alasannya untuk satu jam tertentu):
- **Struktur `EMSStepTrace` per langkah `t`:**
  - `step_idx` dan `local_time` (label waktu lokal lokasi proyek).
  - `inputs`: ringkasan nilai variabel konteks saat langkah `t` dievaluasi.
  - `evaluated_rules`: daftar tiap aturan terurut, berisi `rule_id`, `priority`, `matched` (`true`/`false`), dan `condition_details` (nilai aktual vs nilai target untuk setiap daun kondisi).
  - `applied_actions`: daftar aksi yang dijalankan beserta permintaan daya (`requested_kw`), realisasi daya setelah batasan komponen (`applied_kw`), dan alasan jika dipotong atau ditolak karena konflik.
  - `fallback_used`: nama strategi fallback bila ikut berjalan pada langkah ini (`null` jika tidak dipakai).
  - `summary_reason`: ringkasan satu kalimat mengapa keputusan langkah `t` terjadi.
- **Antarmuka inspeksi:**
  - Melalui Python API: `result.get_trace(step_idx) -> EMSStepTrace`.
  - Melalui CLI: `python -m app.hybrid.cli trace config.json --step <idx> [--format text|json]`.

---

## 4. Integrasi Simulator, Neraca Daya, dan Keluaran

1. **Neraca daya tertutup per jam:**
   Persamaan neraca daya tetap berlaku penuh dengan `generation_kw = pv_generation_kw + biomass_generation_kw`:
   ```text
   generation_kw + discharge_kw + grid_import_kw
     = served_load_kw + charge_kw + grid_export_kw + curtailment_kw + losses_kw
   ```
   ```text
   served_load_kw + unmet_load_kw = load_kw
   ```
   Pada `PowerBalanceSeries`, deret `pv_generation_kw` dan `biomass_generation_kw` disimpan terpisah (bernilai `0.0` bila tidak aktif) agar sumber pembangkitan dapat dilacak per komponen.
2. **Perluasan 5 strategi dispatch bawaan Tahap 2:**
   Saat Biomass aktif tanpa EMS kustom, lima strategi bawaan Tahap 2 (`self_consumption`, `load_following`, `cycle_charging`, `peak_shaving`, `time_of_use_arbitrage`) mengenali `biomass_available_kw` sebagai sumber pembangkit cadangan setelah PV dan BESS (atau ikut mengisi BESS pada strategi `cycle_charging`), sambil tetap mematuhi `min_load_kw`, ramp rate, dan min up/down time.
3. **Keluaran ringkasan dan CSV:**
   - `summary.json` menambah objek `biomass_summary` (energi listrik dihasilkan kWh, jam operasi, jumlah start, total bahan bakar ton, biaya bahan bakar dan logistik, emisi CO2e kg, thermal output CHP jika aktif, jumlah overhaul) dan `ems_summary` (mode EMS, jumlah aktivasi per aturan, jumlah langkah fallback).
   - `hourly_balance.csv` menambahkan kolom `biomass_generation_kw`, `biomass_status`, `biomass_fuel_tons` saat Biomass aktif, dan mempertahankan kolom `trace_reason` untuk setiap langkah.
   - Metrik `renewable_fraction` menghitung pangsa beban yang dipasok energi terbarukan: PV ditambah Biomass (jika `is_renewable = True`), tidak termasuk `grid_import`.
4. **Kriteria selesai Tahap 3 (pengujian wajib):**
   - Tes unit model Biomass (kurva beban parsial, konversi LHV basis kering ke terima, ramp rate, min up/down time, startup/shutdown, kuota pasokan, overhaul lifecycle event).
   - Tes properti untuk 6 invarian fisik Biomass dan sifat deterministik `outage_seed`.
   - Tes validator EMS (menolak semua pola tidak valid dengan kode galat yang tepat) dan tes interpreter EMS + mode `trace` menggunakan konfigurasi contoh dari pemilik proyek.
   - Tes integrasi simulasi tertutup PV + BESS + Biomass dengan selisih neraca daya di bawah `1e-6 kW`.

---

## 5. Contoh Perluasan JSON Konfigurasi Tahap 3 (Ilustratif)

Seluruh angka parameter biomassa dan contoh aturan EMS di bawah ini bersifat **ilustratif (`[REAL DATA]`)** hanya untuk menunjukkan bentuk struktur JSON Tahap 3 (`contract_version: "0.3"`), dan akan diganti dengan datasheet serta skema EMS asli dari pemilik proyek.

```json
{
  "contract_version": "0.3",
  "project": {
    "project_name": "Pabrik Hybrid PV BESS Biomass Tahap 3",
    "latitude": -6.2,
    "longitude": 106.8,
    "timezone": "Asia/Jakarta",
    "currency_code": "IDR"
  },
  "simulation": {
    "step_minutes": 60,
    "leap_day_policy": "ignore_feb_29",
    "weather_source": "pvgis_tmy",
    "dispatch_strategy": "custom_ems"
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
      "fuel_name": "Cangkang Sawit [REAL DATA]",
      "lhv_mj_per_kg": 16.5,
      "lhv_basis": "as_received",
      "moisture_fraction": 0.12,
      "fuel_price_per_ton": 950000.0,
      "logistics_cost_per_ton": 150000.0,
      "supply_period": "monthly",
      "supply_limit_tons": 120.0,
      "unplanned_outage_rate": 0.03,
      "mean_time_to_repair_hours": 6.0,
      "outage_seed": 42,
      "fixed_om_per_kw_year": 450000.0,
      "variable_om_per_kwh": 120.0,
      "overhaul_interval_operating_hours": 8000.0,
      "overhaul_cost": 150000000.0,
      "biogenic_co2_accounting": "zero_net",
      "supply_chain_emission_kg_co2e_per_ton": 45.0,
      "is_renewable": true,
      "emission_source_note": "Ilustratif [REAL DATA], menunggu rujukan pemilik",
      "chp_enabled": false
    }
  },
  "ems": {
    "ems_version": "0.1",
    "name": "contoh_hybrid_pv_bess_biomass",
    "params": {
      "soc_min": 0.20,
      "soc_max": 0.95
    },
    "priority": ["pv", "bess", "biomass"],
    "fallback_strategy": "self_consumption",
    "rules": [
      {
        "id": "r1_charge_surplus_pv",
        "priority": 10,
        "when": {
          "all": [
            { "var": "pv_surplus_kw", "op": ">", "value": 0 },
            { "var": "bess_soc", "op": "<", "value": { "param": "soc_max" } }
          ]
        },
        "then": [
          { "action": "charge_bess", "limit": "surplus" }
        ]
      },
      {
        "id": "r2_biomass_when_soc_low",
        "priority": 20,
        "when": {
          "all": [
            { "var": "net_load_kw", "op": ">", "value": 0 },
            { "var": "bess_soc", "op": "<=", "value": { "param": "soc_min" } }
          ]
        },
        "then": [
          { "action": "dispatch_biomass", "limit": "deficit" }
        ]
      }
    ]
  }
}
```

---

## 6. Masukan dan Keputusan yang Dibutuhkan dari Pemilik Proyek

Sebelum penulisan kode implementasi Tahap 3 dimulai, pemilik proyek dimohon untuk memberikan atau mengonfirmasi 4 poin berikut:

1. **Skema EMS resmi dan contoh konfigurasi:** Skema JSON EMS asli beserta minimal satu contoh konfigurasi aturan nyata (serta konfirmasi apakah nilai `priority` lebih kecil berarti prioritas lebih tinggi).
2. **Datasheet pembangkit biomassa referensi:** Jenis teknologi pembangkit (misalnya boiler + turbin uap atau gasifikasi + gas engine), kapasitas terpasang, beban minimum, ramp rate, waktu start/stop, minimum up/down time, interval overhaul, dan kurva konsumsi bahan bakar atau heat rate pada beban parsial.
3. **Data bahan bakar dan faktor emisi acuan:** Jenis bahan bakar utama, nilai kalor (LHV) beserta basis pengukurannya (`as_received` atau `dry`), kadar air, harga bahan bakar, biaya logistik, batas pasokan, serta metode akuntansi dan faktor emisi resmi yang diakui proyek.
4. **Urutan eksekusi Tahap 3:** Konfirmasi apakah Tahap 3 dikerjakan bertahap (Tahap 3A: Model Biomass terlebih dahulu setelah datasheet masuk, lalu Tahap 3B: EMS Kustom setelah skema EMS diterima) atau menunggu keduanya lengkap sebelum penulisan kode dimulai.
