# Log Asumsi dan Sumber Data RenewableX

Dokumen ini mencatat sumber resmi data cuaca, batasan lisensi, serta daftar parameter sementara yang masih menggunakan asumsi ilustratif hingga data datasheet nyata dari pemilik proyek tersedia.

Aturan wajib (`AGENTS.md` bagian 9.4 dan 11):
- Setiap angka bawaan yang dipakai mesin atau ditampilkan sebagai contoh harus memiliki sumber jelas di dokumen ini.
- Angka sementara yang belum berasal dari datasheet nyata wajib ditandai `[REAL DATA]` agar mudah diganti ketika data asli masuk.

---

## 1. Sumber Data Cuaca dan Radiasi Surya

### 1.1 PVGIS v5.3 (Default Wilayah Indonesia untuk Simulasi Per Jam)
- **Institusi:** Joint Research Centre (JRC), Komisi Eropa.
- **Dokumentasi resmi API:** `https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en`
- **Tanggal baca dan verifikasi:** 2026-11-26.
- **Endpoint tahunan (mode cepat):** `GET https://re.jrc.ec.europa.eu/api/v5_3/PVcalc`
- **Endpoint per jam TMY (Tahap 1 hybrid):** `GET https://re.jrc.ec.europa.eu/api/v5_3/tmy`
- **Dataset di Indonesia:** `PVGIS-ERA5` (data reanalisis global periode 2005 sampai 2023; `PVGIS-SARAH3` tidak mencakup wilayah bujur Indonesia).
- **Lisensi dan ketentuan:** Data terbuka JRC Komisi Eropa (wajib atribusi sumber). Batas laju server 30 panggilan per detik per IP (HTTP 429) dan antrean komputasi penuh mengembalikan HTTP 529. Dilarang dipanggil langsung dari browser via AJAX.
- **Kolom yang digunakan untuk Tahap 1:** `time(UTC)`, `G(h)` (GHI), `Gb(n)` (DNI), `Gd(h)` (DHI), `T2m` (suhu udara 2m), dan `WS10m` (kecepatan angin 10m). Total 8.760 baris per tahun (tahun tipikal tanpa 29 Februari).

### 1.2 NASA POWER (Alternatif Data Harian dan Per Jam)
- **Institusi:** NASA Langley Research Center (POWER Project).
- **Dokumentasi resmi:** `https://power.larc.nasa.gov/docs/services/api/`
- **Tanggal baca dan verifikasi:** 2026-11-26.
- **Endpoint harian (mode cepat):** `GET https://power.larc.nasa.gov/api/temporal/daily/point`
- **Endpoint per jam (alternatif Tahap 1):** `GET https://power.larc.nasa.gov/api/temporal/hourly/point` (dengan `time-standard=LST` untuk waktu lokal).
- **Lisensi:** Data publik NASA (gratis dan terbuka untuk penggunaan komersial maupun riset dengan atribusi).

### 1.3 Hasil Uji Banding Aktual Wilayah Indonesia (2026-11-26)
Pengukuran langsung terhadap GHI tahunan (kWh/m2/tahun) untuk 3 kota Indonesia membandingkan PVGIS v5.3 TMY (multi-tahun 2005 sampai 2023) dengan NASA POWER per jam tahun tunggal 2023:

| Kota | Koordinat | PVGIS v5.3 TMY (kWh/m2/thn) | NASA POWER 2023 (kWh/m2/thn) | Catatan |
|---|---|---|---|---|
| Jakarta | -6,20, 106,80 | 1.978,92 | 1.776,27 | NASA 2023 lebih rendah di Jakarta |
| Surabaya | -7,25, 112,75 | 1.948,01 | 1.954,73 | Selisih tipis (~0,3%) |
| Makassar | -5,14, 119,43 | 1.802,35 | 2.026,81 | NASA 2023 terpengaruh tahun kering El Nino |

