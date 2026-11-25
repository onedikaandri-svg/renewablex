export const fmt = (n: number, digits = 0) => n.toLocaleString("id-ID", { maximumFractionDigits: digits });

// Jumlah desimal tetap, dipakai agar kolom angka sejajar.
export const fixed = (n: number, digits: number) =>
  n.toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const money = (v: number, currency: string) => `${fmt(v / 1e9, 2)} miliar ${currency}`;

// Pesan saat server Render sedang bangun dari mode tidur (free tier).
export const SLOW_ENGINE_NOTE = "Server gratis ini butuh waktu hingga 50 detik untuk bangun dari mode tidur. Mohon tunggu dan jangan tutup halaman ini.";

// Teks `disclaimer` dari mesin berbahasa Inggris, jadi web menulis sendiri berdasarkan `scope`.
export function disclaimerId(scope: string): string {
  const base = scope === "pre_tax_unlevered" ? "Estimasi pendahuluan, sebelum pajak dan tanpa pendanaan." : "Estimasi pendahuluan.";
  return `${base} Periksa ulang semua asumsi secara mandiri.`;
}
