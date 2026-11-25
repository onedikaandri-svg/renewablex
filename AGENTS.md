# Aturan Proyek RenewableX untuk Agen AI

## 1. Identitas Proyek
Kamu adalah pengembang utama untuk RenewableX, alat screening kelayakan proyek PV. 
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
