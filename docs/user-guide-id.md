# Panduan Pengguna RenewableX

Panduan ini disusun untuk pemilik proyek, insinyur, maupun pengguna non-teknis agar dapat merancang, mensimulasikan, membandingkan, dan mengekspor laporan sistem energi hybrid (**PV, BESS atau baterai, Biomass, Diesel Generator, dan EMS**) maupun screening kelayakan PV cepat.

---

## Bab 1: Memulai dengan RenewableX (Mode Cepat PV vs Desain Sistem Hybrid)

RenewableX memiliki dua ruang kerja yang dapat dipilih dari menu navigasi atas:

1. **Mode Cepat PV (`/`):**
   - Cocok untuk perkiraan awal kelayakan PLTS tanpa baterai dan tanpa profil beban per jam.
   - Menggunakan hasil tahunan, menghitung NPV, IRR, payback sederhana, serta tabel sensitivitas dasar secara cepat.
2. **Desain Sistem Hybrid (`/hybrid`):**
   - Simulasi per jam lengkap (**8.760 jam per tahun**, hingga **40 tahun** umur proyek) untuk sistem kombinasi **Solar PV** (model 8 tahap setara SAM atau PVWatts), **BESS (baterai)** beserta degradasi kalender/siklus, **Pembangkit Biomass**, **Diesel Generator** (opsional non-terbarukan), dan **Strategi EMS** (pengatur operasi sistem).
   - Data proyek tersimpan secara lokal di browser (`localStorage`). Anda disarankan mengekspor berkas cadangan `.hybrid.json` secara berkala melalui tombol **Ekspor** di Halaman 1 (`/hybrid`) atau Halaman 10.

> **Catatan Jujur Server Gratis Render (*Cold Start*):**
> Apabila mesin hitung di Render tidak menerima permintaan selama 15 menit, server akan masuk ke mode tidur. Permintaan pertama setelah tidur (*cold start*) dapat memakan waktu **30 sampai 60 detik**. Jangan tutup halaman ketika indikator memuat menampilkan pesan bangun server; proses akan lanjut otomatis begitu mesin aktif.

---

## Bab 2: Panduan Langkah demi Langkah Halaman 1 sampai Halaman 10

1. **Langkah 1: Proyek (`/hybrid`)**
   - Klik **"Muat Contoh Proyek [REAL DATA]"** untuk langsung mencoba konfigurasi lengkap (PV 500 kWp + BESS 600 kWh + Biomass 250 kW di Cikarang), atau klik **"Buat Proyek Baru"** untuk memulai dari nol.
   - Anda juga dapat menduplikat skenario, mengimpor berkas `.hybrid.json`, atau membuka halaman **"Panduan"** (`/hybrid/guide`).
2. **Langkah 2: Lokasi & Sumber Daya Cuaca (`/hybrid/[projectId]/location`)**
   - Isi nama proyek, koordinat lintang dan bujur (atau pilih preset kota Indonesia), serta zona waktu lokal (`WIB`, `WITA`, `WIT`, atau `UTC`).
   - Klik **"Ambil Data Cuaca PVGIS"** untuk mengunduh data radiasi surya (GHI, DNI, DHI), suhu udara, dan kecepatan angin per jam dari PVGIS v5.3 TMY (`PVGIS-ERA5`, periode 2005 sampai 2023).
3. **Langkah 3: Profil Beban Listrik (`/hybrid/[projectId]/load`)**
   - Pilih mode **Pembangkit Sintetis** (atur beban dasar, beban puncak, derau, dan seed agar hasil bisa diulang persis) atau mode **Unggah CSV 8.760 Jam**.
   - Klik **"Pratinjau & Validasi Beban"** untuk memeriksa kurva harian 24 jam dan peta panas tahunan 365 x 24.
4. **Langkah 4: Desain Sistem / Kanvas Skema (`/hybrid/[projectId]/system`)**
   - Atur komponen di kanvas interaktif: tambah komponen opsional (**BESS**, **Biomass**, **Diesel Generator**, **Grid**), geser posisi blok, atau hubungkan/putuskan kabel ke **AC BUS**.
   - Klik sebuah komponen untuk mengatur parameternya pada panel inspektor di sebelah kanan (atau di bawah kanvas pada layar ponsel `360px`).
   - Komponen wajib (**AC Bus**, **Solar PV**, dan **Beban Listrik**) terkunci agar tidak terhapus, dan bila kabelnya terputus sistem akan menampilkan galat validasi sebelum simulasi.
