// Satu tabel terjemahan untuk galat validasi mesin hitung (FastAPI, HTTP 422).
// Bentuk item galat: https://docs.pydantic.dev/latest/errors/validation_errors/

export interface ApiIssue {
  type: string;
  loc: (string | number)[];
  msg: string;
  ctx?: Record<string, unknown>;
}

export interface TranslateOptions {
  // Isian ditampilkan dalam persen, tetapi mesin menghitung dalam pecahan (0,1 = 10%).
  percent?: boolean;
}

const numberFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 6 });

// Pydantic menyerialkan batas sebagai angka JSON, atau string bila berupa Decimal.
function formatLimit(value: unknown, percent: boolean): string | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return percent ? `${numberFormat.format(n * 100)}%` : numberFormat.format(n);
}

const BOUNDS: Record<string, { key: string; text: (limit: string) => string }> = {
  greater_than: { key: "gt", text: (l) => `Harus lebih besar dari ${l}.` },
  greater_than_equal: { key: "ge", text: (l) => `Tidak boleh kurang dari ${l}.` },
  less_than: { key: "lt", text: (l) => `Harus lebih kecil dari ${l}.` },
  less_than_equal: { key: "le", text: (l) => `Tidak boleh lebih dari ${l}.` },
};

const FIXED: Record<string, string> = {
  missing: "Wajib diisi.",
  int_parsing: "Harus berupa bilangan bulat.",
  float_parsing: "Harus berupa angka.",
  int_from_float: "Harus berupa bilangan bulat tanpa pecahan.",
};

const LENGTHS: Record<string, { key: string; text: (n: string) => string }> = {
  string_too_short: { key: "min_length", text: (n) => `Minimal ${n} karakter.` },
  string_too_long: { key: "max_length", text: (n) => `Maksimal ${n} karakter.` },
};

// Pesan kustom mesin (model_validator di schemas.py dan pv.py). Dicocokkan lewat potongan teks
// huruf kecil, sampai L1 menambahkan `code` yang bisa dibaca mesin. Aturan pertama yang cocok dipakai.
const CUSTOM_MESSAGES: ReadonlyArray<{ fragment: string; text: string }> = [
  {
    fragment: "location_based needs a configured resource provider",
    text: "Mode berbasis lokasi (location_based) belum tersedia. Isi yield spesifik secara manual.",
  },
  {
    fragment: "is required for manual_specific_yield",
    text: "Yield spesifik wajib diisi untuk metode yield manual.",
  },
  {
    fragment: "losses count twice",
    text: "Yield bersih sudah memperhitungkan loss, jadi performance loss harus 0 agar loss tidak terhitung dua kali.",
  },
  {
    fragment: "only fixed_tariff is supported",
    text: "Saat ini hanya pendapatan dengan tarif tetap (fixed_tariff) yang didukung.",
  },
  {
    fragment: "result is not a finite number",
    text: "Hasil perhitungan bukan angka yang terhingga. Periksa lagi nilai yang sangat ekstrem.",
  },
];

function matchCustom(msg: string): string | null {
  const lowered = msg.toLowerCase();
  return CUSTOM_MESSAGES.find((m) => lowered.includes(m.fragment))?.text ?? null;
}

function translatePattern(pattern: unknown): string {
  if (typeof pattern !== "string") return "Format tidak sesuai.";
  const letters = /^\^\[A-Z\]\{(\d+)\}\$$/.exec(pattern);
  if (letters) return `Harus ${letters[1]} huruf kapital (A sampai Z).`;
  return `Format tidak sesuai pola ${pattern}.`;
}

function translateLiteral(expected: unknown): string {
  if (typeof expected !== "string") return "Nilai tidak termasuk pilihan yang tersedia.";
  // Contoh dari Pydantic: "'a', 'b' or 'c'"
  const options = expected.replace(/'/g, "").replace(/\s+or\s+/, ", ");
  return `Harus salah satu dari: ${options}.`;
}

// Mengembalikan alasan tanpa nama isian, karena nama isian dipasang oleh pemanggil.
// Teks atau tipe yang tidak dikenal dikembalikan apa adanya.
export function translateIssue(issue: ApiIssue, options: TranslateOptions = {}): string {
  const ctx = issue.ctx ?? {};
  const percent = options.percent ?? false;

  const bound = BOUNDS[issue.type];
  if (bound) {
    const limit = formatLimit(ctx[bound.key], percent);
    return limit === null ? issue.msg : bound.text(limit);
  }

  const length = LENGTHS[issue.type];
  if (length) {
    const n = formatLimit(ctx[length.key], false);
    return n === null ? issue.msg : length.text(n);
  }

  if (issue.type in FIXED) return FIXED[issue.type];
  if (issue.type === "string_pattern_mismatch") return translatePattern(ctx.pattern);
  if (issue.type === "literal_error") return translateLiteral(ctx.expected);
  if (issue.type === "value_error") return matchCustom(issue.msg) ?? issue.msg;
  return issue.msg;
}

// Untuk `detail` berupa teks biasa (HTTPException dari mesin, bukan galat validasi).
export function translateDetailText(text: string): string {
  return matchCustom(text) ?? text;
}

export function isApiIssue(value: unknown): value is ApiIssue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === "string" && typeof v.msg === "string" && Array.isArray(v.loc);
}
