import { describe, expect, it } from "vitest";
import { buildDegradationSeries, buildDurationCurveSeries, buildSankeyEnergyData } from "./hybrid-charts";
import { buildSampleProject } from "./hybrid-storage";
import type { HybridSimulateResponse } from "./hybrid-types";

function makeSampleResponse(): HybridSimulateResponse {
  const n = 8760;
  const load = Array.from({ length: n }, (_, i) => 100 + (i % 24) * 10);
  const pv = Array.from({ length: n }, (_, i) => ((i % 24) >= 6 && (i % 24) <= 17 ? 420 - Math.abs((i % 24) - 12) * 35 : 0));
  const bio = Array.from({ length: n }, (_, i) => ((i % 24) < 6 ? 120 : 0));
  return {
    engine_version: "0.6.1",
    contract_version: "0.6",
    config_hash: "sha256:test",
    calculated_at: "2026-11-26T00:00:00+00:00",
    project_name: "Uji Grafik",
    dispatch_strategy: "load_following",
    weather_source: {
      provider: "pvgis",
      dataset: "PVGIS-ERA5",
      dataset_version: "v5_3",
      period: "2005-2023",
      latitude: -6.28,
      longitude: 107.15,
      elevation_m: 25,
      timezone: "Asia/Jakarta",
      timezone_offset_hours: 7,
      retrieved_at: "2026-11-26T00:00:00+00:00",
    },
    summary: {
      steps_count: n,
      step_minutes: 60,
      total_load_kwh: 1800000,
      pv_generation_kwh: 725000,
      biomass_generation_kwh: 640000,
      served_load_kwh: 1200000,
      unmet_load_kwh: 600000,
      curtailment_kwh: 12000,
      renewable_fraction: 0.667,
      pv_capacity_factor: 0.165,
      pv_specific_yield_kwh_per_kwp: 1450,
      max_balance_error_kw: 0,
    },
    pv_loss_breakdown_kwh: { poa_nominal_kwh: 900000 },
    monthly: [],
    bess_summary: {
      total_charge_kwh: 155000,
      total_discharge_kwh: 137000,
      conversion_losses_kwh: 18000,
      aux_load_kwh: 0,
      equivalent_full_cycles: 245,
      final_soc_fraction: 0.5,
      final_effective_capacity_kwh: 583.5,
      replacement_count: 0,
    },
    biomass_summary: null,
    lifetime_summary: {
      project_lifetime_years: 3,
      multi_year_mode: "full_hourly",
      total_load_kwh: 5400000,
      total_pv_generation_kwh: 2150000,
      total_biomass_generation_kwh: 1920000,
      total_served_load_kwh: 3600000,
      total_unmet_load_kwh: 1800000,
      total_curtailment_kwh: 36000,
      total_grid_import_kwh: 0,
      total_grid_export_kwh: 0,
      total_bess_replacements: 1,
      total_biomass_overhauls: 0,
      max_balance_error_kw: 0,
      lifecycle_events: [
        { year: 2, event_type: "bess_replacement", description: "Penggantian BESS", cost_amount: 1800000000 },
      ],
      yearly: [
        {
          year: 1,
          pv_degradation_factor: 1.0,
          total_load_kwh: 1800000,
          pv_generation_kwh: 725000,
          biomass_generation_kwh: 640000,
          served_load_kwh: 1200000,
          unmet_load_kwh: 600000,
          curtailment_kwh: 12000,
          grid_import_kwh: 0,
          grid_export_kwh: 0,
          renewable_fraction: 0.667,
          bess_yearly_efc: 245,
          bess_final_effective_capacity_kwh: 582,
          bess_replacement_count: 0,
          biomass_fuel_tons: 1100,
          biomass_overhaul_count: 0,
        },
        {
          year: 2,
          pv_degradation_factor: 0.995,
          total_load_kwh: 1800000,
          pv_generation_kwh: 721375,
          biomass_generation_kwh: 640000,
          served_load_kwh: 1200000,
          unmet_load_kwh: 600000,
          curtailment_kwh: 11940,
          grid_import_kwh: 0,
          grid_export_kwh: 0,
          renewable_fraction: 0.667,
          bess_yearly_efc: 245,
          bess_final_effective_capacity_kwh: 594,
          bess_replacement_count: 1,
          biomass_fuel_tons: 1100,
          biomass_overhaul_count: 0,
        },
      ],
    },
    finance_summary: null,
    lcoe_breakdown: null,
    emissions_summary: null,
    cashflow_schedule: [],
    hourly_year_1: {
      steps_count: n,
      step_minutes: 60,
      local_time: Array.from({ length: n }, () => "01-01 00:00"),
      load_kw: load,
      pv_generation_kw: pv,
      biomass_generation_kw: bio,
      bess_charge_kw: Array(n).fill(0),
      bess_discharge_kw: Array(n).fill(0),
      grid_import_kw: Array(n).fill(0),
      grid_export_kw: Array(n).fill(0),
      served_load_kw: load,
      unmet_load_kw: Array(n).fill(0),
      curtailment_kw: Array(n).fill(0),
      losses_kw: Array(n).fill(0),
      bess_soc_fraction: Array(n).fill(0.5),
      biomass_status: null,
      trace_reason: null,
    },
    warnings: [],
    warning_codes: [],
  };
}

describe("hybrid-charts: Sankey, Kurva Durasi, dan Degradasi", () => {
  it("membangun graf Sankey bebas siklus (DAG) dan merangkum aliran MWh", () => {
    const res = makeSampleResponse();
    const sankey = buildSankeyEnergyData(res, "id");
    expect(sankey.links.length).toBeGreaterThan(0);

    // Pastikan tidak ada siklus (setiap simpul tidak bisa kembali ke dirinya sendiri)
    const adj = new Map<string, string[]>();
    for (const l of sankey.links) {
      const list = adj.get(l.source) ?? [];
      list.push(l.target);
      adj.set(l.source, list);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    function hasCycle(node: string): boolean {
      if (visiting.has(node)) return true;
      if (visited.has(node)) return false;
      visiting.add(node);
      for (const nxt of adj.get(node) ?? []) {
        if (hasCycle(nxt)) return true;
      }
      visiting.delete(node);
      visited.add(node);
      return false;
    }
    for (const n of sankey.nodes) {
      expect(hasCycle(n.name)).toBe(false);
    }
  });

  it("melakukan decimation kurva durasi sambil mempertahankan puncak dan minimum eksak", () => {
    const res = makeSampleResponse();
    const dur = buildDurationCurveSeries(res.hourly_year_1!, 240);
    expect(dur.percentLabels.length).toBeLessThanOrEqual(240);
    expect(dur.percentLabels[0]).toBe("0.0%");
    expect(dur.percentLabels[dur.percentLabels.length - 1]).toBe("100.0%");
    expect(dur.loadKw[0]).toBe(330);
    expect(dur.loadKw[dur.loadKw.length - 1]).toBe(100);
    expect(dur.pvKw[0]).toBe(420);
    expect(dur.pvKw[dur.pvKw.length - 1]).toBe(0);
  });

  it("mengekstrak deret degradasi kapasitas PV dan BESS beserta penanda kejadian umur", () => {
    const cfg = buildSampleProject("deg-test");
    const res = makeSampleResponse();
    const deg = buildDegradationSeries(res, cfg);
    expect(deg.years).toEqual(["1", "2"]);
    expect(deg.pvCapacityPct).toEqual([100, 99.5]);
    expect(deg.bessCapacityPct).toEqual([97, 99]);
    expect(deg.events).toHaveLength(1);
    expect(deg.events[0].year).toBe(2);
  });
});
