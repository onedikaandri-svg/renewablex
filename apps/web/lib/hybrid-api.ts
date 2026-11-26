import { API_URL, ApiError, NetworkError, parseProblems } from "@/lib/api";
import type {
  HybridJobStatusResponse,
  HybridLoadPreviewResponse,
  HybridPresetsResponse,
  HybridProjectConfig,
  HybridSensitivityResponse,
  HybridSensitivityVariableId,
  HybridSimulateResponse,
  HybridSweepJobResponse,
  HybridSweepRequestInput,
  HybridSweepResult,
  HybridWeatherPreviewResponse,
} from "@/lib/hybrid-types";

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new NetworkError(`Tidak bisa terhubung ke mesin hitung di ${API_URL}.`);
  }
  if (res.status === 422 || res.status === 413) {
    const data = await res.json();
    throw new ApiError(parseProblems(data.detail));
  }
  if (res.status === 404) {
    const data = await res.json();
    throw new ApiError(parseProblems(data.detail));
  }
  if (!res.ok) {
    throw new NetworkError(`Mesin hitung mengembalikan error (HTTP ${res.status}).`);
  }
  return res.json();
}

export async function fetchHybridPresets(): Promise<HybridPresetsResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/hybrid/presets`);
  } catch {
    throw new NetworkError(`Tidak bisa terhubung ke mesin hitung di ${API_URL}.`);
  }
  if (!res.ok) {
    throw new NetworkError(`Gagal memuat preset hybrid (HTTP ${res.status}).`);
  }
  return res.json();
}

export async function previewHybridWeather(
  cfg: HybridProjectConfig,
  signal?: AbortSignal,
): Promise<HybridWeatherPreviewResponse> {
  return postJson<HybridWeatherPreviewResponse>(
    "/v1/hybrid/weather/preview",
    {
      latitude: cfg.project.latitude,
      longitude: cfg.project.longitude,
      timezone: cfg.project.timezone,
      weather_source: cfg.simulation.weather_source,
      step_minutes: cfg.simulation.step_minutes,
    },
    signal,
  );
}

export async function previewHybridLoad(
  cfg: HybridProjectConfig,
  signal?: AbortSignal,
): Promise<HybridLoadPreviewResponse> {
  const lp = cfg.load_profile;
  return postJson<HybridLoadPreviewResponse>(
    "/v1/hybrid/load/preview",
    {
      step_minutes: cfg.simulation.step_minutes,
      timezone: cfg.project.timezone,
      load_profile:
        lp.mode === "csv"
          ? { mode: "csv", csv_text: lp.csv_text }
          : {
              mode: "synthetic",
              base_load_kw: lp.base_load_kw,
              peak_load_kw: lp.peak_load_kw,
              seed: lp.seed,
              noise_fraction: lp.noise_fraction,
            },
    },
    signal,
  );
}

export function buildHybridSimulatePayload(cfg: HybridProjectConfig): Record<string, unknown> {
  const { pv, bess, biomass, diesel } = cfg.components;
  const lp = cfg.load_profile;

  const bioPayload: Record<string, unknown> = biomass.enabled
    ? {
        enabled: true,
        plant_sample: biomass.plant_sample,
        rated_capacity_kw: biomass.rated_capacity_kw,
        min_load_fraction: biomass.min_load_fraction,
        fuel_preset: biomass.fuel_preset,
        supply_period: biomass.supply_period,
        ...(biomass.supply_period === "unlimited" ? {} : { supply_limit_tons: biomass.supply_limit_tons }),
        ...(biomass.fuel_price_per_ton !== null ? { fuel_price_per_ton: biomass.fuel_price_per_ton } : {}),
        ...(biomass.logistics_cost_per_ton !== null ? { logistics_cost_per_ton: biomass.logistics_cost_per_ton } : {}),
        ...(biomass.moisture_fraction !== null ? { moisture_fraction: biomass.moisture_fraction } : {}),
        fixed_om_per_kw_year: biomass.fixed_om_per_kw_year,
        variable_om_per_kwh: biomass.variable_om_per_kwh,
        overhaul_interval_operating_hours: biomass.overhaul_interval_operating_hours,
        overhaul_cost: biomass.overhaul_cost,
      }
    : { enabled: false };

  const dieselPayload: Record<string, unknown> = diesel?.enabled
    ? {
        enabled: true,
        rated_capacity_kw: diesel.rated_capacity_kw,
        min_load_fraction: diesel.min_load_fraction,
        fuel_curve_model: diesel.fuel_curve_model,
        ...(diesel.no_load_fuel_liters_per_hour !== null
          ? { no_load_fuel_liters_per_hour: diesel.no_load_fuel_liters_per_hour }
          : {}),
        slope_liters_per_kwh: diesel.slope_liters_per_kwh,
        min_run_time_hours: diesel.min_run_time_hours,
        min_down_time_hours: diesel.min_down_time_hours,
        fuel_price_per_liter: diesel.fuel_price_per_liter,
        fixed_om_per_kw_year: diesel.fixed_om_per_kw_year,
        variable_om_per_operating_hour: diesel.variable_om_per_operating_hour,
        startup_cost: diesel.startup_cost,
        overhaul_interval_operating_hours: diesel.overhaul_interval_operating_hours,
        overhaul_cost: diesel.overhaul_cost,
        emission_factor_kg_co2e_per_liter: diesel.emission_factor_kg_co2e_per_liter,
        is_renewable: false,
      }
    : { enabled: false };

  return {
    contract_version: "0.7",
    project: {
      project_name: cfg.project.project_name,
      latitude: cfg.project.latitude,
      longitude: cfg.project.longitude,
      elevation_m: cfg.project.elevation_m,
      timezone: cfg.project.timezone,
      currency_code: cfg.project.currency_code,
    },
    simulation: {
      step_minutes: cfg.simulation.step_minutes,
      leap_day_policy: cfg.simulation.leap_day_policy,
      weather_source: cfg.simulation.weather_source,
      dispatch_strategy: cfg.simulation.dispatch_strategy,
      dispatch_params: {
        allow_grid_import: cfg.simulation.dispatch_params.allow_grid_import,
        allow_grid_export: cfg.simulation.dispatch_params.allow_grid_export,
        target_soc_fraction: cfg.simulation.dispatch_params.target_soc_fraction,
        peak_limit_kw: cfg.simulation.dispatch_params.peak_limit_kw,
        peak_hours: cfg.simulation.dispatch_params.peak_hours,
        off_peak_hours: cfg.simulation.dispatch_params.off_peak_hours,
        tou_charge_soc_target: cfg.simulation.dispatch_params.tou_charge_soc_target,
        tou_discharge_soc_floor: cfg.simulation.dispatch_params.tou_discharge_soc_floor,
      },
      project_lifetime_years: cfg.simulation.project_lifetime_years,
      multi_year_mode: cfg.simulation.multi_year_mode,
    },
    load_profile:
      lp.mode === "csv"
        ? { mode: "csv", csv_text: lp.csv_text }
        : {
            mode: "synthetic",
            base_load_kw: lp.base_load_kw,
            peak_load_kw: lp.peak_load_kw,
            seed: lp.seed,
            noise_fraction: lp.noise_fraction,
          },
    components: {
      pv: {
        enabled: pv.enabled,
        model: pv.model,
        capacity_kwp: pv.capacity_kwp,
        inverter_ac_kw: pv.inverter_ac_kw,
        transposition_model: pv.transposition_model,
        tracking_mode: pv.tracking_mode,
        tilt_degrees: pv.tilt_degrees,
        azimuth_degrees: pv.azimuth_degrees,
        cell_temp_model: pv.cell_temp_model,
        dc_model: pv.dc_model,
        system_loss_fraction: pv.system_loss_fraction,
        annual_degradation_fraction: pv.annual_degradation_fraction,
        inverter_efficiency: pv.inverter_efficiency,
      },
      bess: bess.enabled
        ? {
            enabled: true,
            nominal_capacity_kwh: bess.nominal_capacity_kwh,
            max_charge_kw: bess.max_charge_kw,
            max_discharge_kw: bess.max_discharge_kw,
            soc_min_fraction: bess.soc_min_fraction,
            soc_max_fraction: bess.soc_max_fraction,
            initial_soc_fraction: bess.initial_soc_fraction,
            charge_efficiency: bess.charge_efficiency,
            discharge_efficiency: bess.discharge_efficiency,
            pcs_loss_fraction: bess.pcs_loss_fraction,
            calendar_fade_per_year: bess.calendar_fade_per_year,
            cycle_fade_per_efc: bess.cycle_fade_per_efc,
            eol_capacity_fraction: bess.eol_capacity_fraction,
            replacement_cost: bess.replacement_cost,
          }
        : { enabled: false },
      biomass: bioPayload,
      diesel: dieselPayload,
    },
    finance: {
      tax_model: cfg.finance.tax_model,
      revenue_mode: cfg.finance.revenue_mode,
      discount_rate: cfg.finance.discount_rate,
      tariff_escalation_rate: cfg.finance.tariff_escalation_rate,
      om_escalation_rate: cfg.finance.om_escalation_rate,
      fuel_escalation_rate: cfg.finance.fuel_escalation_rate,
      replacement_escalation_rate: cfg.finance.replacement_escalation_rate,
      electricity_tariff_per_kwh: cfg.finance.electricity_tariff_per_kwh,
      grid_import_tariff_per_kwh: cfg.finance.grid_import_tariff_per_kwh,
      grid_export_tariff_per_kwh: cfg.finance.grid_export_tariff_per_kwh,
      pv_capex_per_kwp: cfg.finance.pv_capex_per_kwp,
      bess_capex_per_kwh: cfg.finance.bess_capex_per_kwh,
      biomass_capex_per_kw: cfg.finance.biomass_capex_per_kw,
      diesel_capex_per_kw: cfg.finance.diesel_capex_per_kw ?? 4_500_000.0,
      bos_and_other_capex: cfg.finance.bos_and_other_capex,
      pv_om_fraction_of_capex: cfg.finance.pv_om_fraction_of_capex,
      bess_fixed_om_per_kwh_year: cfg.finance.bess_fixed_om_per_kwh_year,
      capital_grant_amount: cfg.finance.capital_grant_amount,
      tax_credit_fraction: cfg.finance.tax_credit_fraction,
      corporate_tax_rate: cfg.finance.corporate_tax_rate,
      inverter_replacement_year: cfg.finance.inverter_replacement_year,
      inverter_replacement_cost: cfg.finance.inverter_replacement_cost,
      bess_design_life_years: cfg.finance.bess_design_life_years,
      inverter_design_life_years: cfg.finance.inverter_design_life_years,
      biomass_overhaul_life_years: cfg.finance.biomass_overhaul_life_years,
      diesel_overhaul_life_years: cfg.finance.diesel_overhaul_life_years ?? 5.0,
      grid_emission_factor_kg_co2e_per_kwh: cfg.finance.grid_emission_factor_kg_co2e_per_kwh,
    },
    output_options: {
      include_hourly: true,
      include_daily: false,
      include_trace_reasons: true,
    },
  };
}

export async function runHybridSimulate(
  cfg: HybridProjectConfig,
  signal?: AbortSignal,
): Promise<HybridSimulateResponse> {
  return postJson<HybridSimulateResponse>("/v1/hybrid/simulate", buildHybridSimulatePayload(cfg), signal);
}

export async function submitHybridJob(
  cfg: HybridProjectConfig,
  signal?: AbortSignal,
): Promise<HybridJobStatusResponse> {
  return postJson<HybridJobStatusResponse>("/v1/hybrid/jobs", buildHybridSimulatePayload(cfg), signal);
}

export async function getHybridJob(jobId: string, signal?: AbortSignal): Promise<HybridJobStatusResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/hybrid/jobs/${encodeURIComponent(jobId)}`, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new NetworkError(`Tidak bisa terhubung ke mesin hitung di ${API_URL}.`);
  }
  if (res.status === 404 || res.status === 422) {
    const data = await res.json();
    throw new ApiError(parseProblems(data.detail));
  }
  if (!res.ok) {
    throw new NetworkError(`Gagal memeriksa status simulasi (HTTP ${res.status}).`);
  }
  return res.json();
}

