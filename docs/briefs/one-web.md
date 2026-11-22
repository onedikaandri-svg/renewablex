# Arahan Tugas untuk One (Web)

Kamu mengerjakan antarmuka web RenewableX, di bawah arahan lead engineer. Baca seluruh dokumen ini dan `docs/TEAM.md` sebelum mulai.

## Konteks singkat
RenewableX adalah alat screening kelayakan proyek PV (surya). Pengguna mengisi asumsi, lalu melihat energi tahun 1, NPV, IRR, dan payback. Semua hitungan dilakukan mesin FastAPI. Halaman web hanya menampilkan hasilnya.
- Mesin hitung: `https://renewablex.onrender.com` (paket gratis, bisa lambat sampai sekitar satu menit pada pemakaian pertama).
- Kontrak API: `docs/api.md`. Contoh: `examples/sample-pv-project.json` dan `examples/sample-pv-response.json`.
- Arah tampilan: `DESIGN.md`. Aplikasi: Next.js 16, React 19, TypeScript, tanpa pustaka UI.

## Wilayah kamu
Hanya `apps/web/`. Jangan ubah `services/`, `docs/api.md`, `examples/`, `.github/`, atau `supabase/`. Butuh perubahan di sana, tulis permintaan di laporan.

## Aturan tampilan
- Ikuti `DESIGN.md`: palet navy, satu aksen hijau, DM Sans, kartu abu muda. Emas dan merah hanya sebagai latar status dengan teks gelap.
- Teks isi minimal kontras 4,5:1, batas input dan tombol minimal 3:1, di mode terang dan gelap. Hitung, jangan menebak.
- Layar 375 px tanpa gulir mendatar. Target sentuh minimal 44 px.
- Semua kontrol bisa dipakai dengan keyboard, fokus terlihat, ada label, dan ada keadaan kosong, memuat, dan galat.
- Tanpa emoji dekoratif, tanpa em dash, tanpa angka karangan. Isian contoh harus berlabel contoh.
- Satu-satunya tempat yang memanggil API adalah `lib/api.ts` (dan modul sensitivitas di W3). Jangan menyalin rumus dari mesin.
- Bahasa tampilan: Indonesia.

## Tugas (kerjakan berurutan, satu Pull Request per tugas)

### W1. Pesan galat berbahasa Indonesia
Mesin mengembalikan galat validasi (HTTP 422) berbahasa Inggris, contoh "Input should be less than or equal to 40". `lib/api.ts` kini hanya menyimpan teks `msg`.
- Simpan juga `type` dan `ctx` dari tiap item galat FastAPI, lalu terjemahkan di satu tabel pemetaan (`greater_than`, `greater_than_equal`, `less_than`, `less_than_equal`, `missing`, `string_pattern_mismatch`, `literal_error`, `int_parsing`, `float_parsing`, `int_from_float`, dan `value_error`).
- Tiga pesan `value_error` kustom mesin: soal hitung ganda loss pada yield bersih, `location_based` belum tersedia, dan hanya `fixed_tariff` yang didukung. Terjemahkan juga, dengan mencocokkan potongan teksnya. Teks yang tidak dikenal ditampilkan apa adanya.
- Selesai bila: tabel pemetaan punya tes unit (tambahkan Vitest sebagai dev dependency dan skrip `npm test`), semua batas di `docs/api.md` menghasilkan pesan Indonesia yang menyebut batasnya, dan `npm run typecheck` serta `npm run build` lolos. Lead yang menambahkan `npm test` ke CI.

### W2. Aksesibilitas
- Telusuri seluruh halaman hanya dengan keyboard dan perbaiki yang macet: urutan Tab, fokus setelah kirim, fokus setelah Kosongkan Form.
- Periksa nama aksesibel semua kontrol, tabel (judul kolom, keterangan), grafik (teks alternatif), dan pengumuman keadaan memuat dan galat.
- Hitung ulang kontras semua pasangan warna di `globals.css`, terang dan gelap.
- Jika kamu bisa menjalankan browser, uji sungguhan. Jika tidak, tulis jujur di laporan bahwa pemeriksaan hanya lewat pembacaan kode.
- Selesai bila: daftar temuan beserta perbaikannya ada di laporan, dan tidak ada temuan yang dibiarkan tanpa penjelasan.

### W3. Tampilan sensitivitas
Tambahkan panel "Sensitivitas" di bawah hasil: seberapa besar NPV berubah bila satu asumsi digeser.
- Variabel: yield spesifik, tarif, CAPEX, OPEX, discount rate. Pergeseran: -20%, -10%, +10%, +20% terhadap nilai pengguna.
- Tiap sel berasal dari satu panggilan `POST /v1/pv/preliminary`. Selisih = NPV varian dikurangi NPV dasar. Hanya itu hitungan yang boleh ada di web.
- Mesin gratis lambat dan berbagi sumber daya: kirim paling banyak 2 panggilan bersamaan, tampilkan kemajuan, dan tangani kegagalan sebagian dengan jelas.
- Letakkan seluruh logika panggilan di satu modul `lib/sensitivity.ts`. Lead akan menggantinya dengan endpoint khusus nanti (L2), jadi modul itu harus mudah diganti.
- Urutkan baris dari yang paling berpengaruh. Beri judul yang menyebut pertanyaan yang dijawabnya. Satuan dan mata uang selalu tertulis.
- Selesai bila: berfungsi di 375 px dan desktop, keadaan memuat, kosong, dan galat ada, dan tes untuk fungsi pembangun skenario lolos.

## Cara memeriksa pekerjaanmu
```bash
cd apps/web
npm ci
npm run typecheck
npm run build
```
Untuk uji manual, jalankan mesin di komputer (lihat `docs/api.md`) atau pakai alamat Render di atas, lalu set `NEXT_PUBLIC_API_URL` di `.env.local`.

## Kapan berhenti dan bertanya ke lead
Kontrak API tampak salah atau kurang, kamu perlu mengubah file di luar `apps/web/`, atau dua aturan di atas bertentangan.
