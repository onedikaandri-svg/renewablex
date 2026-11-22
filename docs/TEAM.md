# Tim dan Cara Kerja

Dokumen ini mengatur siapa mengerjakan apa di RenewableX, dan bagaimana pekerjaan masuk ke repo.

## Peran

| Peran | Siapa | Memutuskan |
|---|---|---|
| Product owner | Pemilik proyek (manusia) | Prioritas, arah produk, siapa penggunanya, tombol Merge |
| Lead engineer | Claude | Keputusan teknis, kontrak antarbagian, tinjauan semua perubahan |
| Web | One (AI) | Isi `apps/web/` |
| Data dan penyimpanan | kaakara (AI) | Isi `supabase/` dan `services/calculation-engine/app/providers/` |

## Wilayah

Setiap orang hanya mengubah wilayahnya sendiri. Butuh perubahan di wilayah lain? Tulis permintaan ke lead, jangan edit langsung.

| Wilayah | Pemilik |
|---|---|
| `services/calculation-engine/` (kecuali `app/providers/` dan `tests/providers/`), `docs/api.md`, `docs/calculation-methodology.md`, `examples/`, `.github/`, `docs/TEAM.md` | Lead |
| `apps/web/`, `DESIGN.md` (usulan perubahan lewat lead) | One |
| `supabase/`, `services/calculation-engine/app/providers/`, `services/calculation-engine/tests/providers/`, `docs/database-schema.md`, `docs/providers.md` | kaakara |

## Kontrak

Kontrak antarbagian adalah `docs/api.md` dan dua contoh di `examples/`. Hanya lead yang mengubahnya. Kalau kode dan kontrak berbeda, kontrak yang benar dan kodenya yang diperbaiki.

## Alur kerja

AI tidak mengakses repo langsung. Pemilik proyek menjadi penghubung:

1. Pemilik proyek memberi arahan tugas ke AI-nya.
2. AI mengembalikan file lengkap (bukan potongan) dan laporan dengan format di bawah.
3. Pemilik proyek mengunggah file ke GitHub di **cabang baru**. Di jendela commit pilih **Create a new branch for this commit and start a pull request**. Nama cabang: `one/nama-tugas` atau `kaakara/nama-tugas`.
4. Tes otomatis berjalan di Pull Request. Merah: bawa catatan kegagalan kembali ke AI pembuatnya. Hijau: bawa tautan Pull Request ke lead.
5. Lead meninjau. Bila disetujui, pemilik proyek menekan **Merge**.

Satu Pull Request berisi satu tugas. Jangan menggabungkan beberapa tugas.

## Aturan teknis

- Tes untuk setiap perubahan perilaku. Tes yang gagal tidak boleh dihapus atau dilemahkan agar lolos.
- Tidak ada angka, testimoni, atau klaim karangan di tampilan maupun dokumen. Isian contoh harus berlabel contoh.
- Rumus keuangan dan energi hanya ada di mesin hitung. Web dan data tidak menghitung ulang.
- Rahasia (kunci Supabase, kunci API) tidak pernah masuk repo. Hanya di pengaturan Render dan Vercel. `NEXT_PUBLIC_*` terlihat oleh semua orang, jadi bukan untuk rahasia.
- Jangan mengubah migrasi yang sudah ada. Perubahan database selalu lewat file migrasi baru.
- Tidak ada em dash dan en dash di teks yang ditulis. Pakai titik, koma, titik dua, atau kurung.
- Tambah dependensi baru hanya bila perlu, dan sebutkan alasannya di laporan.
- Tidak yakin pada fakta luar (dokumentasi API pihak ketiga, versi pustaka)? Baca sumber resminya dan catat tautan serta tanggalnya. Jangan menebak.

## Format laporan hasil kerja

1. **Tugas:** kode tugas dan judulnya.
2. **Yang berubah:** daftar file dan satu kalimat per file.
3. **Cara menguji:** perintah yang dijalankan dan hasilnya. Tulis apa adanya bila sesuatu tidak sempat diuji.
4. **Belum selesai atau diragukan:** apa yang tidak dikerjakan dan alasannya.
5. **Pertanyaan untuk lead:** hanya yang benar-benar menghalangi.

## Rencana lead (wilayah mesin hitung)

| Kode | Tugas | Bergantung pada |
|---|---|---|
| L1 | Kode galat yang bisa dibaca mesin (`code`) pada respons 422, supaya web tidak mengurai teks | tidak ada |
| L2 | Endpoint sensitivitas `/v1/pv/sensitivity` yang menggantikan banyak panggilan dari web | W3 selesai |
| L3 | Menyambungkan penyedia data lokasi ke `/v1/pv/preliminary` (mode `location_based`) | D2 disetujui |
| L4 | Perlindungan cabang `main` dan langkah `npm test` di CI | W1 |

## Definisi selesai

Tes otomatis hijau, laporan lengkap, wilayah orang lain tidak tersentuh, dan lead sudah menyetujui.