Keputusan bersama pemilik proyek: **PVGIS v5.3 TMY** dipilih sebagai sumber default untuk Tahap 1 karena berbasis multi-tahun (lebih stabil dan konservatif untuk perencanaan proyek 25 tahun dibanding satu tahun kalender tunggal).

---

## 2. Parameter Komponen Referensi (Sementara, Menunggu Datasheet)

Seluruh nilai di bawah ini bersifat **asumsi sementara untuk keperluan pengembangan dan pengujian mesin** sampai pemilik proyek menyediakan datasheet komponen nyata:

### 2.1 Komponen PV (`[REAL DATA]`)
- **Rugi sistem default (`system_loss_fraction`):** `0,14` (14%, sesuai konvensi default PVGIS `PVcalc`) `[REAL DATA]`.
- **Koefisien suhu daya (`temp_coeff_per_c`):** `-0,004` per derajat Celsius (-0,4%/C, nilai umum modul kristal silikon komersial) `[REAL DATA]`.
- **Nominal Operating Cell Temperature (NOCT):** `45` derajat Celsius `[REAL DATA]`.
- **Degradasi tahunan modul (`degradation_fraction_per_year`):** `0,005` per tahun (0,5%/tahun) `[REAL DATA]`.
- **Rasio DC/AC inverter tipikal:** `1,15` sampai `1,20` `[REAL DATA]`.

### 2.2 Komponen BESS (`[REAL DATA]`, Persiapan Tahap 2)
- **Efisiensi round-trip atau efisiensi satu arah (charge/discharge):** `0,92` per arah `[REAL DATA]`.
- **Batas SOC minimum dan maksimum:** `0,20` (20%) dan `0,95` (95%) `[REAL DATA]`.
- **Batas akhir umur baterai (End of Life):** `0,80` (80% dari kapasitas awal) `[REAL DATA]`.

### 2.3 Komponen Biomass (`[REAL DATA]`, Persiapan Tahap 3)
- Seluruh kurva konsumsi bahan bakar beban parsial, LHV (nilai kalor bawah), kadar air, ramp rate, serta faktor emisi akan diminta langsung ke pemilik proyek sebelum Tahap 3 dimulai (tidak ditebak).

---

## 3. Asumsi Ekonomi Default dan Kasus Pembanding `kiyo.html`

### 3.1 Asumsi Ekonomi Default Sementara (`[REAL DATA]`)
- **Mata uang default:** `IDR`.
- **Umur proyek default:** `25` tahun.
- **Tingkat diskonto (WACC) pre-tax:** `0,10` (10%/tahun) `[REAL DATA]`.
- **Eskalasi tarif dan inflasi O&M:** `0,0` (0%/tahun) pada mode cepat dasar; bila memakai pembanding `kiyo.html` (inflasi O&M 2%/tahun, eskalasi tarif 2%/tahun), hal tersebut merupakan asumsi ilustratif `[REAL DATA]`.
- **Faktor emisi grid Indonesia:** Di `kiyo.html` tercantum `0,78 kg CO2/kWh` tanpa dokumen rujukan; statusnya ditandai `[REAL DATA]` sampai disepakati nilai resmi (misalnya faktor emisi jaringan listrik Indonesia dari Kementerian ESDM) pada Tahap 4.

### 3.2 Catatan Kasus Uji Pembanding `docs/reference/kiyo.html`
Berdasarkan `AGENTS.md` bagian 9.4, nilai bawaan di prototipe `kiyo.html` **tidak boleh disalin sebagai angka default tanpa sumber**, tetapi konfigurasi bawaannya (500 kWp, Jakarta 1.450 kWh/kWp/tahun, degradasi 0,55%/tahun, CAPEX Rp 11.500.000/kWp, O&M 1,5% CAPEX dengan inflasi 2%/tahun, tarif Rp 1.445/kWh dengan eskalasi 2%/tahun, WACC 9,5%, umur 25 tahun) akan digunakan sebagai **kasus uji pembanding** terhadap mesin backend Python dan dicatat selisihnya (misalnya perbedaan perlakuan inflasi O&M serta metode payback terdiskonto yang belum ada di mode cepat).
