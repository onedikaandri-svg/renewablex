export type Values = Record<string, string>;

export interface FieldDef {
  key: string;
  label: string;
  unit?: string;
  kind: "text" | "number" | "select";
  value: string;
  options?: [string, string][];
  percent?: boolean;
}

export interface Group {
  title: string;
  fields: FieldDef[];
}

export const GROUPS: Group[] = [
  {
    title: "Proyek",
    fields: [
      { key: "project.project_name", label: "Nama proyek", kind: "text", value: "Proyek contoh" },
      { key: "project.project_type", label: "Jenis proyek", kind: "select", value: "ground_mounted",
        options: [["ground_mounted", "Di atas tanah"], ["rooftop", "Atap"], ["floating", "Terapung"], ["carport", "Carport"]] },
      { key: "project.country_code", label: "Kode negara", unit: "2 huruf, contoh ID", kind: "text", value: "ID" },
      { key: "project.currency_code", label: "Mata uang", unit: "3 huruf, contoh IDR", kind: "text", value: "IDR" },
      { key: "project.lifetime_years", label: "Umur proyek", unit: "tahun, 1 sampai 40", kind: "number", value: "25" },
    ],
  },
  {
    title: "Energi",
    fields: [
      { key: "project.capacity_kwp", label: "Kapasitas terpasang", unit: "kWp", kind: "number", value: "1000" },
      { key: "technical.specific_yield_kwh_per_kwp_year", label: "Yield spesifik", unit: "kWh/kWp/tahun", kind: "number", value: "1470" },
      { key: "technical.yield_boundary", label: "Batas yield", kind: "select", value: "net_ac_at_delivery",
        options: [["net_ac_at_delivery", "Sudah bersih (AC di titik serah)"], ["gross_pre_loss", "Kotor, belum dikurangi loss"]] },
      { key: "technical.performance_loss_fraction", label: "Performance loss", unit: "%", kind: "number", value: "0", percent: true },
      { key: "technical.degradation_fraction_per_year", label: "Degradasi tahunan", unit: "% per tahun", kind: "number", value: "0.5", percent: true },
    ],
  },
  {
    title: "Keuangan",
    fields: [
      { key: "financial.capex_amount", label: "CAPEX tahun 0", unit: "mata uang proyek", kind: "number", value: "12000000000" },
      { key: "financial.annual_opex_amount", label: "OPEX tahunan", unit: "per tahun", kind: "number", value: "150000000" },
      { key: "financial.tariff_per_kwh", label: "Tarif jual", unit: "per kWh", kind: "number", value: "1100" },
      { key: "financial.discount_rate_fraction", label: "Discount rate", unit: "% per tahun", kind: "number", value: "10", percent: true },
      { key: "financial.annual_tariff_escalation_fraction", label: "Eskalasi tarif", unit: "% per tahun", kind: "number", value: "0", percent: true },
      { key: "financial.annual_opex_escalation_fraction", label: "Eskalasi OPEX", unit: "% per tahun", kind: "number", value: "0", percent: true },
    ],
  },
];

export const FIELDS = GROUPS.flatMap((g) => g.fields);
export const DEFAULTS: Values = Object.fromEntries(FIELDS.map((f) => [f.key, f.value]));
export const EMPTY: Values = Object.fromEntries(FIELDS.map((f) => [f.key, f.kind === "select" ? f.value : ""]));
export const labelOf = (key: string) => FIELDS.find((f) => f.key === key)?.label ?? key;
export const idOf = (key: string) => key.replace(".", "-");

// Urutan kunci sesuai urutan tampil di form. Kunci yang tidak dikenal ditaruh di akhir.
export function byVisualOrder(keys: string[]): string[] {
  const rank = (k: string) => {
    const i = FIELDS.findIndex((f) => f.key === k);
    return i < 0 ? FIELDS.length : i;
  };
  return [...keys].sort((a, b) => rank(a) - rank(b));
}

export function isVisible(f: FieldDef, v: Values) {
  return f.key !== "technical.performance_loss_fraction" || v["technical.yield_boundary"] === "gross_pre_loss";
}

// Builds the API body. Only presence and number-ness are checked here; ranges belong to the engine.
export function buildRequest(v: Values) {
  const errors: Record<string, string> = {};
  const body: Record<string, Record<string, unknown>> = { project: {}, technical: {}, financial: {} };
  for (const f of FIELDS) {
    if (!isVisible(f, v)) continue;
    const raw = (v[f.key] ?? "").trim();
    let value: unknown = raw;
    if (f.kind === "number") {
      const n = raw === "" ? NaN : Number(raw);
      if (Number.isNaN(n)) { errors[f.key] = "Wajib diisi dengan angka."; continue; }
      value = f.percent ? n / 100 : n;
    } else if (raw === "") {
      errors[f.key] = "Wajib diisi.";
      continue;
    }
    const [section, name] = f.key.split(".");
    body[section][name] = value;
  }
  Object.assign(body.project, { technology: "solar_pv" });
  Object.assign(body.technical, { energy_method: "manual_specific_yield" });
  Object.assign(body.financial, { revenue_method: "fixed_tariff", tax_model: "pre_tax" });
  return { body, errors };
}
