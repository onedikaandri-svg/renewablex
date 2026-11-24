// Satu tabel terjemahan untuk galat validasi mesin hitung (FastAPI, HTTP 422).
// Bentuk item galat: https://docs.pydantic.dev/latest/errors/validation_errors/

export interface ApiIssue {
  type: string;
  // Kode stabil dari mesin (docs/api.md). Kode bawaan sama dengan `type`. Item lama tidak punya.
  code?: string;
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

// Terjemahan untuk kode buatan mesin (lihat tabel kode di docs/api.md).
const CODE_MESSAGES: Record<string, string> = {
  location_based_unavailable: "Mode berbasis lokasi (location_based) belum tersedia. Isi yield spesifik secara manual.",
  yield_required: "Yield spesifik wajib diisi untuk metode yield manual.",
  double_counted_loss:
    "Yield bersih sudah memperhitungkan loss, jadi performance loss harus 0 agar loss tidak terhitung dua kali.",
  unsupported_revenue_method: "Saat ini hanya pendapatan dengan tarif tetap (fixed_tariff) yang didukung.",
  non_finite_result: "Hasil perhitungan bukan angka yang terhingga. Periksa lagi nilai yang sangat ekstrem.",
};

// Cadangan untuk item tanpa `code` (mesin lama): potongan teks huruf kecil menunjuk ke kode.
// Aturan pertama yang cocok dipakai. Item yang punya `code` tidak pernah lewat sini.
const FRAGMENT_CODES: ReadonlyArray<{ fragment: string; code: string }> = [
  { fragment: "location_based needs a configured resource provider", code: "location_based_unavailable" },
  { fragment: "is required for manual_specific_yield", code: "yield_required" },
  { fragment: "losses count twice", code: "double_counted_loss" },
  { fragment: "only fixed_tariff is supported", code: "unsupported_revenue_method" },
  { fragment: "result is not a finite number", code: "non_finite_result" },
];

function matchFragment(msg: string): string | null {
  const lowered = msg.toLowerCase();
  const hit = FRAGMENT_CODES.find((f) => lowered.includes(f.fragment));
  return hit ? CODE_MESSAGES[hit.code] : null;
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
// Pencocokan lewat `code` (bila tidak ada, `type`). Teks atau kode yang tidak dikenal
// dikembalikan apa adanya.
export function translateIssue(issue: ApiIssue, options: TranslateOptions = {}): string {
  const ctx = issue.ctx ?? {};
  const percent = options.percent ?? false;
  const key = issue.code ?? issue.type;

  const bound = BOUNDS[key];
  if (bound) {
    const limit = formatLimit(ctx[bound.key], percent);
    return limit === null ? issue.msg : bound.text(limit);
  }

  const length = LENGTHS[key];
  if (length) {
    const n = formatLimit(ctx[length.key], false);
    return n === null ? issue.msg : length.text(n);
  }

  if (key in FIXED) return FIXED[key];
  if (key === "string_pattern_mismatch") return translatePattern(ctx.pattern);
  if (key === "literal_error") return translateLiteral(ctx.expected);
  if (key in CODE_MESSAGES) return CODE_MESSAGES[key];
  if (issue.code === undefined && issue.type === "value_error") return matchFragment(issue.msg) ?? issue.msg;
  return issue.msg;
}

// Untuk `detail` berupa teks biasa (HTTPException dari mesin, bukan galat validasi).
export function translateDetailText(text: string): string {
  return matchFragment(text) ?? text;
}

export function isApiIssue(value: unknown): value is ApiIssue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === "string" && typeof v.msg === "string" && Array.isArray(v.loc);
}
