import { FIELDS } from "@/lib/form";
import { isApiIssue, translateDetailText, translateIssue, type ApiIssue } from "@/lib/errors-id";

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
  scope: string;
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
  warning_codes?: string[];
  resource_metadata?: Record<string, string | null> | null; // <-- Tambahan baru
  disclaimer: string;
}

export interface SensitivityBase {
  npv_amount: number;
  project_irr_fraction: number | null;
  irr_status: IrrStatus;
  simple_payback_years: number | null;
  payback_status: "recovered" | "not_recovered";
}

export interface SensitivityCase extends SensitivityBase {
  shift_fraction: number;
  input_value: number;
  npv_delta: number;
}

export interface SensitivityVariableResult {
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
  base: SensitivityBase;
  variables: SensitivityVariableResult[];
  disclaimer: string;
}

export interface Problems {
  fields: Record<string, string>;
  general: string[];
  issues: ApiIssue[];
}

export class ApiError extends Error {
  constructor(public problems: Problems) {
    super("Input ditolak oleh mesin hitung.");
  }
}

export class NetworkError extends Error {}

const PERCENT_FIELDS = new Set(FIELDS.filter((f) => f.percent).map((f) => f.key));

export function parseProblems(detail: unknown, skip = 1): Problems {
  const problems: Problems = { fields: {}, general: [], issues: [] };
  if (typeof detail === "string") {
    problems.general.push(translateDetailText(detail));
    return problems;
  }
  if (!Array.isArray(detail)) {
    problems.general.push("Input tidak valid.");
    return problems;
  }
  for (const item of detail) {
    if (!isApiIssue(item)) {
      problems.general.push("Input tidak valid.");
      continue;
    }
    problems.issues.push(item);
    const loc = item.loc.slice(skip);
    if (loc.length >= 2) {
      const key = `${loc[0]}.${loc[1]}`;
      problems.fields[key] = translateIssue(item, { percent: PERCENT_FIELDS.has(key) });
    } else {
      problems.general.push(translateIssue(item));
    }
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

export async function runSensitivity(base: unknown, signal?: AbortSignal): Promise<SensitivityResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/pv/sensitivity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new NetworkError(`Tidak bisa terhubung ke mesin hitung di ${API_URL}.`);
  }
  if (res.status === 422) throw new ApiError(parseProblems((await res.json()).detail, 2));
  if (!res.ok) throw new NetworkError(`Mesin hitung mengembalikan error (HTTP ${res.status}).`);
  return res.json();
}
