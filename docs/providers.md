# Penyedia Data Lokasi (Resource Providers)

Dokumen ini mencatat sumber data surya eksternal, parameter yang dipakai, arti nilai yang dikembalikan, serta batasannya untuk mode `location_based`.

## 1. PVGIS (Joint Research Centre, Komisi Eropa)

- **Implementasi:** `services/calculation-engine/app/providers/pvgis.py` (`PVGISProvider`)
- **Dokumentasi resmi:** `https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en`
- **Tanggal baca:** 2026-11-25
- **Endpoint yang dipakai:** `GET https://re.jrc.ec.europa.eu/api/v5_3/PVcalc`
- **Versi API:** `v5_3`

### Parameter Permintaan

`PVGISProvider` memanggil endpoint `PVcalc` dengan metode `GET` dan parameter berikut:

| Parameter | Nilai | Keterangan |
|---|---|---|
| `lat` | dari input | Lintang desimal (-90 sampai 90, selatan bernilai negatif) |
| `lon` | dari input | Bujur desimal (-180 sampai 180, barat bernilai negatif) |
| `peakpower` | `1` | Kapasitas nominal 1 kWp agar `E_y` langsung bernilai kWh/kWp/tahun |
| `loss` | `14.0` (default) | Total rugi sistem dalam persen (0 sampai kurang dari 100) |
| `angle` | dari input | Sudut kemiringan modul dari bidang horizontal (derajat) |
| `aspect` | dari input | Orientasi/azimuth modul (konvensi PVGIS: `0` = Selatan, `90` = Barat, `-90` = Timur, `180`/`-180` = Utara) |
| `outputformat` | `json` | Mengembalikan format JSON terstruktur |

### Batas Yield (Yield Boundary)

`PVGISProvider` mengembalikan `yield_boundary = "net_ac_at_delivery"`.

Alasan: endpoint `PVcalc` sudah menerapkan rugi sistem (`loss`, default 14,0%), serta rugi suhu, sudut datang, dan spektral secara internal sebelum menghasilkan `outputs.totals.fixed.E_y`. Karena itu, mesin hitung tidak boleh menerapkan `performance_loss_fraction` lagi di atas hasil PVGIS (mencegah penghitungan ganda).

### Cakupan Wilayah (Termasuk Indonesia)

- Database satelit `PVGIS-SARAH3` hanya mencakup Eropa, Afrika, dan Asia bagian barat (tidak mencakup wilayah Indonesia di sekitar 95 BT sampai 141 BT).
- Ketika tidak memaksa parameter `raddatabase`, PVGIS v5.3 otomatis memilih database yang tersedia untuk koordinat tersebut. Untuk wilayah daratan Indonesia (diverifikasi pada Jakarta `-6.2, 106.8` dan Papua `-2.5, 140.7`), PVGIS v5.3 menggunakan `PVGIS-ERA5` (data reanalisis global periode `2005-2023`).
- Titik di atas laut atau di luar cakupan daratan mengembalikan HTTP `400` dengan pesan `"Location over the sea. Please, select another location"`, yang dipetakan ke `ResourceErrorKind.OUT_OF_COVERAGE`.

### Ketentuan Pemakaian dan Keterbatasan

- **Batas laju (rate limit):** 30 panggilan per detik per alamat IP (HTTP `429`).
- **Batas komputasi serentak:** Bila server sibuk, PVGIS mengembalikan HTTP `529` ("Site is overloaded").
- **Akses browser:** PVGIS melarang panggilan AJAX langsung dari browser; panggilan harus dilakukan dari server backend.
- **Mitigasi di adapter:** `PVGISProvider` menerapkan batas waktu default 10 detik, percobaan ulang terbatas (default 2 kali untuk timeout, HTTP 429, 502, 503, 504, dan 529), serta cache dalam memori dengan TTL default 3600 detik.
- **Konvensi azimuth:** Saat menyambungkan ke frontend/API (tugas V4), pastikan konvensi azimuth pengguna (mis. kompas 0 = Utara) dikonversi atau didokumentasikan sesuai konvensi PVGIS (0 = Selatan).