5. **Langkah 5: Strategi Operasi EMS (`/hybrid/[projectId]/ems`)**
   - Pilih salah satu dari 5 strategi bawaan: **Self-Consumption**, **Load Following**, **Cycle Charging**, **Peak Shaving**, atau **Time-of-Use Arbitrage**, atau pilih opsi EMS kustom lalu ubah kumpulan aturannya (disimpan sebagai JSON).
   - Atur izin impor dan ekspor listrik ke jaringan PLN/Grid serta parameter spesifik strategi (misalnya target SOC atau batas beban puncak).
   - *(Catatan: Aturan EMS kustom memakai format aturan draf sampai skema EMS final dari pemilik dikonfirmasi.)*
6. **Langkah 6: Ekonomi, Biaya & Tarif (`/hybrid/[projectId]/economics`)**
   - Pilih mata uang (**IDR** atau **USD**), umur proyek (1 sampai 40 tahun), model pajak (`Pre-Tax` atau `After-Tax`), tingkat diskonto (**WACC**), eskalasi tarif/O&M/bahan bakar, CAPEX per komponen, dan tarif listrik.
7. **Langkah 7: Ringkasan & Jalankan Simulasi (`/hybrid/[projectId]/run`)**
   - Periksa kembali ringkasan konfigurasi dan pastikan status topologi valid.
   - Pilih mode multi-tahun:
     - **`scaled_year_1` (Bawaan, Cepat):** Menjalankan simulasi 8.760 jam Tahun 1 secara penuh, lalu menskalakan degradasi PV dan jadwal penggantian ke Tahun 2 sampai N.
     - **`full_hourly` (Job Asinkron, Paling Detail):** Menjalankan 8.760 jam secara berurutan di seluruh N tahun umur proyek (termasuk penuaan baterai tiap jam) melalui antrean proses latar belakang.
   - Tekan **"Jalankan Simulasi"**.
8. **Langkah 8: Dasbor Hasil (`/hybrid/[projectId]/results`)**
   - **Tab Ringkasan & Bulanan:** Grafik energi bulanan bertumpuk, diagram rugi PV (Waterfall), **Diagram Aliran Energi (Sankey Tahun 1)**, **Skema Aliran SVG Tahun 1** (bisa diunduh sebagai SVG), serta kartu ringkasan teknis.
   - **Tab Dispatch & SOC:** Grafik aliran daya per jam (geser hari awal dan pilih rentang 24 jam, 3 hari, atau 7 hari), kurva SOC baterai, inspeksi alasan keputusan EMS per jam, dan **Kurva Durasi Beban & Pembangkitan**.
   - **Tab Peta Panas 8.760 Jam:** Matriks 365 hari x 24 jam untuk Beban, Produksi PV, SOC BESS, dan Unmet Load.
   - **Tab Keuangan & Arus Kas:** Arus kas tahunan & kumulatif, rincian LCOE, **Grafik Degradasi Kapasitas PV & BESS Umur Proyek**, tabel arus kas Tahun 0 sampai N, serta tombol ekspor cepat JSON/CSV.
9. **Langkah 9: Bandingkan (`/hybrid/[projectId]/compare`)**
   - **Sapuan Kombinasi HOMER:** Uji otomatis hingga 64 kombinasi ukuran PV, BESS, dan Biomass sekaligus, lihat Kurva Pareto, lalu klik **"Terapkan"** atau **"Simpan Skenario"**.
   - **Bandingkan Skenario Proyek:** Bandingkan hingga 4 proyek yang sudah disimulasikan secara berdampingan.
   - **Sensitivitas Hybrid:** Lihat grafik **Tornado** (dampak satu variabel terhadap NPV atau LCOE) dan **Matriks `5 x 5`** (klik sel mana saja untuk membaca angka eksak).
