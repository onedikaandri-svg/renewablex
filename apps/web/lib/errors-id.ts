// Satu tabel terjemahan untuk galat validasi mesin hitung (FastAPI, HTTP 422).
// Bentuk item galat: https://docs.pydantic.dev/latest/errors/validation_errors/

export interface ApiIssue {
  type: string;
  code?: string;
  loc: (string | number)[];
  msg: string;
  ctx?: Record<string, unknown>;
}

export interface TranslateOptions {
  percent?: boolean;
}

const numberFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 6 });

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

const CODE_MESSAGES: Record<string, string> = {
  location_based_unavailable: "Mode berbasis lokasi (location_based) belum tersedia. Isi yield spesifik secara manual.",
  yield_required: "Yield spesifik wajib diisi untuk metode yield manual.",
  double_counted_loss:
    "Yield bersih sudah memperhitungkan loss, jadi performance loss harus 0 agar loss tidak terhitung dua kali.",
  unsupported_revenue_method: "Saat ini hanya pendapatan dengan tarif tetap (fixed_tariff) yang didukung.",
  non_finite_result: "Hasil perhitungan bukan angka yang terhingga. Periksa lagi nilai yang sangat ekstrem.",
  shift_out_of_range:
    "Sensitivitas tidak bisa dihitung: salah satu pergeseran membuat sebuah asumsi melewati batas yang diizinkan mesin. Biasanya nilai asumsi Anda sudah dekat batasnya, misalnya yield spesifik atau discount rate.",
  shift_out_of_bounds: "Pergeseran harus berada antara -90% dan +100%, dan tidak boleh 0%.",
  duplicate_variables: "Daftar asumsi yang digeser tidak boleh berulang.",
  duplicate_shifts: "Daftar pergeseran tidak boleh berulang.",
  // Kode untuk lokasi
  location_required: "Lintang dan bujur wajib diisi jika memilih metode berbasis lokasi.",
  resource_source_unavailable: "Sumber data satelit yang dipilih belum tersedia. Gunakan PVGIS.",
  out_of_coverage: "Lokasi yang Anda masukkan berada di luar cakupan data satelit (misalnya di tengah laut).",
  provider_unavailable: "Layanan satelit sedang tidak dapat dihubungi. Coba beberapa saat lagi.",
  provider_timeout: "Permintaan ke layanan satelit melebihi batas waktu. Coba lagi.",
  provider_invalid_response: "Layanan satelit mengembalikan data yang tidak dapat dibaca.",
  provider_error: "Terjadi kesalahan saat mengambil data satelit.",
  // Kode untuk pendapatan
  tariff_required: "Tarif jual wajib diisi untuk metode tarif tetap.",
  consumption_required: "Kebutuhan listrik tahunan wajib diisi untuk mode konsumsi sendiri.",
  self_consumption_tariff_required: "Tarif listrik yang dihemat wajib diisi.",
  feed_in_tariff_required: "Tarif jual kelebihan listrik ke grid wajib diisi.",
  // Kode untuk sistem hybrid (Tahap 5)
  invalid_load_length: "Jumlah baris data beban harus 8.760 langkah (1 tahun per jam).",
  negative_load_value: "Nilai beban tidak boleh negatif.",
  non_finite_load_value: "Data beban mengandung nilai kosong, NaN, atau tidak terhingga.",
  invalid_csv_format: "Format berkas CSV beban tidak sesuai. Pastikan berisi 1 kolom nilai atau 2 kolom (waktu, load_kw).",
  invalid_load_parameters: "Parameter pembangkit beban sintetis tidak valid. Pastikan beban puncak lebih besar atau sama dengan beban dasar.",
  load_csv_required: "Unggah atau tempel isi berkas CSV beban terlebih dahulu.",
  unsupported_load_mode: "Mode profil beban tidak dikenal.",
  invalid_latitude: "Lintang (latitude) harus berada di rentang -90 sampai 90 derajat.",
  invalid_longitude: "Bujur (longitude) harus berada di rentang -180 sampai 180 derajat.",
  invalid_timezone: "Zona waktu proyek tidak valid.",
  unsupported_weather_source: "Sumber data cuaca tidak didukung.",
  invalid_weather_json: "Struktur data cuaca kustom tidak valid.",
  invalid_pv_config: "Konfigurasi komponen PV tidak valid. Periksa kapasitas, inverter, dan batas rugi.",
  invalid_bess_config: "Konfigurasi baterai BESS tidak valid. Periksa kapasitas, daya charge/discharge, dan batas SOC.",
  invalid_biomass_config: "Konfigurasi pembangkit biomass tidak valid. Periksa kapasitas, kurva bahan bakar, dan parameter pasokan.",
  invalid_dispatch_config: "Konfigurasi strategi dispatch EMS tidak valid. Periksa jam puncak atau batas beban puncak.",
  invalid_finance_config: "Parameter keuangan tidak valid. Periksa tingkat diskonto, eskalasi, CAPEX, dan tarif.",
  invalid_lifetime_config: "Umur proyek harus antara 1 sampai 40 tahun dan mode multi-tahun harus valid.",
  job_not_found: "Job simulasi tidak ditemukan atau sudah kedaluwarsa di memori server.",
  job_capacity_exceeded: "Antrean simulasi server sedang penuh. Tunggu sebentar lalu coba lagi.",
  request_too_large: "Ukuran data permintaan melebihi batas yang diizinkan server.",
};

