export type DispatchStrategyId =
  | "self_consumption"
  | "load_following"
  | "cycle_charging"
  | "peak_shaving"
  | "time_of_use_arbitrage";

export type MultiYearMode = "scaled_year_1" | "full_hourly";
export type BiomassPresetId = "efb" | "wood_pellet" | "pks" | "woodchip" | "rice_husk";
export type BiomassPlantSampleId = "sample_gasifier_250kw" | "sample_steam_turbine_1000kw";
export type DieselFuelCurveModel = "willans_linear" | "piecewise_sfc";

export type TopologyNodeKind = "ac_bus" | "pv" | "bess" | "biomass" | "diesel" | "load" | "grid";

export type TopologyEdgeFlowType =
  | "dc_ac_generation"
  | "bidirectional_storage"
  | "ac_generation"
  | "ac_load"
  | "bidirectional_grid";

export interface TopologyNode {
  id: string;
  kind: TopologyNodeKind;
  label?: string;
  x: number;
  y: number;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  flowType: TopologyEdgeFlowType;
}

export interface TopologyViewport {
  panX: number;
  panY: number;
  zoom: number;
}

export interface HybridSystemTopology {
  version: "1.0";
  viewport: TopologyViewport;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export type TopologyIssueSeverity = "error" | "warning";

export type TopologyIssueCode =
  | "missing_ac_bus"
  | "missing_pv_node"
  | "pv_not_connected"
  | "missing_load_node"
  | "load_not_connected"
  | "invalid_edge_connection"
  | "invalid_component_params"
  | "disconnected_optional_node"
  | "pv_dc_ac_ratio_warning";

export interface TopologyIssue {
  code: TopologyIssueCode;
  severity: TopologyIssueSeverity;
  nodeId?: string;
  field?: string;
  messageId: string;
  messageEn: string;
}

export interface TopologyValidationResult {
  valid: boolean;
  errors: TopologyIssue[];
  warnings: TopologyIssue[];
}

export interface HybridDieselComponentConfig {
  enabled: boolean;
  rated_capacity_kw: number;
  min_load_fraction: number;
  fuel_curve_model: DieselFuelCurveModel;
  no_load_fuel_liters_per_hour: number | null;
  slope_liters_per_kwh: number;
  min_run_time_hours: number;
  min_down_time_hours: number;
  fuel_price_per_liter: number;
  fixed_om_per_kw_year: number;
  variable_om_per_operating_hour: number;
  startup_cost: number;
  overhaul_interval_operating_hours: number;
  overhaul_cost: number;
  emission_factor_kg_co2e_per_liter: number;
}

export interface HybridCustomWeatherData {
  metadata?: {
    provider?: string;
    dataset?: string | null;
    dataset_version?: string | null;
    period?: string | null;
    latitude?: number;
    longitude?: number;
    elevation_m?: number | null;
    retrieved_at?: string;
  };
  hourly: {
    ghi_w_m2: number[];
    dni_w_m2: number[];
    dhi_w_m2: number[];
    temp_air_c: number[];
    wind_speed_m_s: number[];
  };
}

export interface HybridProjectConfig {
  id: string;
  schemaVersion: "0.5" | "0.6" | "0.7";
  updatedAt: string;
  topology?: HybridSystemTopology;
  project: {
    project_name: string;
    latitude: number;
    longitude: number;
    elevation_m: number | null;
    timezone: string;
    currency_code: "IDR" | "USD";
  };
  simulation: {
    step_minutes: 60;
    leap_day_policy: "ignore_feb_29";
    weather_source: "pvgis_tmy" | "custom_json";
    weather_data?: HybridCustomWeatherData | null;
    weather_filename?: string;
    dispatch_strategy: DispatchStrategyId;
    dispatch_params: {
      allow_grid_import: boolean;
      allow_grid_export: boolean;
      target_soc_fraction: number;
      peak_limit_kw: number | null;
      peak_hours: number[];
      off_peak_hours: number[];
      tou_charge_soc_target: number;
      tou_discharge_soc_floor: number;
    };
    project_lifetime_years: number;
    multi_year_mode: MultiYearMode;
  };
  load_profile: {
    mode: "synthetic" | "csv";
    base_load_kw: number;
    peak_load_kw: number;
    seed: number;
    noise_fraction: number;
    daily_profile: number[] | null;
    monthly_factors: number[] | null;
    csv_text: string;
    csv_filename: string;
  };
  components: {
    pv: {
      enabled: boolean;
      model: "pvwatts_v1" | "detailed_v1";
      capacity_kwp: number;
      inverter_ac_kw: number;
      transposition_model: "isotropic" | "hay_davies" | "perez";
      albedo?: number;
      tracking_mode: "fixed" | "single_axis" | "two_axis";
      tilt_degrees: number;
      azimuth_degrees: number;
      iam_b0?: number;
      soiling_monthly?: number[] | null;
      cell_temp_model: "noct" | "faiman";
      noct_c?: number;
      faiman_u0?: number;
      faiman_u1?: number;
      dc_model: "pvwatts" | "single_diode";
      temp_coeff_per_c?: number;
      i_sc?: number;
      v_oc?: number;
      i_mp?: number;
      v_mp?: number;
      alpha_sc?: number;
      beta_voc?: number;
      cells_in_series?: number;
      system_loss_fraction: number;
      mismatch_fraction?: number;
      dc_wiring_fraction?: number;
      shading_fraction?: number;
      availability_fraction?: number;
      lid_fraction?: number;
      annual_degradation_fraction: number;
      inverter_efficiency: number;
      night_tare_kw?: number;
    };
    bess: {
      enabled: boolean;
      nominal_capacity_kwh: number;
      max_charge_kw: number;
      max_discharge_kw: number;
      soc_min_fraction: number;
      soc_max_fraction: number;
      initial_soc_fraction: number;
      charge_efficiency: number;
      discharge_efficiency: number;
      pcs_loss_fraction: number;
      aux_load_kw?: number;
      calendar_fade_per_year: number;
      cycle_fade_per_efc: number;
      eol_capacity_fraction: number;
      replacement_cost: number;
    };
    biomass: {
      enabled: boolean;
      plant_sample: BiomassPlantSampleId | null;
      rated_capacity_kw: number;
      min_load_fraction: number;
      fuel_preset: BiomassPresetId;
      supply_period: "unlimited" | "daily" | "monthly" | "annual";
      supply_limit_tons: number;
      fuel_price_per_ton: number | null;
      logistics_cost_per_ton: number | null;
      moisture_fraction: number | null;
      fixed_om_per_kw_year: number;
      variable_om_per_kwh: number;
      overhaul_interval_operating_hours: number;
      overhaul_cost: number;
    };
    diesel: HybridDieselComponentConfig;
  };
  finance: {
    tax_model: "pre_tax" | "after_tax";
    revenue_mode: "avoided_cost" | "ppa_generation";
    discount_rate: number;
    tariff_escalation_rate: number;
    om_escalation_rate: number;
    fuel_escalation_rate: number;
    replacement_escalation_rate: number;
    electricity_tariff_per_kwh: number;
    grid_import_tariff_per_kwh: number;
    grid_export_tariff_per_kwh: number;
    pv_capex_per_kwp: number;
    bess_capex_per_kwh: number;
    biomass_capex_per_kw: number;
    diesel_capex_per_kw: number;
    bos_and_other_capex: number;
    pv_om_fraction_of_capex: number;
    bess_fixed_om_per_kwh_year: number;
    capital_grant_amount: number;
    tax_credit_fraction: number;
    corporate_tax_rate: number;
    inverter_replacement_year: number | null;
    inverter_replacement_cost: number;
    bess_design_life_years: number;
    inverter_design_life_years: number;
    biomass_overhaul_life_years: number;
    diesel_overhaul_life_years: number;
    grid_emission_factor_kg_co2e_per_kwh: number;
  };
  weatherPreview?: HybridWeatherPreviewResponse | null;
  loadPreview?: HybridLoadPreviewResponse | null;
}

export interface HybridWeatherPreviewResponse {
  engine_version: string;
  contract_version: string;
  weather_source: {
    provider: string;
    dataset: string | null;
    dataset_version: string | null;
    period: string | null;
    latitude: number;
    longitude: number;
    elevation_m: number | null;
    timezone: string;
    timezone_offset_hours: number;
    retrieved_at: string;
  };
  annual_summary: {
    steps_count: number;
    total_ghi_kwh_m2: number;
    total_dni_kwh_m2: number;
    total_dhi_kwh_m2: number;
    avg_temp_c: number;
    min_temp_c: number;
    max_temp_c: number;
    avg_wind_m_s: number;
  };
  monthly: Array<{
    month: number;
    ghi_kwh_m2: number;
    dni_kwh_m2: number;
    dhi_kwh_m2: number;
    avg_temp_c: number;
    avg_wind_m_s: number;
  }>;
}

export interface HybridLoadPreviewResponse {
  engine_version: string;
  contract_version: string;
  source: string;
  summary: {
    steps_count: number;
    step_minutes: number;
    total_load_kwh: number;
    peak_load_kw: number;
    min_load_kw: number;
    average_load_kw: number;
    load_factor: number;
  };
  daily_average_24h: Array<{
    hour: number;
    avg_kw: number;
    min_kw: number;
    max_kw: number;
  }>;
  monthly: Array<{
    month: number;
    load_kwh: number;
    peak_kw: number;
  }>;
  hourly_load_kw: number[];
}

export interface HybridPresetsResponse {
  engine_version: string;
  contract_version: string;
  fuel_presets: Record<string, {
    fuel_name: string;
    moisture_fraction: number;
    lhv_mj_per_kg: number;
    lhv_basis: string;
    fuel_price_per_ton: number;
    logistics_cost_per_ton: number;
    supply_chain_emission_kg_co2e_per_ton: number;
  }>;
  plant_samples: Record<string, {
    rated_capacity_kw: number;
    min_load_fraction: number;
    overhaul_interval_operating_hours: number;
  }>;
  diesel_defaults?: Record<string, unknown>;
  dispatch_strategies: Array<{
    id: DispatchStrategyId;
    name_id: string;
    name_en: string;
    description_id: string;
    description_en: string;
    default_params: Record<string, unknown>;
  }>;
  location_presets: Array<{
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    elevation_m: number;
    timezone: string;
  }>;
  sample_config: Record<string, unknown>;
}

export interface HybridMonthlyRow {
  month: number;
  load_kwh: number;
  pv_generation_kwh: number;
  biomass_generation_kwh: number;
  diesel_generation_kwh?: number;
  bess_charge_kwh: number;
  bess_discharge_kwh: number;
  grid_import_kwh: number;
  grid_export_kwh: number;
  served_load_kwh: number;
  unmet_load_kwh: number;
  curtailment_kwh: number;
}

export interface HybridCashFlowRow {
  year: number;
  served_load_kwh: number;
  pv_generation_kwh: number;
  biomass_generation_kwh: number;
  diesel_generation_kwh?: number;
  grid_import_kwh: number;
  capex_outflow: number;
  gross_revenue_or_savings: number;
  export_revenue: number;
  om_cost: number;
  fuel_and_logistics_cost: number;
  grid_import_cost: number;
  unmet_load_penalty: number;
  replacement_and_overhaul_cost: number;
  salvage_inflow: number;
  tax_outflow: number;
  net_cash_flow: number;
  discounted_cash_flow: number;
  cumulative_cash_flow: number;
  cumulative_discounted_cash_flow: number;
}

export interface HybridSimulateResponse {
  engine_version: string;
  contract_version: string;
  config_hash: string;
  calculated_at: string;
  project_name: string;
  dispatch_strategy: string | null;
  weather_source: HybridWeatherPreviewResponse["weather_source"];
  summary: {
    steps_count: number;
    step_minutes: number;
    total_load_kwh: number;
    pv_generation_kwh: number;
    biomass_generation_kwh: number;
    diesel_generation_kwh?: number;
    served_load_kwh: number;
    unmet_load_kwh: number;
    curtailment_kwh: number;
    renewable_fraction: number;
    pv_capacity_factor: number;
    pv_specific_yield_kwh_per_kwp: number;
    max_balance_error_kw: number;
  };
  pv_loss_breakdown_kwh: Record<string, number>;
  monthly: HybridMonthlyRow[];
  bess_summary: {
    total_charge_kwh: number;
    total_discharge_kwh: number;
    conversion_losses_kwh: number;
    aux_load_kwh: number;
    equivalent_full_cycles: number;
    final_soc_fraction: number;
    final_effective_capacity_kwh: number;
    replacement_count: number;
  } | null;
  biomass_summary: {
    fuel_name: string;
    fuel_preset: string | null;
    total_generation_kwh: number;
    total_operating_hours: number;
    startup_count: number;
    overhaul_count: number;
    total_fuel_tons: number;
    total_fuel_cost: number;
    total_logistics_cost: number;
    total_variable_om_cost: number;
    total_fixed_om_cost: number;
    total_startup_cost: number;
    total_co2e_kg: number;
    total_thermal_output_kwh_th: number;
    is_renewable: boolean;
  } | null;
  diesel_summary?: {
    total_generation_kwh: number;
    total_operating_hours: number;
    startup_count: number;
    overhaul_count: number;
    total_fuel_liters: number;
    total_fuel_cost: number;
    total_variable_om_cost: number;
    total_fixed_om_cost: number;
    total_startup_cost: number;
    total_co2e_kg: number;
    is_renewable: boolean;
  } | null;
  lifetime_summary: {
    project_lifetime_years: number;
    multi_year_mode: MultiYearMode;
    total_load_kwh: number;
    total_pv_generation_kwh: number;
    total_biomass_generation_kwh: number;
    total_diesel_generation_kwh?: number;
    total_served_load_kwh: number;
    total_unmet_load_kwh: number;
    total_curtailment_kwh: number;
    total_grid_import_kwh: number;
    total_grid_export_kwh: number;
    total_bess_replacements: number;
    total_biomass_overhauls: number;
    total_diesel_overhauls?: number;
    max_balance_error_kw: number;
    lifecycle_events: Array<{
      year: number;
      event_type: string;
      description: string;
      cost_amount: number;
    }>;
    yearly?: Array<{
      year: number;
      pv_degradation_factor: number;
      total_load_kwh: number;
      pv_generation_kwh: number;
      biomass_generation_kwh: number;
      diesel_generation_kwh?: number;
      served_load_kwh: number;
      unmet_load_kwh: number;
      curtailment_kwh: number;
      grid_import_kwh: number;
      grid_export_kwh: number;
      renewable_fraction: number;
      bess_yearly_efc: number;
      bess_final_effective_capacity_kwh: number;
      bess_replacement_count: number;
      biomass_fuel_tons: number;
      biomass_overhaul_count: number;
      diesel_fuel_liters?: number;
      diesel_overhaul_count?: number;
    }>;
  };
  finance_summary: {
    currency_code: string;
    tax_model: "pre_tax" | "after_tax";
    revenue_mode: "avoided_cost" | "ppa_generation";
    project_lifetime_years: number;
    discount_rate: number;
    gross_capex: number;
    capital_grant: number;
    net_capex: number;
    total_npc: number;
    lcoe: number;
    npv: number;
    irr: number | null;
    irr_status: "ok" | "no_sign_change" | "ambiguous" | "not_found";
    simple_payback_years: number | null;
    simple_payback_status: "recovered" | "not_recovered";
    discounted_payback_years: number | null;
    discounted_payback_status: "recovered" | "not_recovered";
    viability_status: "viable" | "marginal" | "unviable";
    total_discounted_energy_kwh: number;
    total_undiscounted_revenue: number;
    total_undiscounted_opex_and_fuel: number;
    total_undiscounted_replacements: number;
    total_salvage_value: number;
  } | null;
  lcoe_breakdown: Record<string, number> | null;
  emissions_summary: {
    grid_emission_factor_kg_co2e_per_kwh: number;
    baseline_grid_emissions_kg_co2e: number;
    project_emissions_kg_co2e: number;
    avoided_emissions_kg_co2e: number;
    avoided_emissions_tons_co2e: number;
  } | null;
  cashflow_schedule: HybridCashFlowRow[];
  hourly_year_1?: {
    steps_count: number;
    step_minutes: number;
    local_time: string[];
    load_kw: number[];
    pv_generation_kw: number[];
    biomass_generation_kw: number[];
    diesel_generation_kw?: number[];
    diesel_fuel_liters?: number[];
    bess_charge_kw: number[];
    bess_discharge_kw: number[];
    grid_import_kw: number[];
    grid_export_kw: number[];
    served_load_kw: number[];
    unmet_load_kw: number[];
    curtailment_kw: number[];
    losses_kw: number[];
    bess_soc_fraction: number[] | null;
    biomass_status: string[] | null;
    diesel_status?: string[] | null;
    trace_reason: string[] | null;
  };
  warnings: string[];
  warning_codes: string[];
}

export interface HybridJobStatusResponse {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress_percent: number;
  current_step_label: string;
  created_at?: string;
  result?: HybridSimulateResponse | null;
  error?: { code: string; msg: string } | null;
}

export type SweepSortBy =
  | "lcoe_asc"
  | "total_npc_asc"
  | "npv_desc"
  | "irr_desc"
  | "renewable_fraction_desc";

export interface HybridSweepCombination {
  rank: number;
  combination_id: string;
  feasible: boolean;
  infeasible_reasons: string[];
  sizing: {
    pv_capacity_kwp: number;
    pv_inverter_ac_kw: number;
    bess_enabled: boolean;
    bess_nominal_capacity_kwh: number;
    bess_max_charge_kw: number;
    bess_max_discharge_kw: number;
    biomass_enabled: boolean;
    biomass_rated_capacity_kw: number;
    diesel_enabled?: boolean;
    diesel_rated_capacity_kw?: number;
  };
  technical: {
    pv_generation_kwh: number;
    biomass_generation_kwh: number;
    diesel_generation_kwh?: number;
    served_load_kwh: number;
    unmet_load_kwh: number;
    unmet_load_fraction: number;
    curtailment_kwh: number;
    renewable_fraction: number;
    bess_equivalent_full_cycles: number;
    biomass_fuel_tons: number;
    diesel_fuel_liters?: number;
    avoided_emissions_tons_co2e: number;
  };
  finance: {
    currency_code: string;
    gross_capex: number;
    net_capex: number;
    total_npc: number;
    lcoe: number;
    npv: number;
    irr: number | null;
    irr_status: "ok" | "no_sign_change" | "ambiguous" | "not_found";
    simple_payback_years: number | null;
    discounted_payback_years: number | null;
    viability_status: "viable" | "marginal" | "unviable";
  };
}

export interface HybridSweepResult {
  sort_by: SweepSortBy;
  feasible_count: number;
  total_combinations: number;
  best_combination_id: string | null;
  weather_source: HybridWeatherPreviewResponse["weather_source"];
  combinations: HybridSweepCombination[];
}

export interface HybridSweepJobResponse {
  job_id: string;
  engine_version?: string;
  contract_version?: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress_percent: number;
  completed_combinations: number;
  total_combinations: number;
  current_step_label: string;
  created_at?: string;
  result?: HybridSweepResult | null;
  error?: { code: string; msg: string } | null;
}

export interface HybridSweepRequestInput {
  pv_capacity_kwp_values: number[];
  bess_capacity_kwh_values: number[];
  biomass_capacity_kw_values: number[];
  diesel_capacity_kw_values?: number[];
  pv_inverter_sizing_mode: "keep_dc_ac_ratio" | "fixed";
  scale_replacement_costs: boolean;
  max_unmet_load_fraction: number | null;
  min_renewable_fraction: number | null;
  sort_by: SweepSortBy;
  feasible_first: boolean;
}

export type HybridSensitivityVariableId =
  | "capex_total"
  | "electricity_tariff"
  | "discount_rate"
  | "biomass_fuel_price"
  | "diesel_fuel_price"
  | "om_total"
  | "pv_degradation_rate"
  | "load_scale"
  | "pv_capacity";

export interface HybridSensitivityCase {
  shift_fraction: number;
  input_value: number;
  npv: number;
  npv_delta: number;
  lcoe: number;
  lcoe_delta: number;
  irr: number | null;
  irr_status: "ok" | "no_sign_change" | "ambiguous" | "not_found";
  simple_payback_years: number | null;
  discounted_payback_years: number | null;
  viability_status: "viable" | "marginal" | "unviable";
}

export interface HybridSensitivityVariableResult {
  variable: HybridSensitivityVariableId;
  category: "finance_only" | "technical";
  base_value: number;
  unit: string;
  skipped: boolean;
  skip_reason: string | null;
  zero_base: boolean;
  max_abs_npv_delta: number;
  max_abs_lcoe_delta: number;
  cases: HybridSensitivityCase[];
}

export interface HybridSensitivityMatrixCell {
  x_index: number;
  y_index: number;
  x_shift: number;
  y_shift: number;
  npv: number;
  npv_delta: number;
  lcoe: number;
  lcoe_delta: number;
  irr: number | null;
  viability_status: "viable" | "marginal" | "unviable";
}

export interface HybridSensitivityResponse {
  engine_version: string;
  contract_version: string;
  calculated_at: string;
  currency_code: string;
  base: {
    npv: number;
    lcoe: number;
    total_npc: number;
    irr: number | null;
    irr_status: string;
    simple_payback_years: number | null;
    discounted_payback_years: number | null;
    viability_status: "viable" | "marginal" | "unviable";
  };
  variables: HybridSensitivityVariableResult[];
  matrix_result: {
    x_variable: HybridSensitivityVariableId;
    x_shifts: number[];
    y_variable: HybridSensitivityVariableId;
    y_shifts: number[];
    cells: HybridSensitivityMatrixCell[];
  } | null;
}
