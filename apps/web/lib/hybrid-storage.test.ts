import { beforeEach, describe, expect, it } from "vitest";
import {
  applySweepCombinationToProject,
  buildSampleProject,
  createBlankProject,
  createSampleProject,
  deleteProject,
  duplicateProject,
  exportProjectJson,
  getProject,
  getSensitivityResult,
  getSimulationResult,
  getSweepResult,
  importProjectJson,
  listProjects,
  saveSensitivityResult,
  saveSimulationResult,
  saveSweepCombinationAsScenario,
  saveSweepResult,
} from "./hybrid-storage";
import { validateSystemTopology } from "./hybrid-topology";
import type {
  HybridSensitivityResponse,
  HybridSimulateResponse,
  HybridSweepCombination,
  HybridSweepResult,
} from "./hybrid-types";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: new MemoryStorage() },
    configurable: true,
    writable: true,
  });
});

describe("hybrid-storage", () => {
  it("membuat, menduplikat, mengekspor, mengimpor, dan menghapus proyek", () => {
    const sample = createSampleProject();
    expect(listProjects()).toHaveLength(1);
    expect(getProject(sample.id)?.project.project_name).toContain("[REAL DATA]");

    const blank = createBlankProject("Pabrik Baru");
    expect(listProjects()).toHaveLength(2);

    const copy = duplicateProject(blank.id);
    expect(copy?.project.project_name).toBe("Pabrik Baru (Salinan)");
    expect(listProjects()).toHaveLength(3);

    const jsonText = exportProjectJson(sample);
    const imported = importProjectJson(jsonText);
    expect(imported.id).not.toBe(sample.id);
    expect(imported.schemaVersion).toBe("0.7");
    expect(imported.components.diesel.enabled).toBe(false);
    expect(imported.topology?.nodes.length).toBeGreaterThanOrEqual(3);
    expect(listProjects()).toHaveLength(4);

    // Kompatibilitas mundur: impor JSON proyek Tahap 5/6 (tanpa topology / tanpa diesel)
    const legacyObj = JSON.parse(jsonText) as Record<string, unknown>;
    delete legacyObj.topology;
    delete (legacyObj.components as Record<string, unknown>).diesel;
    legacyObj.schemaVersion = "0.5";
    const importedLegacy = importProjectJson(JSON.stringify(legacyObj));
    expect(importedLegacy.schemaVersion).toBe("0.7");
    expect(importedLegacy.components.diesel).toBeDefined();
    expect(importedLegacy.components.diesel.enabled).toBe(false);
    expect(importedLegacy.topology?.nodes.some((n) => n.kind === "pv")).toBe(true);
    expect(importedLegacy.topology?.nodes.some((n) => n.kind === "bess")).toBe(true);

    deleteProject(blank.id);
    expect(getProject(blank.id)).toBeNull();
  });

  it("menolak JSON proyek yang tidak valid atau tidak lengkap", () => {
    expect(() => importProjectJson("{bukan json")).toThrow("JSON");
    expect(() => importProjectJson(JSON.stringify({ hello: "world" }))).toThrow("tidak lengkap");
  });

  it("menyimpan dan membaca hasil simulasi terakhir", () => {
    const p = buildSampleProject("p1");
    const fakeResult = {
      engine_version: "0.5.0",
      contract_version: "0.5",
      config_hash: "sha256:abc",
    } as unknown as HybridSimulateResponse;
    saveSimulationResult(p.id, fakeResult);
    expect(getSimulationResult(p.id)?.config_hash).toBe("sha256:abc");
  });

  it("menyimpan cache sapuan/sensitivitas, membersihkan saat hapus, dan menerapkan pemenang sapuan", () => {
    const p = createSampleProject();
    saveSweepResult(p.id, { total_combinations: 6 } as unknown as HybridSweepResult);
    saveSensitivityResult(p.id, { currency_code: "IDR" } as unknown as HybridSensitivityResponse);
    expect(getSweepResult(p.id)?.total_combinations).toBe(6);
    expect(getSensitivityResult(p.id)?.currency_code).toBe("IDR");

    const combo: HybridSweepCombination = {
      rank: 1,
      combination_id: "pv700-bess0-bio300",
      feasible: true,
      infeasible_reasons: [],
      sizing: {
        pv_capacity_kwp: 700,
        pv_inverter_ac_kw: 588,
        bess_enabled: false,
        bess_nominal_capacity_kwh: 0,
        bess_max_charge_kw: 0,
        bess_max_discharge_kw: 0,
        biomass_enabled: true,
        biomass_rated_capacity_kw: 300,
        diesel_enabled: true,
        diesel_rated_capacity_kw: 200,
      },
      technical: {
        pv_generation_kwh: 1,
        biomass_generation_kwh: 1,
        diesel_generation_kwh: 1,
        served_load_kwh: 1,
        unmet_load_kwh: 0,
        unmet_load_fraction: 0,
        curtailment_kwh: 0,
        renewable_fraction: 0.75,
        bess_equivalent_full_cycles: 0,
        biomass_fuel_tons: 1,
        diesel_fuel_liters: 10,
        avoided_emissions_tons_co2e: 1,
      },
      finance: {
        currency_code: "IDR",
        gross_capex: 1,
        net_capex: 1,
        total_npc: 1,
        lcoe: 1000,
        npv: 1,
        irr: 0.15,
        irr_status: "ok",
        simple_payback_years: 5,
        discounted_payback_years: 7,
        viability_status: "viable",
      },
    };

    const applied = applySweepCombinationToProject(p, combo);
    expect(applied.components.pv.capacity_kwp).toBe(700);
    expect(applied.components.bess.enabled).toBe(false);
    expect(applied.components.biomass.rated_capacity_kw).toBe(300);
    expect(applied.components.diesel.enabled).toBe(true);
    expect(applied.components.diesel.rated_capacity_kw).toBe(200);
    expect(applied.topology?.nodes.some((n) => n.kind === "diesel")).toBe(true);
    expect(validateSystemTopology(applied).valid).toBe(true);

    const scenario = saveSweepCombinationAsScenario(p, combo);
    expect(scenario.id).not.toBe(p.id);
    expect(scenario.project.project_name).toContain("pv700-bess0-bio300");

    deleteProject(p.id);
    expect(getSweepResult(p.id)).toBeNull();
    expect(getSensitivityResult(p.id)).toBeNull();
  });
});
