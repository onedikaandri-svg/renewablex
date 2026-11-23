# Serah Terima: Mesin Hitung

Dokumen ini menjelaskan keadaan mesin hitung RenewableX saat dipindahkan dari manager ke Val, beserta keputusan yang sudah diambil dan alasannya. Jangan membalik keputusan di bawah tanpa mengajukannya ke manager.

## Keadaan saat ini
- Mesin: versi 0.3.0, metodologi 0.3.0. Pastikan Pull Request L2 (`lead/l2-sensitivitas`) sudah digabung ke `main` sebelum mulai bekerja. Cek `https://renewablex.onrender.com/health`: harus menampilkan `"engine_version":"0.3.0"`.
- Endpoint: `GET /health`, `POST /v1/pv/preliminary`, `POST /v1/pv/sensitivity`. Kontrak: `docs/api.md`. Contoh: `examples/`.
- Struktur kode di `services/calculation-engine/`:
  - `app/main.py`: aplikasi, CORS (`ALLOWED_ORIGINS`), penangan galat validasi yang menambahkan `code`.
  - `app/api/pv.py`, `app/api/sensitivity.py`: endpoint.
  - `app/models/schemas.py`: model permintaan dan respons. **Sumber kebenaran bagi `docs/api.md`.**
  - `app/services/energy.py`, `finance.py`, `calculate.py`: rumus dan orkestrasinya.
  - `app/errors.py`: `EngineError` dengan `code`.
  - `tests/`: 82 tes (`test_energy`, `test_finance`, `test_api`, `test_cors`, `test_sensitivity`).

## Keputusan yang sudah diambil
1. **Cakupan:** sebelum pajak dan tanpa pendanaan (`tax_model` hanya `pre_tax`).
2. **Degradasi dan eskalasi** mulai tahun 2. Tahun 1 memakai nilai dasar.
3. **Loss kinerja dihitung sekali.** Yield `gross_pre_loss` dikurangi loss. Yield `net_ac_at_delivery` dengan loss lebih dari 0 ditolak (hitung ganda).
4. **IRR** dicari dengan bisection di rentang -99% sampai 10.000%, dan mengembalikan status (`ok`, `no_sign_change`, `ambiguous`, `not_found`), tidak pernah `nan`. `numpy_financial` hanya dipakai di tes sebagai pembanding.
5. **Pembulatan hanya di keluaran.** Payback memakai arus kas kumulatif yang tidak dibulatkan.
6. **Skema ketat:** field yang tidak dikenal ditolak (`extra="forbid"`).
7. **Galat 422** memuat `code` yang stabil. Klien bercabang pada `code`, bukan pada `msg`. Input pengguna tidak dikembalikan dalam galat.
8. **Sensitivitas:** satu variabel dalam satu waktu, pergeseran relatif, tiap kasus adalah hitungan penuh yang sama dengan `/preliminary`.
9. **Versi:** versi mesin naik minor untuk penambahan endpoint atau field, versi metodologi naik bila rumus atau definisi berubah.
10. **Kontrak:** `docs/api.md` dan `examples/` mengikuti kode. Bila berbeda, dokumen yang diperbaiki.
11. **`httpx` tetap di `requirements.txt` produksi**, karena adapter penyedia data lokasi (kaakara) memakainya.
12. **`/docs` dan `/openapi.json` tetap terbuka** untuk saat ini. Ditinjau ulang bila ada akun pengguna.
13. **Peringatan bisa dibaca mesin:** `warning_codes` akan ditambahkan di V2b. `disclaimer` tidak diberi kode, web menulis teks Indonesianya sendiri.

## Pemasangan (sudah berjalan)
- **Render:** layanan `renewablex`, paket gratis, Root Directory `services/calculation-engine`, Build Command `pip install -r requirements.txt`, Start Command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Variabel `ALLOWED_ORIGINS` berisi alamat Vercel dan `http://localhost:3000`, dipisah koma, tanpa garis miring di akhir.
- **Vercel:** proyek `renewablex`, Root Directory `apps/web`, variabel `NEXT_PUBLIC_API_URL=https://renewablex.onrender.com`.
- Instans gratis Render tidur bila tidak dipakai. Permintaan pertama setelahnya bisa lambat sampai sekitar satu menit.
- Perubahan pengaturan Render atau Vercel dilakukan oleh pemilik proyek. Minta lewat manager.

## Keterbatasan yang diketahui
- `location_based` dan `self_consumption_savings` mengembalikan 422.
- Belum ada payback terdiskonto dan IRR ekuitas.
- `requirements.txt` memasang pustaka tes juga di produksi. Versi Python di Render belum dikunci.
- Belum ada pembatasan ukuran permintaan, pembatasan laju, atau log permintaan.
- Teks `msg` galat berbahasa Inggris (web menerjemahkannya).

## Hal yang dijaga
- Tes tidak boleh dilemahkan agar lolos.
- Tidak ada angka karangan di contoh atau dokumen. Nilai contoh selalu berlabel ilustratif.
- Perubahan kontrak mempengaruhi One dan kaakara. Ikuti aturan di `docs/briefs/val-engine.md`.