const WARNING_MESSAGES: Record<string, string> = {
  high_specific_yield: "Yield spesifik di atas 2.500 kWh/kWp/tahun tidak biasa. Periksa sumber data dan batas yield.",
  high_degradation: "Degradasi di atas 2% per tahun tidak biasa untuk modul PV.",
  high_performance_loss: "Loss kinerja di atas 35% tidak biasa. Periksa agar tidak terhitung dua kali.",
  resource_data_fetched: "Data radiasi matahari berhasil diambil dari satelit. Hasil yield dihitung berdasarkan data ini.",
  unmet_load_present: "Sebagian beban listrik belum terpenuhi pada konfigurasi sistem saat ini.",
  scaled_multi_year_mode: "Simulasi multi-tahun memakai mode cepat scaled_year_1 (mengukur penuh Tahun 1 lalu menskalakan degradasi).",
};

const FRAGMENT_CODES: ReadonlyArray<{ fragment: string; code: string }> = [
  { fragment: "location_based needs a configured resource provider", code: "location_based_unavailable" },
  { fragment: "is required for manual_specific_yield", code: "yield_required" },
  { fragment: "losses count twice", code: "double_counted_loss" },
  { fragment: "only fixed_tariff is supported", code: "unsupported_revenue_method" },
  { fragment: "result is not a finite number", code: "non_finite_result" },
  { fragment: "specific yield above 2,500", code: "high_specific_yield" },
  { fragment: "degradation above 2%", code: "high_degradation" },
  { fragment: "performance loss above 35%", code: "high_performance_loss" },
];

function matchFragment(msg: string): string | null {
  const lowered = msg.toLowerCase();
  const hit = FRAGMENT_CODES.find((f) => lowered.includes(f.fragment));
  return hit ? (CODE_MESSAGES[hit.code] || WARNING_MESSAGES[hit.code]) : null;
}

function translatePattern(pattern: unknown): string {
  if (typeof pattern !== "string") return "Format tidak sesuai.";
  const letters = /^\^\[A-Z\]\{(\d+)\}\$$/.exec(pattern);
  if (letters) return `Harus ${letters[1]} huruf kapital (A sampai Z).`;
  return `Format tidak sesuai pola ${pattern}.`;
}

function translateLiteral(expected: unknown): string {
  if (typeof expected !== "string") return "Nilai tidak termasuk pilihan yang tersedia.";
  const options = expected.replace(/'/g, "").replace(/\s+or\s+/, ", ");
  return `Harus salah satu dari: ${options}.`;
}

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

export function translateDetailText(text: string): string {
  return matchFragment(text) ?? text;
}

export function translateWarning(code: string): string {
  return WARNING_MESSAGES[code] ?? code;
}

export function isApiIssue(value: unknown): value is ApiIssue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === "string" && typeof v.msg === "string" && Array.isArray(v.loc);
}
