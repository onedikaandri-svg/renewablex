import { describe, expect, it } from "vitest";
import {
  buildCashflowCsv,
  buildCsvDocument,
  buildExportFilenameSlug,
  buildHourlyCsv,
  buildSweepCsv,
  escapeCsvCell,
} from "./hybrid-export";
import type { HybridSimulateResponse, HybridSweepResult } from "./hybrid-types";

describe("hybrid-export", () => {
  it("melakukan escaping sel CSV dengan aman dan menambahkan UTF-8 BOM", () => {
    expect(escapeCsvCell('Pabrik "Cikarang", Jawa Barat')).toBe('"Pabrik ""Cikarang"", Jawa Barat"');
    expect(escapeCsvCell(null)).toBe("");
    const csv = buildCsvDocument(["nama", "nilai"], [["PV, 500 kWp", 1234]], true);
    expect(csv.startsWith("\uFEFFnama,nilai\n")).toBe(true);
    expect(csv).toContain('"PV, 500 kWp",1234');
  });

  it("membuat slug nama berkas dan CSV deret waktu 8.760 jam, arus kas, serta sapuan", () => {
    expect(buildExportFilenameSlug("Pabrik Hybrid Cikarang [REAL DATA]")).toBe("pabrik-hybrid-cikarang-real-data");

    const fakeHours = 8760;
    const zeros = Array.from({ length: fakeHours }, (_, i) => i * 0.1);
    const times = Array.from({ length: fakeHours }, (_, i) => `step-${i}`);

    const sim = {
      cashflow_schedule: [
        {
          year: 0,
          served_load_kwh: 0,
          pv_generation_kwh: 0,
          biomass_generation_kwh: 0,
          grid_import_kwh: 0,
          capex_outflow: 1000,
          gross_revenue_or_savings: 0,
          export_revenue: 0,
          om_cost: 0,
          fuel_and_logistics_cost: 0,
          grid_import_cost: 0,
          replacement_and_overhaul_cost: 0,
          salvage_inflow: 0,
          tax_outflow: 0,
          net_cash_flow: -1000,
          discounted_cash_flow: -1000,
          cumulative_cash_flow: -1000,
          cumulative_discounted_cash_flow: -1000,
        },
      ],
      hourly_year_1: {
        steps_count: fakeHours,
        step_minutes: 60,
        local_time: times,
        load_kw: zeros,
        pv_generation_kw: zeros,
        biomass_generation_kw: zeros,
        bess_charge_kw: zeros,
        bess_discharge_kw: zeros,
        grid_import_kw: zeros,
        grid_export_kw: zeros,
        served_load_kw: zeros,
        unmet_load_kw: zeros,
        curtailment_kw: zeros,
        losses_kw: zeros,
        bess_soc_fraction: zeros,
        biomass_status: Array.from({ length: fakeHours }, () => "off"),
        trace_reason: null,
      },
    } as unknown as HybridSimulateResponse;

    const hourlyCsv = buildHourlyCsv(sim);
    expect(hourlyCsv).not.toBeNull();
    expect(hourlyCsv!.split("\n")).toHaveLength(8761);

    const cfCsv = buildCashflowCsv(sim);
    expect(cfCsv.split("\n")).toHaveLength(2);
    expect(cfCsv).toContain("capex_outflow");

    const sweep = {
      sort_by: "lcoe_asc",
      feasible_count: 1,
      total_combinations: 1,
      best_combination_id: "pv500-bess400-bio0",
      combinations: [
        {
          rank: 1,
          combination_id: "pv500-bess400-bio0",
          feasible: true,
          infeasible_reasons: [],
          sizing: {
            pv_capacity_kwp: 500,
            pv_inverter_ac_kw: 420,
            bess_enabled: true,
            bess_nominal_capacity_kwh: 400,
            bess_max_charge_kw: 200,
            bess_max_discharge_kw: 200,
            biomass_enabled: false,
            biomass_rated_capacity_kw: 0,
          },
          technical: {
            pv_generation_kwh: 725000,
            biomass_generation_kwh: 0,
            served_load_kwh: 1500000,
            unmet_load_kwh: 0,
            unmet_load_fraction: 0,
            curtailment_kwh: 1000,
            renewable_fraction: 0.9,
            bess_equivalent_full_cycles: 200,
            biomass_fuel_tons: 0,
            avoided_emissions_tons_co2e: 10000,
          },
          finance: {
            currency_code: "IDR",
            gross_capex: 7e9,
            net_capex: 7e9,
            total_npc: 1e10,
            lcoe: 1200,
            npv: 3e9,
            irr: 0.14,
            irr_status: "ok",
            simple_payback_years: 6,
            discounted_payback_years: 9,
            viability_status: "viable",
          },
        },
      ],
    } as unknown as HybridSweepResult;

    const swCsv = buildSweepCsv(sweep);
    expect(swCsv).toContain("pv500-bess400-bio0");
    expect(swCsv).toContain("Ya");
  });
});