10. **Langkah 10: Ekspor Laporan (`/hybrid/[projectId]/export`)**
    - Cetak atau simpan **Laporan PDF (A4)** dengan Skema Aliran SVG bertema cetak terang.
    - Unduh **Buku Kerja Excel (`.xlsx`)** multi-sheet (`Ringkasan`, `Energi_Bulanan`, `Arus_Kas_Tahunan`, `Asumsi_Konfigurasi`, serta opsional `Hasil_Sapuan` dan `Sensitivitas`).
    - Unduh data mentah **CSV 8.760 Jam**, **CSV Arus Kas**, **CSV Hasil Sapuan**, dan bundel **JSON**.

---

## Bab 3: Format Berkas CSV Beban Listrik 8.760 Jam dan Solusi Galat Umum

Contoh berkas yang siap langsung diunggah tersedia di `examples/sample-load-8760.csv`.

### Aturan Wajib Berkas CSV
- **Jumlah baris data:** Tepat **8.760 nilai** per jam (kebijakan `ignore_feb_29`: 365 hari x 24 jam, tanpa tanggal 29 Februari).
- **Format kolom yang diterima:**
  1. **1 kolom** berisi angka beban dalam satuan **kW** saja, atau
  2. **2 kolom** dengan waktu di kolom pertama dan beban kW di kolom kedua (`waktu,load_kw`), misalnya:
     ```csv
     waktu,load_kw
     01-01 00:00,142.844
     01-01 01:00,129.023
     01-01 02:00,138.821
     01-01 03:00,142.501
     ```
- **Pemisah:** Koma (`,`) atau titik koma (`;`). Baris header teks di baris pertama otomatis dikenali dan dilewati bila kolom nilai tidak berupa angka.
- **Validasi nilai:** Tidak boleh ada sel kosong, teks tidak valid, `NaN`, atau nilai negatif (`< 0`).

### Solusi Pesan Galat CSV yang Sering Muncul
- `invalid_load_length`: Jumlah baris nilai bukan 8.760. Periksa apakah ada baris kosong di akhir berkas atau data tahun kabisat (8.784 baris) yang perlu dihapus baris tanggal 29 Februari-nya.
- `negative_load_value`: Ada angka beban bernilai `< 0`. Pastikan seluruh angka beban listrik bernilai `>= 0` (ekspor/surplus tidak ditulis sebagai beban negatif).
- `invalid_csv_format` / `non_finite_load_value`: Ada karakter non-angka pada kolom beban atau pemisah angka yang tidak konsisten.

---

## Bab 4: Arti Metrik Teknis dan Keuangan

| Istilah | Arti Sederhana untuk Pemilik Proyek |
|---|---|
| **LCOE** (*Levelized Cost of Energy*) | Biaya rata-rata per `kWh` listrik yang dihasilkan sistem sepanjang umur proyek, memperhitungkan CAPEX, O&M, bahan bakar, penggantian komponen, dikurangi nilai sisa dan kredit ekspor (semakin rendah semakin hemat). |
| **Total NPC** (*Net Present Cost*) | Total seluruh biaya proyek dari Tahun 0 sampai akhir umur proyek dalam nilai uang saat ini (terdiskonto dengan WACC), dikurangi pendapatan nilai sisa/ekspor. |
| **NPV** (*Net Present Value*) | Selisih nilai sekarang dari seluruh penghematan/pendapatan listrik dikurangi seluruh biaya proyek. **NPV > 0** berarti proyek memberi nilai tambah finansial di atas tingkat diskonto (WACC). |
| **IRR** (*Internal Rate of Return*) | Tingkat pengembalian tahunan efektif proyek. Proyek dinilai **Layak** bila `NPV > 0` dan `IRR >= WACC + margin kelayakan` (bawaan margin `2%`). |
| **Payback Sederhana / Terdiskonto** | Perkiraan tahun kapan modal awal proyek kembali. *Payback terdiskonto* menghitung pengembalian modal setelah memperhitungkan nilai waktu uang (WACC), sehingga waktunya lebih panjang daripada payback sederhana. |
| **Pangsa Terbarukan** (*Renewable Fraction*) | Persentase beban listrik yang dipasok oleh sumber energi terbarukan (PV dan Biomass terbarukan), tidak termasuk impor grid fosil dan Diesel Generator (non-terbarukan). |
| **Unmet Load** | Total energi beban (`kWh` atau `MWh`) yang gagal dipasok sistem karena kapasitas pembangkit dan baterai tidak mencukupi pada jam tertentu. |
| **Curtailment** | Kelebihan produksi listrik (umumnya PV pada siang hari) yang terpaksa dibuang karena baterai sudah penuh dan ekspor ke grid tidak diizinkan atau dibatasi. |
| **EFC** (*Equivalent Full Cycles*) | Jumlah siklus penuh baterai setara pengosongan 100% kapasitas efektifnya, dipakai untuk melacak keausan baterai. |
| **Emisi CO2e Dihindari** | Selisih emisi gas rumah kaca bila seluruh beban dibeli dari jaringan listrik baseline (`0,78 kg CO2e/kWh` `[REAL DATA]`) dibanding emisi operasi sistem hybrid. |

