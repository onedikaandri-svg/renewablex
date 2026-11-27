import type { LangCode } from "@/lib/preferences";

export const fmt = (n: number, digits = 0) => n.toLocaleString("id-ID", { maximumFractionDigits: digits });

// Jumlah desimal tetap, dipakai agar kolom angka sejajar.
export const fixed = (n: number, digits: number) =>
  n.toLocaleString("id-ID", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const money = (v: number, currency: string) => `${fmt(v / 1e9, 2)} miliar ${currency}`;

// Pesan saat server Render sedang bangun dari mode tidur (free tier).
export const SLOW_ENGINE_NOTE = "Server gratis ini butuh waktu sekitar 30 sampai 50 detik buat bangun dari mode tidur. Tunggu sebentar ya, jangan tutup halaman ini.";

export function slowEngineNoteFor(lang: LangCode): string {
  if (lang === "id") {
    return "Server gratis ini butuh waktu sekitar 30 sampai 50 detik buat bangun dari mode tidur. Tunggu sebentar ya, jangan tutup halaman ini.";
  }
  if (lang === "ja") {
    return "無料サーバーがスリープ状態から起動するまで最大50秒ほどかかります。このページを閉じずにそのままお待ちください。";
  }
  return "The free compute server takes up to 50 seconds to wake up from sleep mode. Please wait and keep this tab open.";
}

// Teks `disclaimer` dari mesin berbahasa Inggris, jadi web menulis sendiri berdasarkan `scope`.
export function disclaimerId(scope: string): string {
  const base = scope === "pre_tax_unlevered" ? "Estimasi pendahuluan, sebelum pajak dan tanpa pendanaan." : "Estimasi pendahuluan.";
  return `${base} Periksa ulang semua asumsi secara mandiri.`;
}

export function localeFor(lang: LangCode): string {
  if (lang === "en") return "en-US";
  if (lang === "ja") return "ja-JP";
  return "id-ID";
}

export function formatNumber(n: number, lang: LangCode = "id", digits = 0): string {
  return n.toLocaleString(localeFor(lang), { maximumFractionDigits: digits });
}

export function formatFixed(n: number, lang: LangCode = "id", digits = 2): string {
  return n.toLocaleString(localeFor(lang), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPercent(fraction: number, lang: LangCode = "id", digits = 1): string {
  return `${formatNumber(fraction * 100, lang, digits)}%`;
}

export function formatCurrency(value: number, currency: string, lang: LangCode = "id", digits = 0): string {
  const prefix = currency === "IDR" ? "Rp " : `${currency} `;
  const sign = value < 0 ? "-" : "";
  return `${sign}${prefix}${formatNumber(Math.abs(value), lang, digits)}`;
}

export function formatCompactCurrency(value: number, currency: string, lang: LangCode = "id"): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  const prefix = currency === "IDR" ? "Rp " : `${currency} `;
  if (currency === "IDR") {
    if (abs >= 1e12) return `${sign}${prefix}${formatNumber(abs / 1e12, lang, 2)} T`;
    if (abs >= 1e9) return `${sign}${prefix}${formatNumber(abs / 1e9, lang, 2)} M`;
    if (abs >= 1e6) return `${sign}${prefix}${formatNumber(abs / 1e6, lang, 1)} jt`;
  } else {
    if (abs >= 1e9) return `${sign}${prefix}${formatNumber(abs / 1e9, lang, 2)}B`;
    if (abs >= 1e6) return `${sign}${prefix}${formatNumber(abs / 1e6, lang, 2)}M`;
    if (abs >= 1e3) return `${sign}${prefix}${formatNumber(abs / 1e3, lang, 1)}K`;
  }
  return formatCurrency(value, currency, lang, 0);
}

export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
