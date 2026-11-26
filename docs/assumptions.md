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
- **Koefisien suhu sel Faiman (Faiman 2008 untuk modul c-Si terpasang terbuka):** `u0 = 25,0` W/(m2.K) dan `u1 = 6,84` W.s/(m3.K) (rujukan standar literatur Faiman, Prog. Photovolt. 2008).
- **Koefisien IAM model ASHRAE (`iam_b0`):** `0,05` (nilai umum kaca surya standar tanpa lapisan anti-pantul khusus) `[REAL DATA]`.
- **Soiling bulanan (`soiling_monthly`) dan salju (`snow_loss_monthly`):** bawaan `0,02` (2%) merata per bulan untuk soiling dan `0,0` (0%) untuk salju di Indonesia `[REAL DATA]`.
- **Rincian rugi sistem Tahap 2 (bila mode PV detail dipilih):** `mismatch_fraction = 0,02`, `dc_wiring_fraction = 0,02`, `shading_fraction = 0,0`, `availability_fraction = 0,01`, `lid_fraction = 0,015` `[REAL DATA]`.
- **Konsumsi malam inverter (`night_tare_kw`):** `0,0` kW bawaan (dapat diisi sesuai datasheet inverter) `[REAL DATA]`.
- **Parameter modul satu-dioda ilustratif (untuk uji model sampai datasheet modul nyata dipilih pemilik):** `i_sc = 13,8` A, `v_oc = 49,5` V, `i_mp = 13,0` A, `v_mp = 41,5` V, `alpha_sc = 0,0005 * i_sc` A/K, `beta_voc = -0,0028 * v_oc` V/K, `cells_in_series = 72` `[REAL DATA]`.
- **Degradasi tahunan modul (`degradation_fraction_per_year`):** `0,005` per tahun (0,5%/tahun) `[REAL DATA]`.
- **Rasio DC/AC inverter tipikal:** `1,15` sampai `1,20` `[REAL DATA]`.
- **Kurva efisiensi inverter beban parsial ilustratif (untuk mode `efficiency_curve` bila tidak diisi dari datasheet):** titik `(0.05, 0.90), (0.10, 0.94), (0.20, 0.965), (0.50, 0.975), (0.75, 0.972), (1.00, 0.965)` `[REAL DATA]`.

### 2.2 Komponen BESS (`[REAL DATA]`, Tahap 2)
- **Efisiensi satu arah (`charge_efficiency`, `discharge_efficiency`):** `0,94` per arah (atau sekitar 0,88 round-trip sebelum rugi PCS) `[REAL DATA]`.
- **Rugi PCS (`pcs_loss_fraction`) dan beban tambahan (`aux_load_kw`):** `0,02` (2%) dan `0,0` kW bawaan `[REAL DATA]`.
- **Batas SOC minimum dan maksimum:** `0,20` (20%) dan `0,95` (95%), dengan `initial_soc_fraction = 0,50` `[REAL DATA]`.
- **Degradasi kalender dan siklus (aditif):** `calendar_fade_per_year = 0,015` (1,5%/tahun) dan `cycle_fade_per_efc = 0,00005` (0,005% per siklus penuh, setara ~4.000 siklus menuju batas EOL bersama fade kalender) `[REAL DATA]`. Definisi Equivalent Full Cycle (EFC): akumulasi `energy_out_internal_kwh / effective_capacity_kwh`.
- **Batas akhir umur baterai (End of Life):** `0,80` (80% dari kapasitas nominal awal) `[REAL DATA]`.

### 2.3 Komponen Biomass (`[REAL DATA]`, Persiapan Tahap 3A)
- **Kebijakan parameter pembangkit:** Mesin mendukung input bebas sesuai datasheet proyek, dan untuk contoh serta pengujian awal Tahap 3A disediakan 2 profil sampel ilustratif berlabel `[REAL DATA]` (tidak ada kurva tersembunyi tanpa sumber):
  - **Sampel A (`250 kW`, gasifikasi / gas engine `[REAL DATA]`):** beban minimum `40%`, ramp rate `125 kW/jam`, start/stop `1 jam`, min up/down `4/2 jam`, titik heat rate `[(0.40, 16500), (0.75, 14200), (1.00, 13500)] kJ/kWh`, forced outage rate `3%` (MTTR `6 jam`), interval overhaul `8.000 jam`.
  - **Sampel B (`1.000 kW`, boiler + turbin uap `[REAL DATA]`):** beban minimum `45%`, ramp rate `200/250 kW/jam`, start/stop `3/2 jam`, min up/down `8/4 jam`, titik heat rate `[(0.45, 17800), (0.75, 15200), (1.00, 14400)] kJ/kWh`, forced outage rate `4%` (MTTR `12 jam`), interval overhaul `16.000 jam`.
