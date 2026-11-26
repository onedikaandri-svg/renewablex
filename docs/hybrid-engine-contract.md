# Kontrak Mesin Hybrid Tahap 1: Fondasi Engine

**Status dokumen:** Usulan kontrak (menunggu persetujuan pemilik proyek sebelum penulisan kode Tahap 1).
**Cakupan:** Fondasi simulasi per jam (Tahap 1 dari `AGENTS.md` bagian 10) untuk sistem energi hybrid.

---

## 1. Prinsip Kompatibilitas dan Wilayah Modul

1. **Mode cepat tetap utuh:** Endpoint screening PV tahunan yang sudah berjalan (`POST /v1/pv/preliminary` dan `POST /v1/pv/sensitivity`) tidak diubah struktur JSON maupun perhitungannya.
2. **Isolasi modul baru:** Seluruh kode fondasi hybrid diletakkan pada paket baru `services/calculation-engine/app/hybrid/` dan paket tes `services/calculation-engine/tests/hybrid/`.
3. **Bisa dijalankan tanpa web:** Mesin hybrid dapat dijalankan langsung dari antarmuka baris perintah (CLI) maupun dari tes unit Python tanpa menjalankan server FastAPI atau frontend Next.js.

---

## 2. Struktur Waktu dan Kebijakan Simulasi

1. **Konfigurasi langkah waktu (tidak menanam `8760` mati):**
   - Konfigurasi waktu memakai `step_minutes: int = 60` (bawaan 60 menit atau 1 jam).
   - Jumlah langkah per tahun diturunkan secara dinamis dari `steps_per_year = (365 * 24 * 60) // step_minutes` (menghasilkan 8.760 langkah untuk `step_minutes = 60`, dan siap menerima 30 atau 15 menit pada pengembangan berikutnya).
2. **Kebijakan tahun kabisat:**
   - Sesuai keputusan pemilik proyek, simulasi selalu menggunakan 365 hari per tahun. Tanggal 29 Februari diabaikan bila ada pada data masukan atau tahun kalender.
3. **Kebijakan zona waktu dan label waktu:**
   - Sesuai keputusan pemilik proyek, seluruh label waktu langkah simulasi (`t = 0` sampai `steps_per_year - 1`) memakai **waktu lokal lokasi proyek** (misalnya `Asia/Jakarta` UTC+7, `Asia/Makassar` UTC+8, `Asia/Jayapura` UTC+9).
   - Data cuaca yang berasal dari sumber UTC (seperti PVGIS TMY) wajib digeser secara siklik sesuai offset zona waktu lokasi proyek sebelum dipasangkan dengan profil beban lokal.

---

## 3. Adaptor Data Cuaca Per Jam (`WeatherProvider`)

1. **Sumber bawaan (default) untuk Indonesia:**
   - **PVGIS v5.3 TMY** (`GET https://re.jrc.ec.europa.eu/api/v5_3/tmy`, berbasis `PVGIS-ERA5` multi-tahun 2005 sampai 2023).
   - Alasan pemilihan (lebih konservatif untuk perencanaan jangka panjang): berdasarkan uji banding 3 kota di Indonesia pada 2026-11-26 (rincian di `docs/assumptions.md`), data tahun tunggal 2023 dari NASA POWER cenderung terbias kondisi kemarau El Nino (misalnya Makassar 2.026,81 kWh/m2 pada NASA 2023 vs 1.802,35 kWh/m2 pada PVGIS TMY; Surabaya 1.954,73 vs 1.948,01 kWh/m2), sedangkan TMY (Typical Meteorological Year, data tahun cuaca tipikal multi-tahun) lebih merata dan konservatif.
2. **Variabel cuaca per jam yang dinormalisasi (`WeatherDataset`):**
   - `ghi_w_m2`: irradiansi horizontal global (W/m2), dari `G(h)` PVGIS.
   - `dni_w_m2`: irradiansi normal langsung (W/m2), dari `Gb(n)` PVGIS.
   - `dhi_w_m2`: irradiansi difus horizontal (W/m2), dari `Gd(h)` PVGIS.
   - `temp_air_c`: suhu udara ambient pada 2 meter (derajat Celsius), dari `T2m` PVGIS.
   - `wind_speed_m_s`: kecepatan angin pada 10 meter (m/s), dari `WS10m` PVGIS.
   - Metadata asal data: `provider`, `dataset`, `dataset_version`, `period`, `latitude`, `longitude`, `elevation_m`, `timezone_offset_hours`, `retrieved_at`.
3. **Adaptor alternatif:** Antarmuka `WeatherProvider` bersifat terbuka untuk adaptor **NASA POWER hourly** (`time-standard=LST`) serta **unggahan berkas TMY/EPW** oleh pengguna pada langkah lanjutan.

---

## 4. Data Masukan Beban (`LoadProfile`)

Mendukung dua cara penyusunan deret beban listrik (`load_kw` sepanjang `steps_per_year`):

