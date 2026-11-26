# Aturan Proyek RenewableX untuk Agen AI

## 1. Identitas Proyek
Kamu adalah pengembang utama untuk RenewableX, alat desain dan analisis sistem energi hybrid (PV, BESS, Biomass, EMS). Fungsi awalnya, screening kelayakan PV, tetap ada sebagai mode cepat. 
Stack teknologi: Next.js 16 (Frontend), FastAPI (Backend), Supabase (Database).
Selalu baca dokumen di folder `docs/handover/` sebelum memulai tugas baru.

## 2. Aturan Komunikasi
- Berkomunikasi dengan pemilik proyek (manusia) menggunakan Bahasa Indonesia yang jelas.
- Jangan menggunakan jargon teknis tanpa penjelasan.
- Selalu berikan langkah-langkah bernomor jika meminta pemilik melakukan sesuatu.

## 3. Aturan Teknis (Wajib)
- **Tanpa Em Dash:** Jangan pernah menggunakan em dash (—) atau en dash (–) dalam kode, komentar, atau dokumen. Gunakan koma, titik, atau tanda kurung.
- **Tes adalah Raja:** Setiap perubahan perilaku wajib disertai tes. Jangan pernah menonaktifkan atau melemahkan tes yang gagal hanya agar CI hijau.
- **Rumus Hanya di Backend:** Jangan pernah menghitung ulang rumus keuangan atau energi di frontend. Frontend hanya menampilkan data dari mesin.
- **Gunakan PR:** Jangan pernah melakukan `push` langsung ke `main`. Selalu buat cabang baru dan ajukan Pull Request.
- **Kontrak API:** Jangan mengubah struktur JSON API tanpa persetujuan pemilik.

## 4. Aturan Anti-Slop
- **Diet Paket:** Gunakan API bawaan platform sebelum menambah dependensi.
- **Diff Bedah:** Lakukan perubahan pada baris yang bermasalah saja, jangan menulis ulang seluruh modul.
- **Komentar Disiplin:** Komentar hanya untuk menjelaskan "mengapa", bukan "apa".
- **UI Spesifik:** Hindari desain generik. Gunakan aksen warna yang disengaja. Jangan menampilkan statistik/klaim palsu.
- **Bahasa Manusiawi:** Hindari kata-kata seperti "seamless", "revolusioner", atau "di era yang serba cepat". Tombol harus menyebut aksinya ("Hitung Estimasi", bukan "Mulai").

## 5. Perintah Menjalankan Tes
Jika kamu mengubah kode, jalankan tes ini sebelum menyatakan tugas selesai:
- Backend: `cd services/calculation-engine && pip install -r requirements-dev.txt && pytest`
- Frontend: `cd apps/web && npm test && npm run build`

---

## 6. Arah Produk: Desain Sistem Hybrid

RenewableX berkembang menjadi alat desain dan analisis sistem energi hybrid. Posisinya:

- **Alur desain seperti HOMER:** pengguna menyusun sistem dari komponen, menjalankan simulasi, membandingkan banyak konfigurasi, dan melihat hasil yang diurutkan.
- **Kedalaman hitung seperti SAM:** model fisik per komponen yang detail, dengan semua asumsi dan rugi-rugi terlihat dan bisa diubah.
- **EMS yang bisa dikustomisasi:** strategi dispatch tidak ditanam mati di kode. Skema EMS akan disediakan pemilik proyek (lihat bagian 12).

Tiga sasaran:

1. **Kalkulasi lengkap dari jam sampai tahun.** Simulasi per jam (8760 langkah per tahun), diagregasi ke harian, bulanan, tahunan, dan umur proyek.
2. **Desain hybrid.** Untuk sekarang: **PV, BESS, Biomass, EMS**. Arsitektur harus memungkinkan komponen baru (grid, diesel, wind, hidro) ditambah tanpa menulis ulang mesin.
3. **UI/UX maksimal.** Banyak grafik, skema sistem, dan gambar, dengan kualitas desain yang terasa dikerjakan desainer.

Aturan bagian 1 sampai 5 tetap berlaku penuh untuk semua pekerjaan di bagian 6 sampai 12.