function buildCompactBaseRequest(cfg: HybridProjectConfig): Record<string, unknown> {
  const payload = buildHybridSimulatePayload(cfg);
  return {
    ...payload,
    output_options: {
      include_hourly: false,
      include_daily: false,
      include_trace_reasons: false,
    },
  };
}

export async function submitHybridSweepJob(
  cfg: HybridProjectConfig,
  sweepInput: HybridSweepRequestInput,
  signal?: AbortSignal,
): Promise<HybridSweepJobResponse> {
  return postJson<HybridSweepJobResponse>(
    "/v1/hybrid/sweep/jobs",
    {
      contract_version: "0.7",
      base_request: buildCompactBaseRequest(cfg),
      sweep: {
        pv_capacity_kwp_values: sweepInput.pv_capacity_kwp_values,
        bess_capacity_kwh_values: sweepInput.bess_capacity_kwh_values,
        biomass_capacity_kw_values: sweepInput.biomass_capacity_kw_values,
        ...(sweepInput.diesel_capacity_kw_values
          ? { diesel_capacity_kw_values: sweepInput.diesel_capacity_kw_values }
          : {}),
        pv_inverter_sizing_mode: sweepInput.pv_inverter_sizing_mode,
        scale_replacement_costs: sweepInput.scale_replacement_costs,
      },
      constraints: {
        max_unmet_load_fraction: sweepInput.max_unmet_load_fraction,
        min_renewable_fraction: sweepInput.min_renewable_fraction,
      },
      ranking: {
        sort_by: sweepInput.sort_by,
        feasible_first: sweepInput.feasible_first,
      },
    },
    signal,
  );
}

