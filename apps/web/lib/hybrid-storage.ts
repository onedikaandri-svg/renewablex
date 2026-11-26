import { deriveDefaultTopology, syncProjectFromTopology } from "@/lib/hybrid-topology";
import type { HybridProjectConfig, HybridSimulateResponse } from "@/lib/hybrid-types";

const PROJECTS_KEY = "renewablex.hybrid.projects.v1";
const RESULT_KEY_PREFIX = "renewablex.hybrid.result.v1.";

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `proj-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

// Seluruh angka sampel bawaan berasal dari docs/assumptions.md dan ditandai [REAL DATA].
export function buildSampleProject(id = makeId()): HybridProjectConfig {
  const base: HybridProjectConfig = {
    id,
    schemaVersion: "0.6",
    updatedAt: new Date().toISOString(),
    project: {
      project_name: "Pabrik Hybrid Cikarang [REAL DATA]",
      latitude: -6.28,
      longitude: 107.15,
      elevation_m: 25.0,
      timezone: "Asia/Jakarta",
      currency_code: "IDR",
    },
    simulation: {
      step_minutes: 60,
      leap_day_policy: "ignore_feb_29",
      weather_source: "pvgis_tmy",
      dispatch_strategy: "load_following",
      dispatch_params: {
        allow_grid_import: false,
        allow_grid_export: false,
        target_soc_fraction: 0.80,
        peak_limit_kw: 250.0,
        peak_hours: [17, 18, 19, 20, 21],
        off_peak_hours: [0, 1, 2, 3, 4, 5],
        tou_charge_soc_target: 0.90,
        tou_discharge_soc_floor: 0.25,
      },
      project_lifetime_years: 25,
      multi_year_mode: "scaled_year_1",
    },
    load_profile: {
      mode: "synthetic",
      base_load_kw: 120.0,
      peak_load_kw: 350.0,
      seed: 42,
      noise_fraction: 0.05,
      csv_text: "",
      csv_filename: "",
    },
    components: {
      pv: {
        enabled: true,
        model: "detailed_v1",
        capacity_kwp: 500.0,
        inverter_ac_kw: 420.0,
        transposition_model: "perez",
        tracking_mode: "fixed",
        tilt_degrees: 10.0,
        azimuth_degrees: 0.0,
        cell_temp_model: "faiman",
        dc_model: "pvwatts",
        system_loss_fraction: 0.14,
        annual_degradation_fraction: 0.005,
        inverter_efficiency: 0.96,
      },
      bess: {
        enabled: true,
        nominal_capacity_kwh: 600.0,
        max_charge_kw: 300.0,
        max_discharge_kw: 300.0,
        soc_min_fraction: 0.20,
        soc_max_fraction: 0.95,
        initial_soc_fraction: 0.50,
        charge_efficiency: 0.94,
        discharge_efficiency: 0.94,
        pcs_loss_fraction: 0.02,
        calendar_fade_per_year: 0.015,
        cycle_fade_per_efc: 0.00005,
        eol_capacity_fraction: 0.80,
        replacement_cost: 1_800_000_000.0,
      },
      biomass: {
        enabled: true,
        plant_sample: "sample_gasifier_250kw",
        rated_capacity_kw: 250.0,
        min_load_fraction: 0.40,
        fuel_preset: "efb",
        supply_period: "monthly",
        supply_limit_tons: 220.0,
        fuel_price_per_ton: null,
        logistics_cost_per_ton: null,
        moisture_fraction: null,
        fixed_om_per_kw_year: 450_000.0,
        variable_om_per_kwh: 120.0,
        overhaul_interval_operating_hours: 8000.0,
        overhaul_cost: 150_000_000.0,
      },
    },
    finance: {
      tax_model: "pre_tax",
      revenue_mode: "avoided_cost",
      discount_rate: 0.10,
      tariff_escalation_rate: 0.02,
      om_escalation_rate: 0.02,
      fuel_escalation_rate: 0.02,
      replacement_escalation_rate: 0.0,
      electricity_tariff_per_kwh: 1445.0,
      grid_import_tariff_per_kwh: 1445.0,
      grid_export_tariff_per_kwh: 0.0,
      pv_capex_per_kwp: 11_500_000.0,
      bess_capex_per_kwh: 3_500_000.0,
      biomass_capex_per_kw: 18_000_000.0,
      bos_and_other_capex: 0.0,
      pv_om_fraction_of_capex: 0.015,
      bess_fixed_om_per_kwh_year: 50_000.0,
      capital_grant_amount: 0.0,
      tax_credit_fraction: 0.0,
      corporate_tax_rate: 0.22,
      inverter_replacement_year: 13,
      inverter_replacement_cost: 420_000_000.0,
      bess_design_life_years: 10.0,
      inverter_design_life_years: 12.0,
      biomass_overhaul_life_years: 5.0,
      grid_emission_factor_kg_co2e_per_kwh: 0.78,
    },
    weatherPreview: null,
    loadPreview: null,
  };
  return {
    ...base,
    topology: deriveDefaultTopology(base),
  };
}

export function buildBlankProject(name = "Proyek Hybrid Baru", id = makeId()): HybridProjectConfig {
  const sample = buildSampleProject(id);
  const blank: HybridProjectConfig = {
    ...sample,
    project: {
      ...sample.project,
      project_name: name,
    },
    components: {
      ...sample.components,
      pv: { ...sample.components.pv, capacity_kwp: 100.0, inverter_ac_kw: 85.0 },
      bess: { ...sample.components.bess, enabled: false },
      biomass: { ...sample.components.biomass, enabled: false },
    },
  };
  return {
    ...blank,
    topology: deriveDefaultTopology(blank),
  };
}

function readAllRaw(): HybridProjectConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAllRaw(items: HybridProjectConfig[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(items));
}

export function listProjects(): HybridProjectConfig[] {
  return readAllRaw().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getProject(projectId: string): HybridProjectConfig | null {
  return readAllRaw().find((p) => p.id === projectId) ?? null;
}

export function saveProject(project: HybridProjectConfig): HybridProjectConfig {
  const updated: HybridProjectConfig = {
    ...project,
    updatedAt: new Date().toISOString(),
  };
  const all = readAllRaw();
  const idx = all.findIndex((p) => p.id === updated.id);
  if (idx >= 0) {
    all[idx] = updated;
  } else {
    all.push(updated);
  }
  writeAllRaw(all);
  return updated;
}

export function createSampleProject(): HybridProjectConfig {
  return saveProject(buildSampleProject());
}

export function createBlankProject(name?: string): HybridProjectConfig {
  return saveProject(buildBlankProject(name));
}

export function duplicateProject(projectId: string): HybridProjectConfig | null {
  const src = getProject(projectId);
  if (!src) return null;
  const copy: HybridProjectConfig = {
    ...structuredClone(src),
    id: makeId(),
    project: {
      ...src.project,
      project_name: `${src.project.project_name} (Salinan)`,
    },
  };
  return saveProject(copy);
}

export function deleteProject(projectId: string): void {
  const next = readAllRaw().filter((p) => p.id !== projectId);
  writeAllRaw(next);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(`${RESULT_KEY_PREFIX}${projectId}`);
    } catch {
      // Abaikan.
    }
  }
}

export function exportProjectJson(project: HybridProjectConfig): string {
  const clean = { ...project, weatherPreview: null, loadPreview: null };
  return JSON.stringify(clean, null, 2);
}

export function importProjectJson(jsonText: string): HybridProjectConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Berkas bukan JSON yang valid.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Struktur proyek JSON harus berupa objek.");
  }
  const obj = parsed as Partial<HybridProjectConfig>;
  if (!obj.project?.project_name || !obj.components?.pv || !obj.simulation || !obj.load_profile || !obj.finance) {
    throw new Error("JSON proyek tidak lengkap (wajib memuat project, simulation, load_profile, components.pv, dan finance).");
  }
  const base = buildSampleProject(makeId());
  const merged: HybridProjectConfig = {
    ...base,
    ...obj,
    id: makeId(),
    schemaVersion: "0.6",
    updatedAt: new Date().toISOString(),
    project: { ...base.project, ...obj.project },
    simulation: {
      ...base.simulation,
      ...obj.simulation,
      dispatch_params: { ...base.simulation.dispatch_params, ...obj.simulation.dispatch_params },
    },
    load_profile: { ...base.load_profile, ...obj.load_profile },
    components: {
      pv: { ...base.components.pv, ...obj.components.pv },
      bess: { ...base.components.bess, ...(obj.components.bess ?? {}) },
      biomass: { ...base.components.biomass, ...(obj.components.biomass ?? {}) },
    },
    finance: { ...base.finance, ...obj.finance },
    weatherPreview: null,
    loadPreview: null,
  };

  if (obj.topology && Array.isArray(obj.topology.nodes) && Array.isArray(obj.topology.edges)) {
    return saveProject(syncProjectFromTopology(merged, obj.topology));
  }

  return saveProject({
    ...merged,
    topology: deriveDefaultTopology(merged),
  });
}

export function saveSimulationResult(projectId: string, result: HybridSimulateResponse): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${RESULT_KEY_PREFIX}${projectId}`, JSON.stringify(result));
  } catch {
    // Jika quota localStorage penuh karena hourly_year_1 besar, simpan versi ringkas tanpa hourly.
    const compact = { ...result, hourly_year_1: undefined };
    try {
      window.localStorage.setItem(`${RESULT_KEY_PREFIX}${projectId}`, JSON.stringify(compact));
    } catch {
      // Abaikan bila tetap penuh.
    }
  }
}

export function getSimulationResult(projectId: string): HybridSimulateResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${RESULT_KEY_PREFIX}${projectId}`);
    if (!raw) return null;
    return JSON.parse(raw) as HybridSimulateResponse;
  } catch {
    return null;
  }
}
