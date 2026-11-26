# Laporan Uji Banding Model PV Tahap 2 terhadap `pvlib`

**Tanggal pengukuran:** 2026-11-26  
**Lingkungan uji:** Python 3.11.9, NumPy 2.4.6, `pvlib` 0.16.1  
**Implementasi produksi:** `services/calculation-engine/app/hybrid/pv_detailed.py` (100% NumPy murni, tanpa impor `pvlib`, `scipy`, atau `pandas`).

---

## 1. Metodologi Uji Banding

Pengujian membandingkan seluruh 7 sub-model PV detail di `pv_detailed.py` secara langsung terhadap fungsi referensi `pvlib` pada dua lokasi dengan iklim dan lintang berbeda (8.760 langkah per jam per lokasi):

1. **Jakarta (tropis, lintang rendah):** `-6.2` LU/LS, `106.8` BT, elevasi `16 m`, zona waktu `Asia/Jakarta` (`UTC+7`), memakai berkas cuaca acuan `golden_jakarta_weather.json`, kemiringan panel tetap `10 deg`, azimuth `0 deg` PVGIS (`180 deg` kompas).
2. **Golden, Colorado (lintang sedang):** `39.74` LU, `-105.18` BB, elevasi `1829 m`, zona waktu `UTC-7`, memakai profil langit cerah `ineichen` dari `pvlib.location.Location.get_clearsky`, suhu udara `15 C`, kecepatan angin `3 m/s`, kemiringan panel tetap `35 deg`, azimuth `0 deg` PVGIS (`180 deg` kompas).

Untuk modul satu-dioda De Soto, digunakan parameter datasheet ilustratif dari `docs/assumptions.md` `[REAL DATA]`: `i_sc = 13.8 A`, `v_oc = 49.5 V`, `i_mp = 13.0 A`, `v_mp = 41.5 V`, `alpha_sc = 0.0069 A/K`, `beta_voc = -0.1386 V/K`, `cells_in_series = 72`. Pada `pvlib.ivtools.sdm.fit_desoto`, metode solver bawaan `hybr` tidak konvergen untuk kasus ini, sehingga pengujian pembanding memanggil `fit_desoto` dengan `root_kwargs={"method": "lm", "options": {"xtol": 1e-10}}`.

---

## 2. Hasil Pengukuran Aktual

### 2.1 Jakarta (`-6.2, 106.8, Asia/Jakarta`)

| Sub-model | Fungsi Pembanding `pvlib` | Metrik Selisih Aktual |
|---|---|---|
| Posisi matahari (zenith, `zenith < 85 deg`) | `pvlib.solarposition.get_solarposition` (NREL SPA) | MAE = `0.0811 deg`, RMSE = `0.0948 deg` |
| Dekomposisi Erbs (DNI) | `pvlib.irradiance.erbs` | Selisih maks = `1.25e-12 W/m2`, selisih energi tahunan = `0.000000%` |
| Dekomposisi Erbs (DHI) | `pvlib.irradiance.erbs` | Selisih maks = `1.05e-12 W/m2`, selisih energi tahunan = `0.000000%` |
| Transposisi POA langit (`isotropic`) | `pvlib.irradiance.isotropic` | MAE = `0.000000e+00 W/m2`, selisih total = `0.000000%` |
| Transposisi POA langit (`hay_davies`) | `pvlib.irradiance.haydavies` | MAE = `1.595174e-14 W/m2`, selisih total = `0.000000%` |
| Transposisi POA langit (`perez`, 1990) | `pvlib.irradiance.perez` | MAE = `1.876776e-15 W/m2`, selisih total = `0.000000%` |
| Tracking 1-sumbu + backtracking (`gcr=0.35`, `max=60 deg`) | `pvlib.tracking.singleaxis` | MAE `tracker_theta` = `3.29e-15 deg` |
| Rugi pantulan ASHRAE IAM (`b0=0.05`) | `pvlib.iam.ashrae` | Selisih maks = `1.22e-15` |
| Suhu sel Faiman (`u0=25.0`, `u1=6.84`) | `pvlib.temperature.faiman` | Selisih maks = `0.00e+00 C` |
| Satu-dioda De Soto (daya MPP tahunan per modul) | `fit_desoto(lm)` + `calcparams_desoto` + `singlediode` | RenewableX = `1006.3786 kWh/mod`, pvlib = `1006.3786 kWh/mod`, selisih = `-1.022126e-10%` |