1. **Unggah CSV per jam (`csv`):**
   - Format kolom sederhana (`hour_index,load_kw` atau daftar nilai per baris dengan header).
   - Validasi ketat: jumlah baris harus tepat sama dengan `steps_per_year` (8.760 untuk langkah 1 jam), tidak boleh mengandung nilai negatif, tidak boleh mengandung nilai kosong (`null` / `NaN` / `inf`), dan harus berupa angka valid. Galat mengembalikan kode terstruktur (`invalid_load_length`, `negative_load_value`, `non_finite_load_value`, `invalid_csv_format`).
2. **Pembangkit profil berparameter (`synthetic`):**
   - Parameter: `base_load_kw`, `peak_load_kw`, profil pola harian 24 jam (faktor relatif), variasi musiman bulanan (opsional), dan tingkat derau acak (`noise_fraction`) dengan `seed` integer tetap.
   - Sifat wajib: deterministik (nilai `seed` yang sama selalu menghasilkan deret beban yang persis sama).

---

## 5. Antarmuka Komponen Seragam (`EnergyComponent`)

Seluruh komponen pembangkit dan penyimpan energi mengikuti antarmuka abstrak yang sama agar komponen baru (BESS, Biomass, Grid, Diesel, Wind, Hidro) dapat dipasang tanpa menulis ulang inti mesin:

1. **`validate() -> None`:** Memeriksa rentang parameter komponen sebelum simulasi dimulai.
2. **`available_power_kw(step_idx, weather, state) -> float`:** Menghitung daya maksimum yang tersedia pada langkah waktu tertentu (atau mengembalikan deret vektor pra-hitung untuk sumber berbasis cuaca seperti PV).
3. **`step(step_idx, command_kw, weather, state) -> ComponentStepResult`:** Menjalankan satu langkah simulasi dengan mencatat aliran energi masuk/keluar, rugi komponen, state sebelum dan sesudah langkah.
4. **`lifecycle_events(year) -> list[LifecycleEvent]`:** Menyiapkan kait kejadian umur proyek (degradasi tahunan atau jadwal penggantian komponen pada Tahap 2 sampai 4).

### Komponen Tahap 1: PV Tingkat PVWatts (`PVWattsComponent`)
Pada Tahap 1, komponen PV menghitung daya AC per jam secara vektorisasi dari:
- Kapasitas DC terpasang (`capacity_kwp`), kemiringan (`tilt_degrees`), azimuth (`azimuth_degrees`).
- Transposisi sederhana irradiansi ke bidang panel (model dasar POA isotropik pada Tahap 1; model Perez dan satu-dioda menyusul di Tahap 2).
- Koreksi suhu sel sederhana (NOCT) dan koefisien suhu daya (`temp_coeff_per_c`).
- Faktor rugi sistem DC/AC (`system_loss_fraction`) dan pembatasan daya inverter AC (`inverter_ac_kw`, clipping) beserta pencatatan rugi per tahap untuk persiapan diagram waterfall di tahap lanjut.

---

## 6. Neraca Daya Tertutup Per Jam (`PowerBalance`)

Pada setiap langkah waktu `t`, mesin simulasi wajib menegakkan persamaan neraca daya tertutup berikut:

```text
generation_kw + discharge_kw + grid_import_kw
  = served_load_kw + charge_kw + grid_export_kw + curtailment_kw + losses_kw
```

Dengan hubungan beban:

```text
served_load_kw + unmet_load_kw = load_kw
```

Catatan Tahap 1 (sebelum BESS dan Biomass masuk di Tahap 2 dan 3):
- `discharge_kw`, `charge_kw`, `grid_import_kw`, dan `grid_export_kw` bernilai `0.0` (atau disiapkan sebagai slot nol di struktur hasil langkah).
- `served_load_kw = min(pv_ac_kw, load_kw)`
- `unmet_load_kw = max(load_kw - pv_ac_kw, 0.0)`
- `curtailment_kw = max(pv_ac_kw - load_kw, 0.0)`
- Uji kekekalan energi wajib memastikan selisih sisi kiri dan sisi kanan persamaan pada setiap jam serta akumulasi tahunan selalu di bawah `1e-6`.

---

## 7. Agregasi Keluaran dan CLI

1. **Agregasi berjenjang:**
   - **Per jam:** Deret `steps_per_year` titik (beban, PV tersedia, PV terpakai, curtailment, unmet load, rugi).
   - **Harian:** 365 ringkasan (energi kWh/hari, puncak kW/hari).
   - **Bulanan:** 12 ringkasan (energi kWh/bulan per komponen dan beban).
   - **Tahunan (Tahun 1 pada Tahap 1; multi-tahun di Tahap 4):** Total produksi PV (kWh), total beban (kWh), energi terpenuhi (kWh), `unmet_load_kwh`, `curtailment_kwh`, fraksi energi terbarukan (%), dan faktor kapasitas (%).
2. **Antarmuka Baris Perintah (CLI):**
   - Menjalankan simulasi dari berkas konfigurasi JSON tanpa menyalakan server web:
     `python -m app.hybrid.cli run config.json --output out_dir/`
   - Menghasilkan `summary.json` dan `hourly_balance.csv` di folder keluaran.

---

