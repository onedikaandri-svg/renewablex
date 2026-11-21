export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

export type IrrStatus = "ok" | "no_sign_change" | "ambiguous" | "not_found";

export interface AnnualRow {
  year: number;
  energy_kwh: number;
  revenue: number;
  opex: number;
  cash_flow: number;
  cumulative_cash_flow: number;
}

export interface PVResponse {
  engine_version: string;
  methodology_version: string;
  calculated_at: string;
  currency_code: string;
  net_specific_yield_kwh_per_kwp_year: number;
  year_1_energy_kwh: number;
  npv_amount: number;
  project_irr_fraction: number | null;
  irr_status: IrrStatus;
  simple_payback_years: number | null;
  payback_status: "recovered" | "not_recovered";
  annual_results: AnnualRow[];
  warnings: string[];
  disclaimer: string;
}

export interface Problems {
  fields: Record<string, string>;
  general: string[];
}

export class ApiError extends Error {
  constructor(public problems: Problems) {
    super("Input ditolak oleh mesin hitung.");
  }
}

export class NetworkError extends Error {}

const clean = (msg: string) => msg.replace(/^Value error, /, "");

function parseProblems(detail: unknown): Problems {
  const problems: Problems = { fields: {}, general: [] };
  if (!Array.isArray(detail)) {
    problems.general.push(typeof detail === "string" ? detail : "Input tidak valid.");
    return problems;
  }
  for (const item of detail as { loc?: (string | number)[]; msg?: string }[]) {
    const msg = clean(item.msg ?? "Input tidak valid.");
    const loc = (item.loc ?? []).slice(1);
    if (loc.length >= 2) problems.fields[`${loc[0]}.${loc[1]}`] = msg;
    else problems.general.push(msg);
  }
  return problems;
}

export async function runPreliminary(body: unknown): Promise<PVResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/pv/preliminary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new NetworkError(`Tidak bisa terhubung ke mesin hitung di ${API_URL}.`);
  }
  if (res.status === 422) throw new ApiError(parseProblems((await res.json()).detail));
  if (!res.ok) throw new NetworkError(`Mesin hitung mengembalikan error (HTTP ${res.status}).`);
  return res.json();
}