- **Katalog preset sampel jenis bahan bakar (`fuel_preset`, `[REAL DATA]`):** Nilai di bawah adalah sampel ilustratif sifat umum bahan bakar untuk memudahkan simulasi awal dan dapat ditimpa per field di konfigurasi (bukan data kontrak pasokan spesifik):
  - `efb` (Empty Fruit Bunch / Tandan Kosong Sawit): kadar air `45%`, LHV terima `8,5 MJ/kg`, harga `Rp 350.000/ton`, logistik `Rp 150.000/ton`, emisi rantai pasok `35 kg CO2e/ton` `[REAL DATA]`.
  - `wood_pellet` (Pelet Kayu): kadar air `8%`, LHV terima `17,5 MJ/kg`, harga `Rp 2.200.000/ton`, logistik `Rp 200.000/ton`, emisi rantai pasok `65 kg CO2e/ton` `[REAL DATA]`.
  - `pks` (Palm Kernel Shell / Cangkang Sawit): kadar air `12%`, LHV terima `16,5 MJ/kg`, harga `Rp 1.100.000/ton`, logistik `Rp 150.000/ton`, emisi rantai pasok `45 kg CO2e/ton` `[REAL DATA]`.
  - `woodchip` (Serpihan Kayu): kadar air `30%`, LHV terima `12,2 MJ/kg`, harga `Rp 650.000/ton`, logistik `Rp 150.000/ton`, emisi rantai pasok `40 kg CO2e/ton` `[REAL DATA]`.
  - `rice_husk` (Sekam Padi): kadar air `12%`, LHV terima `13,5 MJ/kg`, harga `Rp 400.000/ton`, logistik `Rp 120.000/ton`, emisi rantai pasok `30 kg CO2e/ton` `[REAL DATA]`.
- **Konstanta konversi LHV basis kering ke kondisi terima (`as_received`):** Jika pengguna memasukkan LHV dalam basis kering (`lhv_basis = "dry"`), koreksi kadar air menggunakan konstanta termodinamika standar kalor laten penguapan air pada suhu acuan 25 C sebesar `2,443 MJ/kg` (rujukan standar analisis bahan bakar padat ISO 18125 / ASTM): `lhv_effective = lhv_dry * (1 - moisture_fraction) - 2.443 * moisture_fraction`.

---

## 3. Asumsi Ekonomi Default, Sampel Keuangan Tahap 4, dan Kasus Pembanding `kiyo.html`

### 3.1 Asumsi Ekonomi Default Sementara (`[REAL DATA]`)
- **Mata uang default:** `IDR`.
- **Umur proyek default:** `25` tahun.
- **Tingkat diskonto (WACC) pre-tax:** `0,10` (10%/tahun) `[REAL DATA]`.
- **Eskalasi tarif, inflasi O&M, dan eskalasi bahan bakar:** `0,0` (0%/tahun) pada mode cepat dasar; pada sampel skenario hybrid Tahap 4 dan pembanding `kiyo.html` digunakan `0,02` (2%/tahun) sebagai nilai ilustratif `[REAL DATA]`.
- **Faktor emisi grid Indonesia:** Di `kiyo.html` tercantum `0,78 kg CO2/kWh` tanpa dokumen rujukan; statusnya ditandai `[REAL DATA]` sampai disepakati nilai resmi (misalnya faktor emisi jaringan listrik Indonesia dari Kementerian ESDM).

### 3.2 Parameter Sampel Keuangan Tahap 4 (`[REAL DATA]`)
Seluruh angka di bawah ini bersifat **sampel ilustratif sementara** untuk contoh skema dan pengujian Tahap 4 sampai data penawaran komersial nyata ditetapkan oleh pemilik proyek:
- **CAPEX dan O&M PV sampel:** `Rp 11.500.000/kWp`, O&M tahunan `1,5%` dari CAPEX PV, penggantian inverter tahun ke-13 sebesar `Rp 420.000.000` (untuk acuan ~420 kW AC, umur desain inverter `12` tahun) `[REAL DATA]`.
- **CAPEX, penggantian, dan O&M BESS sampel:** `Rp 3.500.000/kWh`, biaya penggantian EOL `Rp 3.000.000/kWh` (mis. `Rp 1.800.000.000` untuk 600 kWh), O&M tetap `Rp 50.000/kWh/tahun`, umur desain acuan nilai sisa `10` tahun `[REAL DATA]`.
- **CAPEX dan overhaul Biomass sampel:** `Rp 18.000.000/kW`, biaya overhaul `Rp 150.000.000` (untuk sampel 250 kW), umur overhaul acuan nilai sisa `5` tahun `[REAL DATA]`.
- **Tarif listrik acuan sampel:** `Rp 1.445/kWh` `[REAL DATA]`.
- **Pajak opsional (`after_tax`):** Tarif pajak penghasilan badan Indonesia acuan umum `0,22` (22%) dengan depresiasi garis lurus `10` tahun (hanya aktif bila pengguna memilih `tax_model = "after_tax"`, default tetap `"pre_tax"`) `[REAL DATA]`.
- **Metode nilai sisa (Salvage Value):** Depresiasi linear sisa umur pakai ala HOMER pada akhir umur proyek untuk aset yang mengalami penggantian atau overhaul di tengah umur proyek.

### 3.3 Catatan Kasus Uji Pembanding `docs/reference/kiyo.html`
Berdasarkan `AGENTS.md` bagian 9.4, nilai bawaan di prototipe `kiyo.html` **tidak boleh disalin sebagai angka default tanpa sumber**, tetapi konfigurasi bawaannya (500 kWp, Jakarta 1.450 kWh/kWp/tahun, degradasi 0,55%/tahun, CAPEX Rp 11.500.000/kWp, O&M 1,5% CAPEX dengan inflasi 2%/tahun, tarif Rp 1.445/kWh dengan eskalasi 2%/tahun, WACC 9,5%, umur 25 tahun) akan digunakan sebagai **kasus uji pembanding** terhadap mesin backend Python dan dicatat selisihnya (misalnya perbedaan perlakuan inflasi O&M serta metode payback terdiskonto yang belum ada di mode cepat).