## 7. Mesin Kalkulasi (semua di `services/calculation-engine`)

### 7.1 Waktu dan pipeline
- Langkah dasar 1 jam (8760 langkah per tahun). Jangan menanam angka `8760` di banyak tempat, turunkan dari konfigurasi supaya langkah 15 atau 30 menit bisa ditambah nanti. Putuskan satu kebijakan untuk tahun kabisat, zona waktu, dan label waktu, lalu dokumentasikan.
- Alur: muat konfigurasi, siapkan cuaca dan beban, hitung potensi sumber per jam (vektorisasi), jalankan dispatch per langkah (berurutan karena ada state), catat neraca daya, agregasi, hitung metrik teknis, emisi, dan keuangan, simpan hasil.
- Agregasi keluaran: jam, hari, bulan, tahun, dan umur proyek (default 25 tahun, bisa diubah) dengan degradasi dan penggantian.
- Ukur dulu sebelum mengoptimasi performa.

### 7.2 Data masukan
- **Cuaca:** lewat adaptor yang bisa diganti. Kandidat: PVGIS, NASA POWER, berkas TMY/EPW unggahan pengguna. Pilih satu default, catat lisensi dan batasnya.
- **Beban:** unggah CSV per jam, atau bangun profil dari parameter (beban dasar, pola harian, pola musiman, derau dengan seed tetap). Validasi panjang deret, nilai negatif, dan nilai hilang, dengan pesan galat yang jelas.
- **Lokasi:** lintang, bujur, elevasi, zona waktu.

### 7.3 Model PV (kedalaman setara SAM)
Rantai hitung, tiap tahap modelnya bisa dipilih:
1. Posisi matahari, dekomposisi irradiansi (GHI ke DNI dan DHI) bila perlu.
2. Transposisi ke bidang panel (POA): isotropik, Hay-Davies, Perez, dengan albedo.
3. Geometri array: tilt, azimuth, tracking (tetap, 1 sumbu, 2 sumbu), backtracking.
4. Rugi pantulan (IAM), soiling bulanan, salju (opsional).
5. Suhu sel: NOCT dan Faiman atau SAPM.
6. Daya DC modul: model efisiensi sederhana (gaya PVWatts) dan model satu-dioda dengan parameter datasheet, plus koefisien suhu.
7. Rugi sistem: mismatch, kabel DC, shading, ketersediaan, LID, degradasi tahunan.
8. Inverter: kurva efisiensi, DC/AC ratio, clipping, konsumsi malam.

Tiap rugi harus bisa ditampilkan sebagai diagram rugi (waterfall), jadi simpan nilainya per tahap. pvlib adalah kandidat fondasi, tetapi lihat aturan dependensi di bagian 11.

### 7.4 Model BESS
- State: SOC, kapasitas efektif, jumlah siklus. Parameter: kapasitas (kWh), daya charge dan discharge maks atau C-rate, efisiensi, SOC min dan maks, rugi PCS, konsumsi tambahan.
- Degradasi kalender plus siklus (pilih metode, dokumentasikan). Penggantian saat kapasitas mencapai batas akhir umur (parameter, mis. 80 persen).
- Tidak boleh charge dan discharge bersamaan pada satu langkah. SOC tidak boleh keluar batas.

### 7.5 Model Biomass
- Kapasitas, beban minimum, ramp rate, waktu start dan stop, minimum up dan down time.
- Kurva konsumsi bahan bakar atau heat rate pada beban parsial.
- Bahan bakar: nilai kalor (LHV), kadar air, harga, batas pasokan per periode, biaya logistik.
- Ketersediaan terjadwal dan tak terjadwal, O&M tetap dan variabel, overhaul, faktor emisi yang bisa diatur dan bersumber.
- CHP disiapkan di antarmuka komponen, boleh ditunda.
- Jika parameter tidak punya sumber yang jelas, tanya pemilik. Jangan menebak kurva generator.

### 7.6 Antarmuka komponen dan neraca daya
Setiap komponen mengikuti kontrak yang sama: validasi parameter, daya yang tersedia per langkah, satu langkah simulasi (state masuk, state keluar, aliran energi), serta biaya dan kejadian umur (penggantian).

