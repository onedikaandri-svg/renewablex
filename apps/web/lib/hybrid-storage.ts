import {
  addTopologyNode,
  connectTopologyNodes,
  deriveDefaultTopology,
  getNodeIdForKind,
  isKindConnectedToBus,
  removeTopologyNode,
  resolveProjectTopology,
  syncProjectFromTopology,
} from "@/lib/hybrid-topology";
import type {
  HybridDieselComponentConfig,
  HybridProjectConfig,
  HybridSensitivityResponse,
  HybridSimulateResponse,
  HybridSweepCombination,
  HybridSweepResult,
} from "@/lib/hybrid-types";

const PROJECTS_KEY = "renewablex.hybrid.projects.v1";
const RESULT_KEY_PREFIX = "renewablex.hybrid.result.v1.";
const SWEEP_KEY_PREFIX = "renewablex.hybrid.sweep.v1.";
const SENSITIVITY_KEY_PREFIX = "renewablex.hybrid.sensitivity.v1.";

export const DEFAULT_DIESEL_COMPONENT: HybridDieselComponentConfig = {
  enabled: false,
  rated_capacity_kw: 250.0,
  min_load_fraction: 0.30,
  fuel_curve_model: "willans_linear",
  no_load_fuel_liters_per_hour: null,
  slope_liters_per_kwh: 0.25,
  min_run_time_hours: 1.0,
  min_down_time_hours: 1.0,
  fuel_price_per_liter: 18500.0,
  fixed_om_per_kw_year: 150000.0,
  variable_om_per_operating_hour: 0.0,
  startup_cost: 0.0,
  overhaul_interval_operating_hours: 15000.0,
  overhaul_cost: 120000000.0,
  emission_factor_kg_co2e_per_liter: 2.68,
};

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
    schemaVersion: "0.7",
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
      diesel: { ...DEFAULT_DIESEL_COMPONENT },
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
      diesel_capex_per_kw: 4_500_000.0,
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
      diesel_overhaul_life_years: 5.0,
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
      diesel: { ...sample.components.diesel, enabled: false },
    },
  };
  return {
    ...blank,
    topology: deriveDefaultTopology(blank),
  };
}

function normalizeProject(raw: HybridProjectConfig): HybridProjectConfig {
  const sample = buildSampleProject(raw.id || makeId());
  return {
    ...sample,
    ...raw,
    project: { ...sample.project, ...raw.project },
    simulation: {
      ...sample.simulation,
      ...raw.simulation,
      dispatch_params: { ...sample.simulation.dispatch_params, ...(raw.simulation?.dispatch_params ?? {}) },
    },
    load_profile: { ...sample.load_profile, ...raw.load_profile },
    components: {
      pv: { ...sample.components.pv, ...(raw.components?.pv ?? {}) },
      bess: { ...sample.components.bess, ...(raw.components?.bess ?? {}) },
      biomass: { ...sample.components.biomass, ...(raw.components?.biomass ?? {}) },
      diesel: { ...DEFAULT_DIESEL_COMPONENT, ...(raw.components?.diesel ?? {}) },
    },
    finance: { ...sample.finance, ...(raw.finance ?? {}) },
  };
}

function readAllRaw(): HybridProjectConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => normalizeProject(item as HybridProjectConfig)) : [];
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
    ...normalizeProject(project),
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
      window.localStorage.removeItem(`${SWEEP_KEY_PREFIX}${projectId}`);
      window.localStorage.removeItem(`${SENSITIVITY_KEY_PREFIX}${projectId}`);
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
    schemaVersion: "0.7",
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
      diesel: { ...DEFAULT_DIESEL_COMPONENT, ...(obj.components.diesel ?? {}) },
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

export function clearSimulationResult(projectId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${RESULT_KEY_PREFIX}${projectId}`);
  } catch {
    // Abaikan.
  }
}

export function saveSweepResult(projectId: string, result: HybridSweepResult): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${SWEEP_KEY_PREFIX}${projectId}`, JSON.stringify(result));
  } catch {
    // Abaikan bila kuota penyimpanan penuh.
  }
}

export function getSweepResult(projectId: string): HybridSweepResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${SWEEP_KEY_PREFIX}${projectId}`);
    if (!raw) return null;
    return JSON.parse(raw) as HybridSweepResult;
  } catch {
    return null;
  }
}

export function saveSensitivityResult(projectId: string, result: HybridSensitivityResponse): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${SENSITIVITY_KEY_PREFIX}${projectId}`, JSON.stringify(result));
  } catch {
    // Abaikan bila kuota penyimpanan penuh.
  }
}

