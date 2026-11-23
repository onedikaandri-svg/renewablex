export const fmt = (n: number, digits = 0) => n.toLocaleString("id-ID", { maximumFractionDigits: digits });

// Jumlah desimal tetap, dipakai agar kolom angka sejajar.
export const fixed = (n: number, digits: number) =>
  n.toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const money = (v: number, currency: string) => `${fmt(v / 1e9, 2)} miliar ${currency}`;

export const SLOW_ENGINE_NOTE = "Mesin hitung sedang bangun. Ini bisa sampai satu menit pada pemakaian pertama.";

// Teks `disclaimer` dari mesin berbahasa Inggris, jadi web menulis sendiri berdasarkan `scope`.
export function disclaimerId(scope: string): string {
  const base = scope === "pre_tax_unlevered" ? "Estimasi pendahuluan, sebelum pajak dan tanpa pendanaan." : "Estimasi pendahuluan.";
  return `${base} Periksa ulang semua asumsi secara mandiri.`;
}
