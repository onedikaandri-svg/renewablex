"""Skema Pydantic ketat untuk endpoint sistem hybrid Tahap 5."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class HybridStrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HybridWeatherPreviewRequest(HybridStrictModel):
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    timezone: str = Field(default="Asia/Jakarta", min_length=1, max_length=64)
    weather_source: Literal["pvgis_tmy", "custom_json"] = "pvgis_tmy"
    step_minutes: int = 60
    weather_data: dict[str, Any] | None = None


class HybridLoadProfileInput(HybridStrictModel):
    mode: Literal["synthetic", "csv"] = "synthetic"
    base_load_kw: float | None = None
    peak_load_kw: float | None = None
    seed: int = 42
    daily_profile: list[float] | None = None
    monthly_factors: list[float] | None = None
    noise_fraction: float = 0.05
    csv_text: str | None = None


class HybridLoadPreviewRequest(HybridStrictModel):
    step_minutes: int = 60
    timezone: str = Field(default="Asia/Jakarta", min_length=1, max_length=64)
    load_profile: HybridLoadProfileInput


class HybridProjectInput(HybridStrictModel):
    project_name: str = Field(min_length=1, max_length=120)
    latitude: float = Field(ge=-90.0, le=90.0)
    longitude: float = Field(ge=-180.0, le=180.0)
    elevation_m: float | None = None
    timezone: str = Field(default="Asia/Jakarta", min_length=1, max_length=64)
    currency_code: str = Field(default="IDR", pattern=r"^[A-Z]{3}$")


class HybridDispatchParamsInput(HybridStrictModel):
    allow_grid_import: bool = False
    allow_grid_export: bool = False
    target_soc_fraction: float = 0.80
    peak_limit_kw: float | None = None
    peak_hours: list[int] = Field(default_factory=lambda: [17, 18, 19, 20, 21])
    off_peak_hours: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5])
    tou_charge_soc_target: float = 0.90
    tou_discharge_soc_floor: float = 0.25


class HybridSimulationInput(HybridStrictModel):
    step_minutes: int = 60
    leap_day_policy: Literal["ignore_feb_29"] = "ignore_feb_29"
    weather_source: Literal["pvgis_tmy", "custom_json"] = "pvgis_tmy"
    weather_data: dict[str, Any] | None = None
    dispatch_strategy: Literal[
        "self_consumption",
        "load_following",
        "cycle_charging",
        "peak_shaving",
        "time_of_use_arbitrage",
    ] = "load_following"
    dispatch_params: HybridDispatchParamsInput = Field(default_factory=HybridDispatchParamsInput)
    project_lifetime_years: int = Field(default=25, ge=1, le=40)
    multi_year_mode: Literal["scaled_year_1", "full_hourly"] = "scaled_year_1"
    pv_annual_degradation_fraction: float | None = None
    scaled_bess_replacement_interval_years: int | None = None
    scaled_biomass_overhaul_interval_years: int | None = None


class HybridPVInput(HybridStrictModel):
    enabled: bool = True
    model: Literal["pvwatts_v1", "detailed_v1"] = "detailed_v1"
    capacity_kwp: float = Field(gt=0.0, le=10_000_000.0)
    inverter_ac_kw: float | None = Field(default=None, gt=0.0)
    decompose_ghi_if_missing: bool = True
    transposition_model: Literal["isotropic", "hay_davies", "perez"] = "perez"
    albedo: float = 0.2
    tracking_mode: Literal["fixed", "single_axis", "two_axis"] = "fixed"
    tilt_degrees: float = 10.0
    azimuth_degrees: float = 0.0
    max_angle_deg: float = 60.0
    backtracking: bool = True
    gcr: float = 0.35
    iam_b0: float = 0.05
    soiling_monthly: list[float] | None = None
    snow_loss_monthly: list[float] | None = None
    cell_temp_model: Literal["noct", "faiman"] = "faiman"
    noct_c: float = 45.0
    faiman_u0: float = 25.0
    faiman_u1: float = 6.84
    dc_model: Literal["pvwatts", "single_diode"] = "pvwatts"
    temp_coeff_per_c: float = -0.004
    i_sc: float = 13.8
    v_oc: float = 49.5
    i_mp: float = 13.0
    v_mp: float = 41.5
    alpha_sc: float = 0.0069
    beta_voc: float = -0.1386
    cells_in_series: int = 72
    n_modules_series: int | None = None
    n_strings_parallel: int | None = None
    system_loss_fraction: float = 0.14
    mismatch_fraction: float = 0.02
    dc_wiring_fraction: float = 0.02
    shading_fraction: float = 0.0
    availability_fraction: float = 0.01
    lid_fraction: float = 0.015
    annual_degradation_fraction: float = 0.005
    inverter_model: Literal["constant", "efficiency_curve"] = "constant"
    inverter_efficiency: float = 0.96
    efficiency_curve_points: list[list[float]] | None = None
    night_tare_kw: float = 0.0


class HybridBESSInput(HybridStrictModel):
    enabled: bool = False
    nominal_capacity_kwh: float = 0.0
    max_charge_kw: float | None = None
    max_discharge_kw: float | None = None
    c_rate_charge: float | None = None
    c_rate_discharge: float | None = None
    soc_min_fraction: float = 0.20
    soc_max_fraction: float = 0.95
    initial_soc_fraction: float = 0.50
    charge_efficiency: float = 0.94
    discharge_efficiency: float = 0.94
    pcs_loss_fraction: float = 0.02
    aux_load_kw: float = 0.0
    calendar_fade_per_year: float = 0.015
    cycle_fade_per_efc: float = 0.00005
    eol_capacity_fraction: float = 0.80
    replacement_cost: float = 0.0


class HybridBiomassInput(HybridStrictModel):
    enabled: bool = False
    plant_sample: str | None = None
    rated_capacity_kw: float | None = None
    min_load_fraction: float | None = None
    min_load_kw: float | None = None
    ramp_up_kw_per_hour: float | None = None
    ramp_down_kw_per_hour: float | None = None
    startup_time_hours: float | None = None
    shutdown_time_hours: float | None = None
    min_up_time_hours: float | None = None
    min_down_time_hours: float | None = None
    startup_fuel_tons: float | None = None
    fuel_curve_model: Literal["piecewise_heat_rate", "piecewise_efficiency", "willans_linear"] | None = None
    fuel_curve_points: list[list[float]] | None = None
    no_load_fuel_kw_th: float | None = None
    slope_kw_th_per_kw_el: float | None = None
    fuel_preset: Literal["efb", "wood_pellet", "pks", "woodchip", "rice_husk", "custom"] | None = None
    fuel_name: str | None = None
    moisture_fraction: float | None = None
    lhv_mj_per_kg: float | None = None
    lhv_basis: Literal["as_received", "dry"] | None = None
    fuel_price_per_ton: float | None = None
    logistics_cost_per_ton: float | None = None
    supply_period: Literal["unlimited", "daily", "monthly", "annual"] | None = None
    supply_limit_tons: float | None = None
    scheduled_outage_windows: list[dict[str, Any]] | None = None
    unplanned_outage_rate: float | None = None
    mean_time_to_repair_hours: float | None = None
    outage_seed: int | None = None
    fixed_om_per_kw_year: float | None = None
    variable_om_per_kwh: float | None = None
    startup_cost: float | None = None
    overhaul_interval_operating_hours: float | None = None
    overhaul_cost: float | None = None
    emission_factor_kg_co2e_per_kg_fuel: float | None = None
    emission_factor_kg_co2e_per_kwh: float | None = None
    supply_chain_emission_kg_co2e_per_ton: float | None = None
    biogenic_co2_accounting: Literal["zero_net", "gross"] | None = None
    is_renewable: bool | None = None
    emission_source_note: str | None = None
    chp_enabled: bool | None = None
    heat_to_power_ratio: float | None = None
    thermal_efficiency_fraction: float | None = None


class HybridComponentsInput(HybridStrictModel):
    pv: HybridPVInput
    bess: HybridBESSInput | None = None
    biomass: HybridBiomassInput | None = None


class HybridFinanceInput(HybridStrictModel):
    currency_code: str | None = None
    tax_model: Literal["pre_tax", "after_tax"] = "pre_tax"
    revenue_mode: Literal["avoided_cost", "ppa_generation"] = "avoided_cost"
    discount_rate: float = 0.10
    general_inflation_rate: float = 0.0
    tariff_escalation_rate: float = 0.02
    om_escalation_rate: float = 0.02
    fuel_escalation_rate: float = 0.02
    replacement_escalation_rate: float = 0.0
    electricity_tariff_per_kwh: float = 1445.0
    grid_import_tariff_per_kwh: float = 1445.0
    grid_export_tariff_per_kwh: float = 0.0
    unmet_load_penalty_per_kwh: float = 0.0
    pv_capex: float | None = None
    pv_capex_per_kwp: float = 11_500_000.0
    bess_capex: float | None = None
    bess_capex_per_kwh: float = 3_500_000.0
    biomass_capex: float | None = None
    biomass_capex_per_kw: float = 18_000_000.0
    bos_and_other_capex: float = 0.0
    capital_grant_amount: float = 0.0
    capital_grant_fraction: float = 0.0
    tax_credit_fraction: float = 0.0
    pv_fixed_om_per_kwp_year: float = 0.0
    pv_om_fraction_of_capex: float | None = 0.015
    bess_fixed_om_per_kwh_year: float = 50_000.0
    bess_om_fraction_of_capex: float | None = None
    biomass_fixed_om_override: float | None = None
    inverter_replacement_year: int | None = 13
    inverter_replacement_cost: float = 420_000_000.0
    bess_design_life_years: float | None = 10.0
    inverter_design_life_years: float | None = 12.0
    biomass_overhaul_life_years: float | None = 5.0
    residual_salvage_fraction_of_capex: float = 0.0
    corporate_tax_rate: float = 0.22
    depreciation_years: int | None = None
    grid_emission_factor_kg_co2e_per_kwh: float = 0.78
    viability_irr_margin: float = 0.02


class HybridOutputOptions(HybridStrictModel):
    include_hourly: bool = True
    include_daily: bool = False
    include_trace_reasons: bool = True


class HybridSimulateRequest(HybridStrictModel):
    contract_version: Literal["0.5", "0.6"] = "0.5"
    project: HybridProjectInput
    simulation: HybridSimulationInput = Field(default_factory=HybridSimulationInput)
    load_profile: HybridLoadProfileInput
    components: HybridComponentsInput
    finance: HybridFinanceInput | None = None
    output_options: HybridOutputOptions = Field(default_factory=HybridOutputOptions)


class HybridSweepAxisConfig(HybridStrictModel):
    pv_capacity_kwp_values: list[float]
    bess_capacity_kwh_values: list[float]
    biomass_capacity_kw_values: list[float]
    pv_inverter_sizing_mode: Literal["keep_dc_ac_ratio", "fixed"] = "keep_dc_ac_ratio"
    scale_replacement_costs: bool = True
    bess_replacement_cost_per_kwh: float | None = Field(default=None, ge=0.0)


class HybridSweepConstraints(HybridStrictModel):
    max_unmet_load_fraction: float | None = Field(default=None, ge=0.0, le=1.0)
    min_renewable_fraction: float | None = Field(default=None, ge=0.0, le=1.0)


class HybridSweepRanking(HybridStrictModel):
    sort_by: Literal[
        "lcoe_asc",
        "total_npc_asc",
        "npv_desc",
        "irr_desc",
        "renewable_fraction_desc",
    ] = "lcoe_asc"
    feasible_first: bool = True


class HybridSweepJobRequest(HybridStrictModel):
    contract_version: Literal["0.6"] = "0.6"
    base_request: HybridSimulateRequest
    sweep: HybridSweepAxisConfig
    constraints: HybridSweepConstraints = Field(default_factory=HybridSweepConstraints)
    ranking: HybridSweepRanking = Field(default_factory=HybridSweepRanking)


class HybridSensitivityMatrixInput(HybridStrictModel):
    x_variable: str
    x_shifts: list[float]
    y_variable: str
    y_shifts: list[float]


class HybridSensitivityRequest(HybridStrictModel):
    contract_version: Literal["0.6"] = "0.6"
    base_request: HybridSimulateRequest
    variables: list[str] | None = None
    shifts: list[float] | None = None
    matrix: HybridSensitivityMatrixInput | None = None


class HybridExcelExportRequest(HybridStrictModel):
    contract_version: Literal["0.6"] = "0.6"
    language: Literal["id", "en"] = "id"
    project_config: dict[str, Any]
    simulation_result: dict[str, Any]
    sweep_result: dict[str, Any] | None = None
    sensitivity_result: dict[str, Any] | None = None