---

## Bab 5: Cara Membaca Sapuan HOMER, Kurva Pareto, Tornado, dan Matriks `5 x 5`

1. **Sapuan Kombinasi HOMER (Tab 1 Halaman 9):**
   - Anda menentukan beberapa kandidat ukuran **PV (kWp)**, **BESS (kWh)**, **Biomass (kW)**, dan opsional **Diesel Generator (kW)**. Masukkan `0` pada BESS, Biomass, atau Diesel untuk membandingkan konfigurasi tanpa komponen tersebut.
   - Mesin mengevaluasi semua kombinasi (maksimal `64` untuk mode `scaled_year_1`, `12` untuk `full_hourly`) dan memberi peringkat otomatis. Kombinasi yang gagal memenuhi batas **Maks. Unmet Load** atau **Min. Terbarukan** tetap ditampilkan di bawah dengan tanda alasan kegagalannya.
   - **Kurva Pareto** memetakan **Pangsa Terbarukan (sumbu X)** terhadap **LCOE (sumbu Y)**. Titik terbaik biasanya berada di kanan bawah (pangsa terbarukan tinggi dengan LCOE terendah).
2. **Tornado & Matriks `5 x 5` (Tab 3 Halaman 9):**
   - **Grafik Tornado** mengurutkan asumsi dari yang paling besar menggeser **NPV** atau **LCOE** (batang terpanjang di paling atas).
   - **Matriks `5 x 5`** menguji dua asumsi berubah bersamaan (misalnya total CAPEX dan tarif listrik). Klik sel mana saja (atau tekan `Tab` lalu `Enter`) untuk membaca nilai NPV, LCOE, IRR, dan status kelayakan pada sel tersebut.

---

## Bab 6: Penanda `[REAL DATA]` dan Pengisian Data Datasheet Nyata

Seluruh angka bawaan contoh pada proyek sampel berlabel **`[REAL DATA]`** bersumber dari [docs/assumptions.md](docs/assumptions.md) (misalnya CAPEX PV `Rp 11.500.000/kWp`, CAPEX BESS `Rp 3.500.000/kWh`, tarif acuan `Rp 1.445/kWh`, faktor emisi grid `0,78 kg CO2e/kWh`, serta 5 preset bahan bakar biomassa).

Sebelum memakai hasil untuk keputusan investasi atau penawaran komersial nyata, pastikan Anda mengganti parameter berikut dengan angka datasheet/penawaran resmi:
1. **Modul PV & Inverter (Halaman 4):** Kapasitas, rasio DC/AC, koefisien suhu, kurva efisiensi inverter, serta rugi kabel/shading aktual lokasi.
2. **Baterai BESS (Halaman 4):** Kapasitas, batas SOC aman pabrikan, efisiensi round-trip, serta laju degradasi garansi.
3. **Biomass & Diesel Generator (Halaman 4):** Kurva konsumsi bahan bakar (*heat rate* / liter per kWh), harga beli bahan bakar dan logistik setempat, interval overhaul, serta batas pasokan periodik.
4. **Ekonomi & Tarif (Halaman 6):** Nilai penawaran CAPEX EPC per komponen (termasuk Diesel bila aktif), biaya O&M kontrak, suku bunga diskonto (WACC), dan struktur tarif PLN/PPA yang berlaku.
