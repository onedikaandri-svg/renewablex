import { API_URL, ApiError, NetworkError, parseProblems, type IrrStatus, type Problems } from "@/lib/api";
import { byVisualOrder, labelOf } from "@/lib/form";
import { disclaimerId, fixed, fmt, money } from "@/lib/format";

// Seluruh pemanggilan POST /v1/pv/sensitivity ada di modul ini. Bentuk respons: docs/api.md, bagian Sensitivity.

export interface SensitivitySummary {
  npv_amount: number;
  project_irr_fraction: number | null;
  irr_status: IrrStatus;
  simple_payback_years: number | null;
  payback_status: "recovered" | "not_recovered";
}

export interface SensitivityCase extends SensitivitySummary {
  shift_fraction: number;
  input_value: number;
  npv_delta: number;
}

export interface SensitivityVariable {
  variable: string;
  field: string;
  base_value: number;
  max_abs_npv_delta: number;
  cases: SensitivityCase[];
}

export interface SensitivityResponse {
  engine_version: string;
  methodology_version: string;
  calculated_at: string;
  scope: string;
  currency_code: string;
  base: SensitivitySummary;
  variables: SensitivityVariable[];
  disclaimer: string;
}

// Pergeseran dan variabel memakai nilai bawaan mesin, jadi hanya `base` yang dikirim.
export function buildSensitivityRequest(base: unknown) {
  return { base };
}

export async function runSensitivity(base: unknown, signal?: AbortSignal): Promise<SensitivityResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/pv/sensitivity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSensitivityRequest(base)),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new NetworkError(`Tidak bisa terhubung ke mesin hitung di ${API_URL}.`);
  }
  // Galat `base` berawalan ["body", "base", ...], jadi dua entri pertama dibuang.
  if (res.status === 422) throw new ApiError(parseProblems((await res.json()).detail, 2));
  if (!res.ok) throw new NetworkError(`Mesin hitung mengembalikan error (HTTP ${res.status}).`);
  return res.json();
}

export function problemMessages(p: Problems): string[] {
  const keys = byVisualOrder(Object.keys(p.fields));
  return [...keys.map((k) => `${labelOf(k)}: ${p.fields[k]}`), ...p.general];
}

// Tampilan: hanya pemformatan dan teks. Semua angka berasal dari respons mesin.

const amount = (v: number) =>
  Math.abs(v) >= 1e9 ? `${fmt(v / 1e9, 2)} miliar` : Math.abs(v) >= 1e6 ? `${fmt(v / 1e6, 1)} juta` : fmt(v, 2);

// Nilai asumsi dengan satuannya. Pembulatan di sini menghilangkan sisa floating point (13200000000.000002).
export function formatInput(variable: string, v: number, currency: string): string {
  switch (variable) {
    case "specific_yield": return `${fmt(v, 2)} kWh/kWp/tahun`;
    case "tariff": return `${fmt(v, 2)} ${currency} per kWh`;
    case "capex": return `${amount(v)} ${currency}`;
    case "opex": return `${amount(v)} ${currency} per tahun`;
    case "discount_rate": return `${fmt(v * 100, 2)}% per tahun`;
    default: return fmt(v, 2);
  }
}

export function shiftLabel(fraction: number): string {
  return `${fraction > 0 ? "+" : "-"}${fmt(Math.abs(fraction) * 100, 2)}%`;
}

// Selisih bertanda. Nilai yang dibulatkan menjadi 0 ditulis tanpa tanda.
export function signed(v: number, digits: number): string {
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return r === 0 ? fixed(0, digits) : `${r > 0 ? "+" : ""}${fixed(r, digits)}`;
}

const IRR_UNAVAILABLE: Record<string, string> = {
  no_sign_change: "Tidak tersedia: arus kas tidak berganti tanda",
  ambiguous: "Tidak tersedia: tanda arus kas berganti lebih dari sekali",
  not_found: "Tidak tersedia: tidak ditemukan pada rentang -99% sampai 10.000%",
};

export function irrText(c: SensitivitySummary): string {
  if (c.irr_status === "ok" && c.project_irr_fraction !== null) return `${fmt(c.project_irr_fraction * 100, 2)}%`;
  return IRR_UNAVAILABLE[c.irr_status] ?? "Tidak tersedia";
}

export function paybackText(c: SensitivitySummary): string {
  if (c.payback_status === "recovered" && c.simple_payback_years !== null) return `${fmt(c.simple_payback_years, 1)} tahun`;
  return "Belum kembali dalam umur proyek";
}

export interface SensitivityRow {
  variable: string;
  label: string;
  baseValue: string;
  deltas: string[];
}

export interface DetailRow {
  key: string;
  label: string;
  shift: string;
  input: string;
  npv: string;
  irr: string;
  payback: string;
}

export interface SensitivityView {
  currency: string;
  unit: "miliar" | "juta";
  shifts: string[];
  rows: SensitivityRow[];
  zeroBaseLabels: string[];
  details: DetailRow[];
  disclaimer: string;
  provenance: string;
}

export function buildSensitivityView(res: SensitivityResponse): SensitivityView {
  const c = res.currency_code;
  const maxAbs = Math.max(0, ...res.variables.map((v) => v.max_abs_npv_delta));
  const unit = maxAbs >= 1e9 ? { name: "miliar" as const, divisor: 1e9, digits: 2 } : { name: "juta" as const, divisor: 1e6, digits: 1 };
  const labelFor = (v: SensitivityVariable) => labelOf(v.field);

  const rows = res.variables.map((v) => ({
    variable: v.variable,
    label: labelFor(v),
    baseValue: formatInput(v.variable, v.base_value, c),
    deltas: v.cases.map((k) => signed(k.npv_delta / unit.divisor, unit.digits)),
  }));

  const details: DetailRow[] = [
    {
      key: "base",
      label: "Semua nilai dasar",
      shift: "Tanpa pergeseran",
      input: "Nilai Anda di form",
      npv: money(res.base.npv_amount, c),
      irr: irrText(res.base),
      payback: paybackText(res.base),
    },
  ];
  for (const v of res.variables) {
    for (const k of v.cases) {
      details.push({
        key: `${v.variable}-${k.shift_fraction}`,
        label: labelFor(v),
        shift: shiftLabel(k.shift_fraction),
        input: formatInput(v.variable, k.input_value, c),
        npv: money(k.npv_amount, c),
        irr: irrText(k),
        payback: paybackText(k),
      });
    }
  }

  return {
    currency: c,
    unit: unit.name,
    shifts: (res.variables[0]?.cases ?? []).map((k) => shiftLabel(k.shift_fraction)),
    rows,
    zeroBaseLabels: res.variables.filter((v) => v.base_value === 0).map(labelFor),
    details,
    disclaimer: disclaimerId(res.scope),
    provenance: `Mesin v${res.engine_version}, metodologi v${res.methodology_version}, dihitung ${res.calculated_at}.`,
  };
}