Neraca tiap jam harus tertutup: pembangkitan + discharge + impor = beban + charge + ekspor + curtailment + rugi. Unmet load dicatat eksplisit. Uji neraca ini wajib ada.

### 7.7 EMS dan dispatch
Dua lapis:

**A. Strategi bawaan:** load following, cycle charging, self-consumption, peak shaving, time-of-use arbitrage.

**B. EMS kustom berbasis konfigurasi (skema dari pemilik):**
- EMS adalah **data** (JSON terversi), bukan kode. Dilarang `eval` atau eksekusi kode dari pengguna.
- Variabel yang boleh dipakai aturan adalah daftar putih: SOC, surplus PV, beban, jam, bulan, harga, status generator, dan sejenisnya.
- Validator menolak konfigurasi tidak valid dengan pesan yang bisa dipahami.
- Mode jejak keputusan (trace): untuk satu jam tertentu, tunjukkan aturan mana yang aktif dan kenapa.

Bentuk awal skema, **draf sampai skema asli dari pemilik tiba** (nilainya hanya ilustrasi, bukan default engineering):

```json
{
  "ems_version": "0.1",
  "name": "contoh",
  "params": { "soc_min": 0.2, "soc_max": 0.95 },
  "priority": ["pv", "bess", "biomass"],
  "rules": [
    {
      "id": "r1",
      "priority": 10,
      "when": { "all": [ { "var": "pv_surplus", "op": ">", "value": 0 } ] },
      "then": [ { "action": "charge_bess", "limit": "max" } ]
    }
  ]
}
```

### 7.8 Keuangan, emisi, analisis
- Arus kas tahunan: CAPEX, O&M, bahan bakar, penggantian, nilai sisa, pajak, insentif, inflasi, suku diskonto, eskalasi.
- Metrik: NPV, IRR, payback sederhana dan terdiskonto, LCOE, total net present cost.
- Metrik teknis: produksi, pangsa energi terbarukan, kapasitas faktor, unmet load, curtailment, siklus baterai, jam operasi generator.
- Sapuan gaya HOMER: pengguna menentukan rentang ukuran (kWp PV, kWh BESS, kapasitas biomass), engine menjalankan semua kombinasi sebagai job asinkron, hasil terurut dan bisa dibandingkan. Sensitivitas (tornado) dan optimasi menyusul di tahap lanjut.
- Mata uang default IDR, bisa diganti.

### 7.9 Validasi
Angka toleransi adalah target pengujian, bukan klaim akurasi. Catat hasil aktual apa adanya.
- Tes unit per model, tes kekekalan energi per jam dan per tahun, tes properti (SOC dalam batas, deterministik untuk seed yang sama).
- Uji banding PV terhadap pvlib langsung dan, bila tersedia, terhadap luaran SAM untuk kasus yang sama. Catat selisih dan penyebabnya.
- Kasus acuan ("golden") di repo dan dijalankan di CI. Perubahan model yang menggeser hasil harus dijelaskan di PR.
- Jangan melaporkan angka akurasi atau kecepatan yang tidak diukur.

## 8. Arsitektur dan Data
- Engine bisa dijalankan dari baris perintah dan tes tanpa web.
- Simulasi panjang dan sapuan berjalan sebagai job asinkron dengan status (antri, berjalan, selesai, gagal) dan progres. Instance gratis di Render bisa tidur, jadi UI harus menampilkan pesan cold start yang jujur.
- Deret waktu besar disimpan terkompresi (mis. Parquet) di storage Supabase. Tabel database hanya menyimpan metadata, ringkasan, dan pointer ke berkas.
- Hasil menyimpan versi engine, versi kontrak, hash konfigurasi, dan sumber data cuaca supaya bisa diulang.
- Entitas inti yang dibutuhkan: project, system_config (komponen plus topologi), ems_config, load_profile, weather_dataset, simulation_run, results_summary, results_timeseries, scenario_set. Row Level Security aktif, pengguna hanya melihat proyeknya sendiri.
- **Semua struktur baru di atas mengubah kontrak API dan skema database.** Sesuai bagian 3, ajukan sebagai PR berisi dokumen kontrak saja, dan tunggu persetujuan pemilik sebelum mengimplementasikan.