## 8. Usulan Kontrak API dan Skema Database Baru (Menunggu Persetujuan)

Sesuai `AGENTS.md` bagian 8, struktur baru di bawah ini diajukan sebagai dokumen kontrak terlebih dahulu dan **belum diimplementasikan** sampai disetujui oleh pemilik proyek.

### 8.1 Usulan Endpoint API Hybrid (Tidak Mengubah `/v1/pv/*`)
- `POST /v1/hybrid/simulate`: Menjalankan satu simulasi 8.760 jam secara langsung dan mengembalikan ringkasan + agregasi bulanan (serta deret harian/per jam bila diminta lewat flag).
- `POST /v1/hybrid/jobs` dan `GET /v1/hybrid/jobs/{job_id}`: Rancangan job asinkron (antrean, status `queued`, `running`, `completed`, `failed`, progres persentase) untuk simulasi multi-tahun atau sapuan kombinasi pada Tahap 7.

Contoh bentuk **JSON Request** `POST /v1/hybrid/simulate` (Tahap 1):

```json
{
  "contract_version": "0.1",
  "project": {
    "project_name": "Pabrik Cikarang Hybrid",
    "latitude": -6.28,
    "longitude": 107.15,
    "elevation_m": 25.0,
    "timezone": "Asia/Jakarta",
    "currency_code": "IDR"
  },
  "simulation": {
    "step_minutes": 60,
    "leap_day_policy": "ignore_feb_29",
    "weather_source": "pvgis_tmy"
  },
  "load_profile": {
    "mode": "synthetic",
    "base_load_kw": 120.0,
    "peak_load_kw": 350.0,
    "seed": 42
  },
  "components": {
    "pv": {
      "enabled": true,
      "model": "pvwatts_v1",
      "capacity_kwp": 500.0,
      "inverter_ac_kw": 420.0,
      "tilt_degrees": 10.0,
      "azimuth_degrees": 0.0,
      "system_loss_fraction": 0.14,
      "temp_coeff_per_c": -0.004
    }
  },
  "include_hourly": false
}
```

Contoh bentuk **JSON Response** `POST /v1/hybrid/simulate`:

```json
{
  "engine_version": "0.5.0",
  "contract_version": "0.1",
  "config_hash": "sha256:...",
  "calculated_at": "2026-11-26T02:20:00+00:00",
  "weather_source": {
    "provider": "pvgis",
    "dataset": "PVGIS-ERA5",
    "dataset_version": "v5_3",
    "period": "2005-2023",
    "timezone": "Asia/Jakarta"
  },
  "summary": {
    "steps_count": 8760,
    "step_minutes": 60,
    "total_load_kwh": 1800000.0,
    "pv_generation_kwh": 725000.0,
    "served_load_kwh": 650000.0,
    "unmet_load_kwh": 1150000.0,
    "curtailment_kwh": 75000.0,
    "renewable_fraction": 0.3611,
    "pv_capacity_factor": 0.1655,
    "max_balance_error_kw": 0.0
  },
  "monthly": [
    {
      "month": 1,
      "load_kwh": 152000.0,
      "pv_generation_kwh": 58000.0,
      "served_load_kwh": 53000.0,
      "unmet_load_kwh": 99000.0,
      "curtailment_kwh": 5000.0
    }
  ]
}
```

*(Catatan: angka pada contoh JSON di atas hanyalah ilustrasi struktur skema, bukan hasil simulasi nyata.)*

### 8.2 Usulan Skema Database Supabase Baru (Migrasi Berikutnya)
Tabel-tabel di bawah ini dirancang untuk ditambahkan lewat file migrasi SQL baru (tidak mengubah `0001` maupun `0002`), seluruhnya dengan Row Level Security (RLS) aktif sehingga pengguna hanya bisa mengakses proyek miliknya sendiri:

| Tabel Baru | Peran Utama |
|---|---|
| `system_configs` | Menyimpan topologi dan parameter komponen (PV, BESS, Biomass, bus) dalam skema JSON terversi beserta `config_hash` |
| `ems_configs` | Menyimpan strategi dispatch (bawaan atau JSON aturan kustom terversi dari pemilik di Tahap 3) |
| `load_profiles` | Menyimpan metadata profil beban (mode CSV/sintetis, ringkasan kWh, pointer berkas di Supabase Storage) |
| `weather_datasets` | Menyimpan cache metadata sumber cuaca lokasi (koordinat, provider, dataset, versi, periode, pointer berkas Parquet) |
| `simulation_runs` | Menyimpan status job (`queued`, `running`, `completed`, `failed`), progres, `engine_version`, `contract_version`, dan `config_hash` |
| `results_summaries` | Menyimpan ringkasan metrik teknis, emisi, dan keuangan serta agregasi bulanan hasil simulasi |
| `results_timeseries` | Hanya menyimpan metadata dan pointer (`storage_path`, format `parquet`) ke berkas deret waktu besar di Supabase Storage |
| `scenario_sets` | Mengelompokkan beberapa konfigurasi atau hasil sapuan (HOMER-style) untuk perbandingan berdampingan |