export async function getHybridSweepJob(jobId: string, signal?: AbortSignal): Promise<HybridSweepJobResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/hybrid/sweep/jobs/${encodeURIComponent(jobId)}`, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new NetworkError(`Tidak bisa terhubung ke mesin hitung di ${API_URL}.`);
  }
  if (res.status === 404 || res.status === 422) {
    const data = await res.json();
    throw new ApiError(parseProblems(data.detail));
  }
  if (!res.ok) {
    throw new NetworkError(`Gagal memeriksa status sapuan (HTTP ${res.status}).`);
  }
  return res.json();
}

export async function cancelHybridSweepJob(jobId: string): Promise<HybridSweepJobResponse> {
  return postJson<HybridSweepJobResponse>(`/v1/hybrid/sweep/jobs/${encodeURIComponent(jobId)}/cancel`, {});
}

export async function runHybridSensitivity(
  cfg: HybridProjectConfig,
  options: {
    variables?: HybridSensitivityVariableId[];
    shifts?: number[];
    matrix?: {
      x_variable: HybridSensitivityVariableId;
      x_shifts: number[];
      y_variable: HybridSensitivityVariableId;
      y_shifts: number[];
    } | null;
  } = {},
  signal?: AbortSignal,
): Promise<HybridSensitivityResponse> {
  return postJson<HybridSensitivityResponse>(
    "/v1/hybrid/sensitivity",
    {
      contract_version: "0.7",
      base_request: buildCompactBaseRequest(cfg),
      ...(options.variables ? { variables: options.variables } : {}),
      ...(options.shifts ? { shifts: options.shifts } : {}),
      ...(options.matrix ? { matrix: options.matrix } : {}),
    },
    signal,
  );
}

export async function downloadHybridExcelReport(
  params: {
    cfg: HybridProjectConfig;
    result: HybridSimulateResponse;
    language: "id" | "en";
    sweepResult?: HybridSweepResult | null;
    sensitivityResult?: HybridSensitivityResponse | null;
  },
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const { hourly_year_1: _hourly, daily: _daily, ...compactResult } = params.result as HybridSimulateResponse & {
    daily?: unknown;
  };
  const body = {
    contract_version: "0.7",
    language: params.language,
    project_config: buildCompactBaseRequest(params.cfg),
    simulation_result: compactResult,
    sweep_result: params.sweepResult ?? null,
    sensitivity_result: params.sensitivityResult ?? null,
  };

  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/hybrid/export/excel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new NetworkError(`Tidak bisa terhubung ke mesin hitung di ${API_URL}.`);
  }

  if (res.status === 422 || res.status === 413 || res.status === 404) {
    const data = await res.json();
    throw new ApiError(parseProblems(data.detail));
  }
  if (!res.ok) {
    throw new NetworkError(`Gagal membuat berkas Excel di mesin hitung (HTTP ${res.status}).`);
  }

  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? "laporan-hybrid.xlsx";
  const blob = await res.blob();
  return { blob, filename };
}