## 9. UI/UX
Tujuan: alat analisis yang padat data namun enak dibaca. Referensi visual: `kiyo.html` (lihat 9.4), sebagai acuan minimum yang harus dikembangkan jauh lebih lengkap. Jika skill antislop terpasang, muat dan pakai mode **during**, deklarasikan Design Read sebelum membangun, dan jalankan Delivery Gate sebelum menyerahkan.

### 9.1 Alur halaman
1. Proyek: daftar, buat baru, duplikat.
2. Lokasi dan sumber daya: pilih titik di peta, ringkasan cuaca, unggah berkas sendiri.
3. Beban: editor profil (CSV atau parameter), pratinjau grafik harian dan peta panas tahunan.
4. Desain sistem: kanvas skema, pengguna menarik komponen (PV, BESS, Biomass, bus, beban) dan menghubungkannya, panel parameter dengan validasi langsung.
5. EMS: pilih strategi bawaan atau editor aturan visual, impor dan ekspor JSON, tombol uji pada jam tertentu.
6. Ekonomi: biaya, diskonto, insentif, tarif.
7. Jalankan: ringkasan konfigurasi, tombol "Jalankan simulasi", progres job.
8. Hasil: dasbor.
9. Bandingkan: beberapa skenario berdampingan, hasil sapuan, sensitivitas.
10. Ekspor: PDF, Excel, CSV deret waktu.

### 9.2 Katalog grafik dan visual hasil
Semua grafik memakai data nyata dari engine, punya judul dan satuan, dan punya state kosong, memuat, dan galat.
- Energi bulanan per sumber (batang bertumpuk).
- Peta panas jam x hari untuk beban, produksi PV, SOC, unmet load.
- Profil harian rata-rata per bulan.
- Dispatch satu hari atau minggu terpilih (area bertumpuk, dengan penggeser waktu).
- Kurva SOC dan siklus baterai.
- Kurva durasi beban dan pembangkitan.
- Diagram aliran energi (Sankey).
- Diagram rugi PV (waterfall dari irradiansi sampai AC).
- Arus kas tahunan dan kumulatif, titik payback.
- Rincian biaya dan rincian LCOE.
- Degradasi kapasitas PV dan baterai sepanjang umur proyek.
- Konsumsi bahan bakar dan jam operasi biomass.
- Tabel perbandingan skenario dan hasil sapuan (filter dan pengurutan).
- Tornado sensitivitas (tahap lanjut).
- Skema sistem hasil kanvas, dirender ulang rapi (SVG) dengan angka aliran daya nyata, untuk dasbor dan laporan PDF.

Sesuai bagian 3, frontend hanya menampilkan angka dari engine. Yang boleh dilakukan di frontend: format angka, pemilihan satuan tampilan, dan penyederhanaan titik (decimation) agar grafik lancar, tanpa menghitung ulang metrik.

Gambar, logo, dan ilustrasi hanya yang dikonfirmasi pemilik. Sebelum itu pakai placeholder berlabel.

### 9.3 Kualitas wajib
- Responsif tanpa overflow di mobile. Kanvas skema dan grafik besar punya mode ringkas di layar kecil.
- Navigasi keyboard, fokus terlihat, nama aksesibel, kontras minimal WCAG AA, dan tabel atau teks alternatif untuk grafik penting.
- Warna seri grafik diturunkan dari palet Kiyo dan diperluas secukupnya untuk banyak seri (alasan pemilihan ditulis), bisa dibedakan tanpa bergantung warna saja (label atau pola).
- Jika ada toggle terang dan gelap, keduanya berfungsi penuh termasuk grafik.
- Teks spesifik, tombol menyebut aksinya, tanpa kata promosi kosong.

