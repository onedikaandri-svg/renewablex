import { 
  runSensitivity, 
  type SensitivityResponse, 
  type SensitivityVariableResult, 
  type SensitivityBase, 
  type SensitivityCase, 
  type Problems 
} from "@/lib/api";
import { byVisualOrder, labelOf } from "@/lib/form";
import { disclaimerId, fixed, fmt, money } from "@/lib/format";

// Ekspor ulang runSensitivity agar Sensitivity.tsx bisa mengimpornya dari sini
export { runSensitivity };

export function problemMessages(p: Problems): string[] {
  const keys = byVisualOrder(Object.keys(p.fields));
  return [...keys.map((k) => `${labelOf(k)}: ${p.fields[k]}`), ...p.general];
}

// Tampilan: hanya pemformatan dan teks. Semua angka berasal dari respons mesin.

const amount = (v: number) =>
  Math.abs(v) >= 1e9 ? `${fmt(v / 1e9, 2)} miliar` : Math.abs(v) >= 1e6 ? `${fmt(v / 1e6, 1)} juta` : fmt(v, 2);

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

export function signed(v: number, digits: number): string {
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return r === 0 ? fixed(0, digits) : `${r > 0 ? "+" : ""}${fixed(r, digits)}`;
}

const IRR_UNAVAILABLE: Record<string, string> = {
  no_sign_change: "Tidak tersedia: arus kas tidak berganti tanda",
  ambiguous: "Tidak tersedia: tanda arus kas berganti lebih dari sekali",
  not_found: "Tidak tersedia: tidak ditemukan pada rentang -99% sampai 10.000%",
};

export function irrText(c: SensitivityBase): string {
  if (c.irr_status === "ok" && c.project_irr_fraction !== null) return `${fmt(c.project_irr_fraction * 100, 2)}%`;
  return IRR_UNAVAILABLE[c.irr_status] ?? "Tidak tersedia";
}

export function paybackText(c: SensitivityBase): string {
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
  const labelFor = (v: SensitivityVariableResult) => labelOf(v.field);

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