### 2.2 Golden, Colorado (`39.74, -105.18, UTC-7`)

| Sub-model | Fungsi Pembanding `pvlib` | Metrik Selisih Aktual |
|---|---|---|
| Posisi matahari (zenith, `zenith < 85 deg`) | `pvlib.solarposition.get_solarposition` (NREL SPA) | MAE = `0.2284 deg`, RMSE = `0.2585 deg` |
| Dekomposisi Erbs (DNI) | `pvlib.irradiance.erbs` | Selisih maks = `2.73e-12 W/m2`, selisih energi tahunan = `0.000000%` |
| Dekomposisi Erbs (DHI) | `pvlib.irradiance.erbs` | Selisih maks = `1.34e-12 W/m2`, selisih energi tahunan = `0.000000%` |
| Transposisi POA langit (`isotropic`) | `pvlib.irradiance.isotropic` | MAE = `0.000000e+00 W/m2`, selisih total = `0.000000%` |
| Transposisi POA langit (`hay_davies`) | `pvlib.irradiance.haydavies` | MAE = `9.295684e-15 W/m2`, selisih total = `0.000000%` |
| Transposisi POA langit (`perez`, 1990) | `pvlib.irradiance.perez` | MAE = `4.057619e-15 W/m2`, selisih total = `0.000000%` |
| Tracking 1-sumbu + backtracking (`gcr=0.35`, `max=60 deg`) | `pvlib.tracking.singleaxis` | MAE `tracker_theta` = `5.76e-15 deg` |
| Rugi pantulan ASHRAE IAM (`b0=0.05`) | `pvlib.iam.ashrae` | Selisih maks = `1.55e-15` |
| Suhu sel Faiman (`u0=25.0`, `u1=6.84`) | `pvlib.temperature.faiman` | Selisih maks = `0.00e+00 C` |
| Satu-dioda De Soto (daya MPP tahunan per modul) | `fit_desoto(lm)` + `calcparams_desoto` + `singlediode` | RenewableX = `1173.3522 kWh/mod`, pvlib = `1173.3522 kWh/mod`, selisih = `-4.214696e-11%` |

---

## 3. Analisis Penyebab Selisih

1. **Posisi matahari (`MAE 0.08 deg` di Jakarta dan `0.23 deg` di Golden, CO):**
   RenewableX menggunakan aproksimasi seri Fourier Spencer (1971) untuk sudut deklinasi dan equation of time tanpa koreksi refraksi atmosfer dan tanpa tahun kalender spesifik, sedangkan `pvlib.solarposition.get_solarposition` memakai algoritma penuh NREL SPA untuk tahun 2023. Selisih di bawah `0.25 deg` ini wajar dan memang diharapkan untuk simulasi per jam berbasis TMY.
2. **Erbs, Isotropic, Hay-Davies, Perez 1990, Single-Axis Backtracking, ASHRAE IAM, dan Faiman:**
   Ketika diberi sudut matahari yang sama, selisih berada pada orde presisi mesin `1e-15` hingga `1e-12` (nol secara praktis).
3. **Model Satu-Dioda De Soto:**
   Solver Levenberg-Marquardt dalam ruang log (`I_o`, `R_sh`) berbasis NumPy murni dan solver Bishop vektorisasi menghasilkan energi MPP tahunan yang identik hingga `1e-10%` terhadap `pvlib` (`calcparams_desoto` + `singlediode` berbasis metode Lambert W). Keunggulan tambahan dari parameterisasi log adalah solver parameter datasheet konvergen tanpa memerlukan `scipy` maupun penyesuaian tebakan awal manual.