export function getSensitivityResult(projectId: string): HybridSensitivityResponse | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${SENSITIVITY_KEY_PREFIX}${projectId}`);
    if (!raw) return null;
    return JSON.parse(raw) as HybridSensitivityResponse;
  } catch {
    return null;
  }
}

function ensureOptionalNodeConnected(
  project: HybridProjectConfig,
  kind: "bess" | "biomass" | "diesel",
  enabled: boolean,
): HybridProjectConfig {
  const topo = resolveProjectTopology(project);
  const nodeId = getNodeIdForKind(kind);
  const exists = topo.nodes.some((n) => n.kind === kind);
  const connected = isKindConnectedToBus(topo, kind);

  if (enabled) {
    let next = project;
    if (!exists) {
      next = addTopologyNode(next, kind, { autoConnect: true });
    } else if (!connected) {
      next = connectTopologyNodes(next, nodeId, getNodeIdForKind("ac_bus")).project;
    }
    return next;
  }

  if (exists) {
    return removeTopologyNode(project, nodeId).project;
  }
  return project;
}

export function applySweepCombinationToProject(
  project: HybridProjectConfig,
  combo: HybridSweepCombination,
): HybridProjectConfig {
  const prevInvKw = project.components.pv.inverter_ac_kw;
  const invScale = prevInvKw > 0 ? combo.sizing.pv_inverter_ac_kw / prevInvKw : 1;

  const prevBessKwh = project.components.bess.nominal_capacity_kwh;
  const nextBessRepl = combo.sizing.bess_enabled
    ? (prevBessKwh > 0
      ? project.components.bess.replacement_cost * (combo.sizing.bess_nominal_capacity_kwh / prevBessKwh)
      : combo.sizing.bess_nominal_capacity_kwh * project.finance.bess_capex_per_kwh)
    : project.components.bess.replacement_cost;

  const prevBioKw = project.components.biomass.rated_capacity_kw;
  const nextBioOverhaul = combo.sizing.biomass_enabled
    ? (prevBioKw > 0
      ? project.components.biomass.overhaul_cost * (combo.sizing.biomass_rated_capacity_kw / prevBioKw)
      : project.components.biomass.overhaul_cost)
    : project.components.biomass.overhaul_cost;

  const dieselEnabled = Boolean(combo.sizing.diesel_enabled);
  const dieselKw = combo.sizing.diesel_rated_capacity_kw ?? project.components.diesel.rated_capacity_kw;
  const prevDieselKw = project.components.diesel.rated_capacity_kw;
  const nextDieselOverhaul = dieselEnabled
    ? (prevDieselKw > 0
      ? project.components.diesel.overhaul_cost * (dieselKw / prevDieselKw)
      : project.components.diesel.overhaul_cost)
    : project.components.diesel.overhaul_cost;

  let next: HybridProjectConfig = {
    ...structuredClone(project),
    components: {
      ...project.components,
      pv: {
        ...project.components.pv,
        enabled: true,
        capacity_kwp: combo.sizing.pv_capacity_kwp,
        inverter_ac_kw: combo.sizing.pv_inverter_ac_kw,
      },
      bess: {
        ...project.components.bess,
        enabled: combo.sizing.bess_enabled,
        nominal_capacity_kwh: combo.sizing.bess_enabled
          ? combo.sizing.bess_nominal_capacity_kwh
          : project.components.bess.nominal_capacity_kwh,
        max_charge_kw: combo.sizing.bess_enabled
          ? combo.sizing.bess_max_charge_kw
          : project.components.bess.max_charge_kw,
        max_discharge_kw: combo.sizing.bess_enabled
          ? combo.sizing.bess_max_discharge_kw
          : project.components.bess.max_discharge_kw,
        replacement_cost: nextBessRepl,
      },
      biomass: {
        ...project.components.biomass,
        enabled: combo.sizing.biomass_enabled,
        rated_capacity_kw: combo.sizing.biomass_enabled
          ? combo.sizing.biomass_rated_capacity_kw
          : project.components.biomass.rated_capacity_kw,
        overhaul_cost: nextBioOverhaul,
      },
      diesel: {
        ...project.components.diesel,
        enabled: dieselEnabled,
        rated_capacity_kw: dieselEnabled ? dieselKw : project.components.diesel.rated_capacity_kw,
        overhaul_cost: nextDieselOverhaul,
      },
    },
    finance: {
      ...project.finance,
      inverter_replacement_cost:
        project.finance.inverter_replacement_cost > 0
          ? project.finance.inverter_replacement_cost * invScale
          : project.finance.inverter_replacement_cost,
    },
  };

  next = ensureOptionalNodeConnected(next, "bess", combo.sizing.bess_enabled);
  next = ensureOptionalNodeConnected(next, "biomass", combo.sizing.biomass_enabled);
  next = ensureOptionalNodeConnected(next, "diesel", dieselEnabled);
  return next;
}

export function saveSweepCombinationAsScenario(
  project: HybridProjectConfig,
  combo: HybridSweepCombination,
): HybridProjectConfig {
  const updated = applySweepCombinationToProject(project, combo);
  const scenario: HybridProjectConfig = {
    ...updated,
    id: makeId(),
    project: {
      ...updated.project,
      project_name: `${project.project.project_name} (${combo.combination_id})`,
    },
    weatherPreview: null,
    loadPreview: null,
  };
  return saveProject(scenario);
}