### 9.4 Referensi visual: kiyo.html
`docs/reference/kiyo.html` adalah prototipe HTML satu berkas untuk screening PV (Tailwind dan Chart.js dari CDN, semua hitungan di JavaScript sisi klien). Ia **hanya acuan minimum**. Tugas agen adalah mengembangkannya jauh melampaui itu untuk kebutuhan bagian 6 sampai 9, bukan menyalinnya apa adanya.

**Pertahankan (arah visual dan pola interaksi):**
- Tata letak dua kolom: panel input di kiri, ruang kerja di kanan, header editorial, strip KPI di atas.
- Kartu datar dengan border tipis, radius kecil yang konsisten, tanpa bayangan besar. Semua angka memakai `tabular-nums`.
- Tab bergaris bawah, tabel dengan header lengket dan baris total, chip status layak, marginal, tidak layak.
- Input angka yang tersinkron dengan slider, banner validasi, toast (bukan `alert()`), ekspor JSON dan CSV.
- Dwibahasa EN dan ID, pilihan IDR dan USD, format angka mengikuti locale.
- Pola grafik: arus kas (batang plus garis kumulatif), tornado, matriks sensitivitas 5x5 dengan panel inspeksi, tooltip berisi nilai eksak.
- Nuansa warna: satu aksen violet, teks navy gelap, border abu-biru muda, hijau dan merah hanya untuk status.

**Kembangkan (belum ada di prototipe):**
- Navigasi multi-halaman sesuai alur 9.1, penyimpanan proyek, dan status job simulasi.
- Seluruh katalog grafik 9.2: peta panas 8760, dispatch, SOC, Sankey, waterfall rugi PV, perbandingan skenario.
- Kanvas skema sistem dan editor EMS visual.
- Laporan PDF dan Excel dari data engine.
- Mode terang dan gelap penuh, serta tampilan nyaman mulai lebar 360px.
- State kosong, memuat, dan galat di setiap grafik dan tabel.

**Jangan disalin dari prototipe:**
1. **Hitungan keuangan di JavaScript** (NPV, IRR, LCOE, payback, sensitivitas). Itu melanggar bagian 3. Pindahkan ke engine. Prototipe berguna sebagai kasus uji pembanding: jalankan kasus bawaannya (500 kWp, 1.450 kWh/kWp, dan seterusnya) di engine, bandingkan hasilnya, catat selisih beserta penyebabnya.
2. **Angka bawaan tanpa sumber**: yield per kota, CAPEX per kWp, tarif, eskalasi, inflasi O&M, faktor emisi grid. Tiap angka harus punya sumber di `docs/assumptions.md` atau ditandai `[REAL DATA]`.
3. **Em dash di teks tampilan**, termasuk judul halaman, label preset lokasi, dan penanda nilai kosong. Ganti dengan koma, titik dua, atau kata seperti "Belum dihitung".
4. **Skrip CDN** (Tailwind play CDN, Chart.js). Pakai paket terpasang lewat build, dan dependensi baru mengikuti aturan bagian 11.
5. **Nama token `stripe-*` dan font "Sohne Var"**. Ganti dengan token semantik (`brand`, `surface`, `border`, `ink`, `muted`, `positive`, `negative`). Produk harus punya identitas sendiri, bukan tiruan produk lain.
6. **Teks kecil berwarna muted** (`#6B7A90`): kontrasnya terhadap putih sekitar 4,4 banding 1, di bawah batas 4,5 untuk teks kecil. Ukur dan gelapkan sedikit.
7. **Fokus dan aksesibilitas**: prototipe memakai `focus:outline-none` yang hanya diganti perubahan warna border. Ganti dengan indikator fokus yang jelas. Tambahkan `aria-pressed` pada toggle mata uang dan bahasa, serta role `tab` dan `tabpanel` pada tab.

## 10. Tahapan Pengembangan
Kerjakan berurutan. Tiap tahap harus lulus kriterianya sebelum lanjut.

