# Aturan pemilihan skill (superpowers vs anti-slop)

Proyek: RenewableX (engine kalkulasi Python/FastAPI + frontend Next.js).
Dua paket skill terpasang: **superpowers** (cara kerja) dan **anti-slop** (kualitas hasil).
Pilih skill berdasarkan jenis tugas. Jangan memuat semua skill untuk setiap tugas.

## Prinsip dasar
- superpowers mengatur PROSES: rencana, tes dulu, debugging, review.
- anti-slop memfilter HASIL: UI, teks, komentar.
- Kalau tugas menyentuh keduanya, jalankan superpowers dulu, anti-slop terakhir (sebagai tahap finishing).
- Kalau tidak yakin, mulai dengan superpowers saja.

## A. Engine kalkulasi (`services/calculation-engine/`)
Kalau tugas menyentuh rumus, NPV, IRR, payback, yield PV, model data, atau API FastAPI:
- GUNAKAN: superpowers
  - test-driven-development: tulis tes yang gagal dulu, termasuk edge case dan sample project.
  - systematic-debugging: kalau hasil tidak cocok dengan `examples/sample-pv-response.json`.
  - requesting-code-review: cek kesesuaian dengan `docs/calculation-methodology.md`.
- JANGAN gunakan: anti-slop UI atau copywriting.
- Anti-slop code (komentar) hanya boleh dipakai setelah tes lulus, dan:
  - JANGAN hapus komentar yang merujuk metodologi, sumber rumus, atau satuan.
  - Tinjau diff-nya sebelum commit.
- Aturan wajib: perubahan rumus harus disertai referensi metodologi dan tes. Hasil numerik harus deterministik; AI tidak menghitung atau menimpa hasil.

## B. Perencanaan dan fitur baru (lintas area)
Kalau tugas berupa fitur baru, perubahan arsitektur, atau permintaan yang masih kabur:
- GUNAKAN: superpowers (brainstorming, lalu writing-plans, lalu eksekusi bertahap).
- JANGAN gunakan anti-slop pada tahap ini.

## C. Frontend (`apps/web/`)
Kalau tugas membuat atau mengubah halaman, komponen, dashboard, atau grafik:
- GUNAKAN: anti-slop core + antislop-ui.
- Kalau ada pemilihan warna pada grafik atau teks kecil: tambahkan antislop-human (cek kontras).
- Kalau ada logika baru (hook, format tampilan, pemanggilan API): jalankan superpowers test-driven-development untuk logikanya, lalu anti-slop untuk tampilannya.
- Sesuai AGENTS.md bagian 3 dan 9.2: rumus energi dan keuangan hanya dihitung di backend. Frontend hanya menampilkan data dari mesin, melakukan format angka, pemilihan satuan, dan penyederhanaan titik grafik.
- Aturan produk: tampilkan apakah nilai berasal dari input pengguna, default, atau sumber eksternal. Jangan menyebut hasil awal sebagai bankable atau dijamin.

## D. Teks dan dokumentasi
Kalau tugas menulis teks antarmuka, `docs/user-guide.md`, README, pesan error, atau draf laporan:
- GUNAKAN: antislop-copywriting.
- Hindari klaim kosong, angka karangan, dan bahasa promosi ("masa depan hijau", "revolusioner", dan sejenisnya).
- Untuk dokumen metodologi atau teknis (`calculation-methodology.md`, `database-schema.md`): jangan pakai antislop-copywriting yang menyederhanakan istilah teknis. Pertahankan presisi dan satuan.

## E. Debugging dan bug
Kalau tugasnya memperbaiki bug atau tes yang gagal:
- GUNAKAN: superpowers systematic-debugging, apa pun areanya.
- Tulis tes yang mereproduksi bug sebelum memperbaikinya.
- Jangan jalankan anti-slop sampai bug selesai.

## F. Review dan finishing sebelum merge
Kalau tugasnya merapikan atau menyiapkan merge:
1. superpowers: code review (kesesuaian spesifikasi, lalu kualitas kode).
2. anti-slop: hanya untuk file UI dan teks yang berubah, bukan seluruh repo.
3. Pastikan semua tes lulus sebelum dan sesudah tahap anti-slop.

## G. Kalau aturan bentrok
- Ketepatan numerik dan metodologi menang atas gaya dan keringkasan.
- Komentar yang menjelaskan alasan rumus menang atas aturan "kurangi komentar".
- Jangan menambah dokumen rencana untuk tugas kecil (satu file, kurang dari ~30 baris perubahan): langsung kerjakan dengan TDD bila itu logika.
- Batasi satu paket dominan per tugas. Jangan menjalankan skill dari kedua paket secara bersamaan pada langkah yang sama.

## Ringkasan cepat
| Tugas | Pakai | Hindari |
|---|---|---|
| Rumus / engine / API | superpowers (TDD, review) | anti-slop UI & copy |
| Fitur baru / rencana | superpowers (brainstorming, plan) | anti-slop |
| Halaman / komponen / grafik | anti-slop UI (+ human) | - |
| Teks UI / user guide | antislop-copywriting | untuk dokumen teknis |
| Bug | superpowers (debugging) | anti-slop sampai selesai |
| Sebelum merge | superpowers review, lalu anti-slop pada file UI/teks | anti-slop di seluruh repo |
