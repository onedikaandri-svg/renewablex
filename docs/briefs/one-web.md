# Arahan Tugas untuk One (Web)

Kamu mengerjakan antarmuka web RenewableX, di bawah arahan manager proyek. Baca seluruh dokumen ini dan `docs/TEAM.md` sebelum mulai.

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
- Selesai bila: tabel pemetaan punya tes unit (tambahkan Vitest sebagai dev dependency dan skrip `npm test`), semua batas di `docs/api.md` menghasilkan pesan Indonesia yang menyebut batasnya, dan `npm run typecheck` serta `npm run build` lolos. Val (engineer mesin) yang menambahkan `npm test` ke CI bila belum ada.

### W2. Aksesibilitas
- Telusuri seluruh halaman hanya dengan keyboard dan perbaiki yang macet: urutan Tab, fokus setelah kirim, fokus setelah Kosongkan Form.
- Periksa nama aksesibel semua kontrol, tabel (judul kolom, keterangan), grafik (teks alternatif), dan pengumuman keadaan memuat dan galat.
- Hitung ulang kontras semua pasangan warna di `globals.css`, terang dan gelap.
- Jika kamu bisa menjalankan browser, uji sungguhan. Jika tidak, tulis jujur di laporan bahwa pemeriksaan hanya lewat pembacaan kode.
- Selesai bila: daftar temuan beserta perbaikannya ada di laporan, dan tidak ada temuan yang dibiarkan tanpa penjelasan.

### W3. Tampilan sensitivitas
Tambahkan panel "Sensitivitas" di bawah hasil: seberapa besar NPV berubah bila satu asumsi digeser.
- Gunakan endpoint mesin `POST /v1/pv/sensitivity` (lihat bagian Sensitivity di `docs/api.md` dan contoh `examples/sample-sensitivity-request.json`). Satu panggilan mengembalikan semuanya. Web tidak menghitung apa pun sendiri.
- Kirim `base` berisi isian yang sama dengan permintaan hitung. Pakai pergeseran bawaan (-20%, -10%, +10%, +20%) dan kelima variabel.
- Tampilkan variabel sesuai urutan dari mesin (sudah diurutkan dari paling berpengaruh). Tiap baris: nama variabel dalam bahasa Indonesia, nilai dasar, lalu `npv_delta` untuk tiap pergeseran. Satuan dan mata uang selalu tertulis.
- Pergeseran bersifat relatif. Jelaskan di tampilan dengan satu kalimat pendek. Bila nilai dasar discount rate 0, deltanya memang 0, jadi beri catatan agar tidak tampak seperti error.
- Tampilkan juga IRR dan payback tiap kasus bila tidak terlalu ramai (boleh dalam baris yang dibuka). Status `irr_status` dan `payback_status` harus ditampilkan sebagai teks, bukan angka kosong.
- Galat dari endpoint ini memakai `code` seperti galat lain. Tambahkan terjemahan untuk `shift_out_of_range`, `shift_out_of_bounds`, `duplicate_variables`, dan `duplicate_shifts` di `errors-id.ts`.
- Letakkan pemanggilan di satu modul `lib/sensitivity.ts`. Panggil hanya setelah hasil utama ada, dan tangani mesin yang sedang bangun dengan pesan yang sama seperti halaman utama.
- Selesai bila: berfungsi di 375 px dan desktop, keadaan kosong, memuat, dan galat ada, dan tes untuk fungsi yang menyiapkan permintaan dan membaca respons lolos.

## Cara memeriksa pekerjaanmu
```bash
cd apps/web
npm ci
npm run typecheck
npm run build
```
Untuk uji manual, jalankan mesin di komputer (lihat `docs/api.md`) atau pakai alamat Render di atas, lalu set `NEXT_PUBLIC_API_URL` di `.env.local`.

## Kapan berhenti dan bertanya ke manager
Kontrak API tampak salah atau kurang, kamu perlu mengubah file di luar `apps/web/`, atau dua aturan di atas bertentangan.