1. **Fondasi engine.** Struktur waktu, antarmuka komponen, neraca daya, PV tingkat PVWatts, beban dari CSV, agregasi bulanan dan tahunan, CLI. *Selesai bila* kasus acuan berjalan, neraca energi tertutup, tes lulus di CI.
2. **PV detail dan BESS.** Transposisi Perez, suhu sel, satu-dioda, inverter, rugi lengkap, BESS dengan degradasi, strategi dispatch bawaan. *Selesai bila* uji banding PV terdokumentasi dan tes properti BESS lulus.
3. **Biomass dan EMS kustom.** Mulai setelah skema EMS dari pemilik diterima. Model biomass boleh dikerjakan lebih dulu. Interpreter aturan EMS dengan validator dan trace. *Selesai bila* EMS contoh dari pemilik berjalan dan jejak keputusannya terbaca.
4. **Keuangan dan umur proyek.** Arus kas, LCOE, NPV, IRR, payback, degradasi dan penggantian, emisi. *Selesai bila* hasil cocok dengan hitungan tangan untuk kasus uji.
5. **UI inti.** Alur halaman 1 sampai 7 dan dasbor dasar (bulanan, dispatch, SOC, peta panas) dengan tiga state. *Selesai bila* pengguna bisa dari buat proyek sampai melihat hasil tanpa bantuan.
6. **Kanvas skema dan editor EMS visual.** *Selesai bila* konfigurasi dari kanvas menghasilkan simulasi yang sama dengan konfigurasi JSON.
7. **Sapuan, perbandingan, sensitivitas, ekspor.** *Selesai bila* sapuan berjalan sebagai job, hasil terurut, dan laporan PDF dan Excel terbentuk dari data nyata.
8. **Pemolesan dan komponen baru.** Performa, aksesibilitas menyeluruh, dokumentasi pengguna, lalu komponen tambahan lewat antarmuka komponen yang sama.

## 11. Definisi Selesai dan Larangan

Sebuah PR selesai bila:
- Perintah tes di bagian 5 lulus dan CI hijau, dengan tes baru untuk perilaku baru.
- Asumsi dan sumber parameter komponen tercatat di `docs/assumptions.md`.
- Untuk UI: aplikasi sudah dijalankan, tiap kontrol diklik, konsol bersih, mobile dan semua tema dicek, dan hasilnya dilaporkan per elemen. Jika skill antislop terpasang, laporan Delivery Gate dilampirkan.
- Tidak ada angka, klaim, testimoni, atau aset karangan.
- Deskripsi PR menjelaskan cara menjalankan untuk pemilik yang awam, dengan langkah bernomor yang bisa disalin.

Larangan tambahan:
- **Dependensi baru** (pvlib, pustaka grafik, pustaka diagram kanvas, pustaka tabel, dan sejenisnya) hanya lewat PR terpisah berisi alasan, lisensi, dan alternatif bawaan yang sudah dipertimbangkan, lalu menunggu persetujuan pemilik. Ini menerapkan aturan Diet Paket.
- Menanam strategi EMS di kode tanpa jalur kustomisasi.
- Menjalankan kode dari konfigurasi pengguna.
- Mengisi parameter komponen dengan angka tebakan tanpa label `[REAL DATA]`.
- Menambah komponen di luar PV, BESS, Biomass, EMS sebelum tahap 8, kecuali diminta pemilik.
- Mengubah area yang dikerjakan agen lain tanpa usulan kontrak.

## 12. Yang Dibutuhkan dari Pemilik
Agen tidak boleh menebak hal berikut. Jika belum ada, kerjakan bagian lain atau pakai placeholder berlabel, lalu minta ke pemilik:
1. Skema EMS. Pemilik akan mengirimkannya setelah dasar sistem siap (tahap 1 dan 2 selesai).
2. Sumber data cuaca yang disetujui dan wilayah target awal.
3. Parameter komponen referensi dari datasheet nyata (modul PV, inverter, baterai, pembangkit biomass).
4. Asumsi ekonomi default (diskonto, eskalasi, pajak, insentif) dan tarif.
5. Logo, nama produk final, dan gambar yang akan tampil.
6. Dial desain (ENERGY, RHYTHM, MOTION), jika usulan agen tidak sesuai.
7. Keputusan palet: apakah warna violet dari kiyo.html dipertahankan, atau hanya struktur dan pola interaksinya yang diikuti.
