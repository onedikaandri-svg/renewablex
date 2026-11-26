import type { HybridSimulateResponse, HybridSweepResult } from "@/lib/hybrid-types";

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildCsvDocument(headers: string[], rows: unknown[][], withBom = true): string {
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((r) => r.map(escapeCsvCell).join(",")),
  ];
  return (withBom ? "\uFEFF" : "") + lines.join("\n");
}

export function buildExportFilenameSlug(projectName: string): string {
  const clean = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || "proyek-hybrid";
}

export function buildCashflowCsv(result: HybridSimulateResponse): string {
  const headers = [
    "year",
    "served_load_kwh",
    "pv_generation_kwh",
    "biomass_generation_kwh",
    "grid_import_kwh",
    "capex_outflow",
    "gross_revenue_or_savings",
    "export_revenue",
    "om_cost",
    "fuel_and_logistics_cost",
    "grid_import_cost",
    "replacement_and_overhaul_cost",
    "salvage_inflow",
    "tax_outflow",
    "net_cash_flow",
    "discounted_cash_flow",
    "cumulative_cash_flow",
    "cumulative_discounted_cash_flow",
  ];
  const rows = result.cashflow_schedule.map((r) => [
    r.year,
    r.served_load_kwh,
    r.pv_generation_kwh,
    r.biomass_generation_kwh,
    r.grid_import_kwh,
    r.capex_outflow,
    r.gross_revenue_or_savings,
    r.export_revenue,
    r.om_cost,
    r.fuel_and_logistics_cost,
    r.grid_import_cost,
    r.replacement_and_overhaul_cost,
    r.salvage_inflow,
    r.tax_outflow,
    r.net_cash_flow,
    r.discounted_cash_flow,
    r.cumulative_cash_flow,
    r.cumulative_discounted_cash_flow,
  ]);
  return buildCsvDocument(headers, rows, true);
}

export function buildHourlyCsv(result: HybridSimulateResponse): string | null {
  const hourly = result.hourly_year_1;
  if (!hourly) return null;
  const headers = [
    "local_time",
    "load_kw",
    "pv_generation_kw",
    "biomass_generation_kw",
    "bess_charge_kw",
    "bess_discharge_kw",
    "grid_import_kw",
    "grid_export_kw",
    "served_load_kw",
    "unmet_load_kw",
    "curtailment_kw",
    "losses_kw",
    "bess_soc_fraction",
    "biomass_status",
  ];
  const rows: unknown[][] = [];
  for (let i = 0; i < hourly.steps_count; i++) {
    rows.push([
      hourly.local_time[i],
      hourly.load_kw[i],
      hourly.pv_generation_kw[i],
      hourly.biomass_generation_kw[i],
      hourly.bess_charge_kw[i],
      hourly.bess_discharge_kw[i],
      hourly.grid_import_kw[i],
      hourly.grid_export_kw[i],
      hourly.served_load_kw[i],
      hourly.unmet_load_kw[i],
      hourly.curtailment_kw[i],
      hourly.losses_kw[i],
      hourly.bess_soc_fraction ? hourly.bess_soc_fraction[i] : "",
      hourly.biomass_status ? hourly.biomass_status[i] : "",
    ]);
  }
  return buildCsvDocument(headers, rows, true);
}

export function buildSweepCsv(sweep: HybridSweepResult): string {
  const headers = [
    "rank",
    "combination_id",
    "feasible",
    "pv_capacity_kwp",
    "pv_inverter_ac_kw",
    "bess_nominal_capacity_kwh",
    "biomass_rated_capacity_kw",
    "lcoe",
    "total_npc",
    "npv",
    "irr",
    "simple_payback_years",
    "discounted_payback_years",
    "renewable_fraction",
    "unmet_load_fraction",
    "avoided_emissions_tons_co2e",
    "viability_status",
  ];
  const rows = sweep.combinations.map((c) => [
    c.rank,
    c.combination_id,
    c.feasible ? "Ya" : "Tidak",
    c.sizing.pv_capacity_kwp,
    c.sizing.pv_inverter_ac_kw,
    c.sizing.bess_nominal_capacity_kwh,
    c.sizing.biomass_rated_capacity_kw,
    c.finance.lcoe,
    c.finance.total_npc,
    c.finance.npv,
    c.finance.irr ?? "",
    c.finance.simple_payback_years ?? "",
    c.finance.discounted_payback_years ?? "",
    c.technical.renewable_fraction,
    c.technical.unmet_load_fraction,
    c.technical.avoided_emissions_tons_co2e,
    c.finance.viability_status,
  ]);
  return buildCsvDocument(headers, rows, true);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
