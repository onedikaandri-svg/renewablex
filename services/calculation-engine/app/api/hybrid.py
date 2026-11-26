"""Endpoint HTTP FastAPI untuk sistem energi hybrid RenewableX (Tahap 5, 7, dan 8B)."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import datetime, timezone
import re
import threading
import time
from typing import Any
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, Response
import numpy as np

from app.api.hybrid_schemas import (
    HybridExcelExportRequest,
    HybridLoadPreviewRequest,
    HybridLoadProfileInput,
    HybridSensitivityRequest,
    HybridSimulateRequest,
    HybridSweepJobRequest,
    HybridWeatherPreviewRequest,
)
from app.errors import EngineError
from app.hybrid.bess import BESSComponent
from app.hybrid.biomass import BIOMASS_FUEL_PRESETS, BIOMASS_PLANT_SAMPLES, BiomassComponent
from app.hybrid.cli import (
    _parse_bess_config,
    _parse_biomass_config,
    _parse_diesel_config,
    _parse_dispatch_config,
    _parse_pv_config,
)
from app.hybrid.diesel import (
    DEFAULT_DIESEL_EMISSION_FACTOR_KG_PER_LITER,
    DEFAULT_DIESEL_FIXED_OM_IDR,
    DEFAULT_DIESEL_FUEL_PRICE_IDR,
    DEFAULT_DIESEL_MIN_LOAD_FRACTION,
    DEFAULT_DIESEL_OVERHAUL_HOURS,
    DEFAULT_DIESEL_SLOPE_L_PER_KWH,
    DieselComponent,
)
from app.hybrid.excel_export import build_hybrid_excel_bytes
from app.hybrid.finance import (
    FinanceResult,
    resolve_finance_config,
    resolve_lifetime_config,
    run_financial_analysis,
)
from app.hybrid.lifetime import LifetimeSimulationResult, run_lifetime_simulation
from app.hybrid.load import LoadProfile, generate_synthetic_load, load_profile_from_csv
from app.hybrid.sensitivity import run_hybrid_sensitivity
from app.hybrid.simulator import SimulationConfig, SimulationResult
from app.hybrid.sweep import run_hybrid_sweep, validate_sweep_axis, validate_sweep_limits
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import PVGISTMYWeatherProvider, WeatherDataset, load_weather_from_json
from app.providers.base import ResourceError, ResourceErrorKind
from app.version import ENGINE_VERSION

router = APIRouter(prefix="/v1/hybrid", tags=["hybrid"])

CONTRACT_VERSION = "0.5"
STAGE7_CONTRACT_VERSION = "0.6"
STAGE8B_CONTRACT_VERSION = "0.7"
MAX_JOBS = 50
JOB_TTL_SECONDS = 1800.0
MAX_SWEEP_JOBS = 15
SWEEP_JOB_TTL_SECONDS = 1800.0

_weather_provider = PVGISTMYWeatherProvider(cache_ttl_seconds=3600.0)
_job_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="hybrid-sim")
_jobs_lock = threading.Lock()
_jobs_store: dict[str, dict[str, Any]] = {}

_sweep_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="hybrid-sweep")
_sweep_jobs_lock = threading.Lock()
_sweep_jobs_store: dict[str, dict[str, Any]] = {}

LOCATION_PRESETS: list[dict[str, Any]] = [
    {"id": "jakarta", "name": "Jakarta (Jawa Barat) [REAL DATA]", "latitude": -6.20, "longitude": 106.80, "elevation_m": 12.0, "timezone": "Asia/Jakarta"},
    {"id": "cikarang", "name": "Cikarang Kawasan Industri [REAL DATA]", "latitude": -6.28, "longitude": 107.15, "elevation_m": 25.0, "timezone": "Asia/Jakarta"},
    {"id": "surabaya", "name": "Surabaya (Jawa Timur) [REAL DATA]", "latitude": -7.25, "longitude": 112.75, "elevation_m": 5.0, "timezone": "Asia/Jakarta"},
    {"id": "medan", "name": "Medan (Sumatera Utara) [REAL DATA]", "latitude": 3.59, "longitude": 98.67, "elevation_m": 25.0, "timezone": "Asia/Jakarta"},
    {"id": "makassar", "name": "Makassar (Sulawesi Selatan) [REAL DATA]", "latitude": -5.14, "longitude": 119.43, "elevation_m": 8.0, "timezone": "Asia/Makassar"},
    {"id": "kupang", "name": "Kupang (NTT) [REAL DATA]", "latitude": -10.17, "longitude": 123.61, "elevation_m": 45.0, "timezone": "Asia/Makassar"},
]

DISPATCH_STRATEGIES: list[dict[str, Any]] = [
    {
        "id": "self_consumption",
        "name_id": "Konsumsi Sendiri (Self-Consumption)",
        "name_en": "Self-Consumption",
        "description_id": "Surplus PV mengisi baterai terlebih dahulu; kekurangan beban ditutup baterai, biomass, lalu diesel bila aktif.",
        "description_en": "PV surplus charges BESS first; load deficit is covered by BESS discharge, biomass, and then diesel if enabled.",
        "default_params": {"allow_grid_import": False, "allow_grid_export": False},
    },
    {
        "id": "load_following",
        "name_id": "Mengikuti Beban (Load Following)",
        "name_en": "Load Following",
        "description_id": "Baterai, biomass, dan diesel menyesuaikan keluaran hanya untuk menutup sisa beban bersih setelah PV.",
        "description_en": "BESS, biomass, and diesel adjust output solely to cover residual net load after PV.",
        "default_params": {"allow_grid_import": False, "allow_grid_export": False},
    },
    {
        "id": "cycle_charging",
        "name_id": "Pengisian Siklus (Cycle Charging)",
        "name_en": "Cycle Charging",
        "description_id": "Saat pembangkit biomass, diesel, atau sumber pengisi aktif, baterai ikut diisi sampai target SOC.",
        "description_en": "When biomass, diesel, or charging supply runs, it operates higher to charge BESS toward target SOC.",
        "default_params": {"allow_grid_import": False, "allow_grid_export": False, "target_soc_fraction": 0.80},
    },
    {
        "id": "peak_shaving",
        "name_id": "Pemangkasan Beban Puncak (Peak Shaving)",
        "name_en": "Peak Shaving",
        "description_id": "Baterai, biomass, dan diesel memangkas beban di atas batas puncak agar daya sumber lain tetap terkendali.",
        "description_en": "BESS, biomass, and diesel shave peak load above the configured peak limit.",
        "default_params": {"allow_grid_import": True, "allow_grid_export": False, "peak_limit_kw": 250.0},
    },
    {
        "id": "time_of_use_arbitrage",
        "name_id": "Arbitrase Tarif Waktu (Time-of-Use)",
        "name_en": "Time-of-Use Arbitrage",
        "description_id": "Baterai mengisi saat jam luar puncak atau surplus PV, lalu melepaskan energi pada jam tarif puncak.",
        "description_en": "BESS charges during off-peak hours or PV surplus and discharges during peak tariff hours.",
        "default_params": {
            "allow_grid_import": True,
            "allow_grid_export": False,
            "peak_hours": [17, 18, 19, 20, 21],
            "off_peak_hours": [0, 1, 2, 3, 4, 5],
            "tou_charge_soc_target": 0.90,
            "tou_discharge_soc_floor": 0.25,
        },
    },
]


def _raise_engine_error(exc: EngineError) -> None:
    raise HTTPException(
        status_code=422,
        detail=[{
            "type": "value_error",
            "code": exc.code,
            "loc": ["body"],
            "msg": str(exc),
        }],
    ) from exc


def _map_resource_error(exc: ResourceError) -> tuple[str, str]:
    code = {
        ResourceErrorKind.OUT_OF_COVERAGE: "out_of_coverage",
        ResourceErrorKind.UNAVAILABLE: "provider_unavailable",
        ResourceErrorKind.TIMEOUT: "provider_timeout",
        ResourceErrorKind.INVALID_RESPONSE: "provider_invalid_response",
    }.get(exc.kind, "provider_error")
    return code, str(exc)


def _raise_resource_error(exc: ResourceError) -> None:
    code, msg = _map_resource_error(exc)
    raise HTTPException(
        status_code=422,
        detail=[{
            "type": "value_error",
            "code": code,
            "loc": ["body"],
            "msg": msg,
        }],
    ) from exc


def _resolve_weather(
    latitude: float,
    longitude: float,
    time_config: TimeConfig,
    weather_source: str,
    weather_data: dict[str, Any] | None,
) -> WeatherDataset:
    if weather_source == "custom_json":
        if not weather_data:
            raise EngineError("invalid_weather_json", "weather_data wajib diisi saat weather_source adalah custom_json.")
        return load_weather_from_json(weather_data, time_config)
    if weather_source == "pvgis_tmy":
        return _weather_provider.get_weather(latitude, longitude, time_config)
    raise EngineError("unsupported_weather_source", f"Sumber cuaca tidak dikenal: {weather_source}.")


def _resolve_load(lp: HybridLoadProfileInput, time_config: TimeConfig) -> LoadProfile:
    if lp.mode == "csv":
        if lp.csv_text is None or not lp.csv_text.strip():
            raise EngineError("load_csv_required", "Isi berkas CSV beban wajib disediakan untuk mode csv.")
        if "\n" not in lp.csv_text and "\r" not in lp.csv_text:
            raise EngineError("invalid_csv_format", "Teks CSV beban harus berisi deret nilai per baris.")
        return load_profile_from_csv(lp.csv_text, time_config)
    if lp.mode == "synthetic":
        return generate_synthetic_load(
            base_load_kw=lp.base_load_kw,
            peak_load_kw=lp.peak_load_kw,
            time_config=time_config,
            seed=lp.seed,
            daily_profile=lp.daily_profile,
            monthly_factors=lp.monthly_factors,
            noise_fraction=lp.noise_fraction,
        )
    raise EngineError("unsupported_load_mode", f"Mode profil beban tidak dikenal: {lp.mode}.")


def _weather_metadata_dict(weather: WeatherDataset) -> dict[str, Any]:
    m = weather.metadata
    return {
        "provider": m.provider,
        "dataset": m.dataset,
        "dataset_version": m.dataset_version,
        "period": m.period,
        "latitude": m.latitude,
        "longitude": m.longitude,
        "elevation_m": m.elevation_m,
        "timezone": m.timezone,
        "timezone_offset_hours": m.timezone_offset_hours,
        "retrieved_at": m.retrieved_at,
    }


def _round_list(arr: np.ndarray, digits: int = 3) -> list[float]:
    return [round(float(v), digits) for v in arr.tolist()]


def _build_simulation_response(
    result: SimulationResult,
    lifetime_result: LifetimeSimulationResult,
    finance_result: FinanceResult | None,
    req: HybridSimulateRequest,
) -> dict[str, Any]:
    tc = result.config.time_config
    h = tc.step_hours
    month_idx = tc.month_indices()
    b = result.balance
    pv_gen = b.effective_pv_generation_kw
    bio_gen = b.effective_biomass_generation_kw
    diesel_gen = b.effective_diesel_generation_kw

    monthly_rows: list[dict[str, Any]] = []
    for m in range(1, 13):
        mask = month_idx == m
        monthly_rows.append({
            "month": m,
            "load_kwh": round(float(np.sum(b.load_kw[mask]) * h), 3),
            "pv_generation_kwh": round(float(np.sum(pv_gen[mask]) * h), 3),
            "biomass_generation_kwh": round(float(np.sum(bio_gen[mask]) * h), 3),
            "diesel_generation_kwh": round(float(np.sum(diesel_gen[mask]) * h), 3),
            "bess_charge_kwh": round(float(np.sum(b.charge_kw[mask]) * h), 3),
            "bess_discharge_kwh": round(float(np.sum(b.discharge_kw[mask]) * h), 3),
            "grid_import_kwh": round(float(np.sum(b.grid_import_kw[mask]) * h), 3),
            "grid_export_kwh": round(float(np.sum(b.grid_export_kw[mask]) * h), 3),
            "served_load_kwh": round(float(np.sum(b.served_load_kw[mask]) * h), 3),
            "unmet_load_kwh": round(float(np.sum(b.unmet_load_kw[mask]) * h), 3),
            "curtailment_kwh": round(float(np.sum(b.curtailment_kw[mask]) * h), 3),
        })

    summary_dict = asdict(result.summary)
    summary_dict["biomass_generation_kwh"] = (
        round(result.biomass_summary.total_generation_kwh, 3) if result.biomass_summary is not None else 0.0
    )
    summary_dict["diesel_generation_kwh"] = (
        round(result.diesel_summary.total_generation_kwh, 3) if result.diesel_summary is not None else 0.0
    )

    warnings: list[str] = []
    warning_codes: list[str] = []
    if result.summary.unmet_load_kwh > 1e-3:
        warnings.append("Sebagian beban listrik belum terpenuhi oleh sistem pada konfigurasi saat ini.")
        warning_codes.append("unmet_load_present")
    if lifetime_result.lifetime_config.multi_year_mode == "scaled_year_1":
        warnings.append("Simulasi multi-tahun memakai mode cepat scaled_year_1 dari hasil Tahun 1.")
        warning_codes.append("scaled_multi_year_mode")

    out: dict[str, Any] = {
        "engine_version": ENGINE_VERSION,
        "contract_version": req.contract_version,
        "config_hash": result.config_hash,
        "calculated_at": result.calculated_at,
        "project_name": result.config.project_name,
        "dispatch_strategy": result.dispatch_strategy,
        "weather_source": _weather_metadata_dict(result.weather),
        "summary": summary_dict,
        "pv_loss_breakdown_kwh": {k: round(float(v), 3) for k, v in result.pv_output.loss_breakdown_kwh.items()},
        "monthly": monthly_rows,
        "bess_summary": asdict(result.bess_summary) if result.bess_summary is not None else None,
        "biomass_summary": asdict(result.biomass_summary) if result.biomass_summary is not None else None,
        "diesel_summary": asdict(result.diesel_summary) if result.diesel_summary is not None else None,
        "lifetime_summary": lifetime_result.to_summary_dict(),
        "finance_summary": asdict(finance_result.summary) if finance_result is not None else None,
        "lcoe_breakdown": asdict(finance_result.lcoe_breakdown) if finance_result is not None else None,
        "emissions_summary": asdict(finance_result.emissions) if finance_result is not None else None,
        "cashflow_schedule": [asdict(row) for row in finance_result.schedule] if finance_result is not None else [],
        "warnings": warnings,
        "warning_codes": warning_codes,
    }

    if req.output_options.include_daily:
        out["daily"] = [asdict(row) for row in result.daily]

    if req.output_options.include_hourly:
        hourly: dict[str, Any] = {
            "steps_count": tc.steps_per_year,
            "step_minutes": tc.step_minutes,
            "local_time": tc.timestamp_labels(),
            "load_kw": _round_list(b.load_kw, 3),
            "pv_generation_kw": _round_list(pv_gen, 3),
            "biomass_generation_kw": _round_list(bio_gen, 3),
            "diesel_generation_kw": _round_list(diesel_gen, 3),
            "diesel_fuel_liters": (
                _round_list(result.diesel_fuel_liters, 4)
                if result.diesel_fuel_liters is not None
                else [0.0] * tc.steps_per_year
            ),
            "bess_charge_kw": _round_list(b.charge_kw, 3),
            "bess_discharge_kw": _round_list(b.discharge_kw, 3),
            "grid_import_kw": _round_list(b.grid_import_kw, 3),
            "grid_export_kw": _round_list(b.grid_export_kw, 3),
            "served_load_kw": _round_list(b.served_load_kw, 3),
            "unmet_load_kw": _round_list(b.unmet_load_kw, 3),
            "curtailment_kw": _round_list(b.curtailment_kw, 3),
            "losses_kw": _round_list(b.losses_kw, 3),
            "bess_soc_fraction": _round_list(result.bess_soc, 4) if result.bess_soc is not None else None,
            "biomass_status": list(result.biomass_status) if result.biomass_status else None,
            "diesel_status": list(result.diesel_status) if result.diesel_status else None,
            "trace_reason": (
                list(result.trace_reasons)
                if (req.output_options.include_trace_reasons and result.trace_reasons)
                else None
            ),
        }
        out["hourly_year_1"] = hourly

    return out


def _build_core_inputs(req: HybridSimulateRequest) -> tuple[SimulationConfig, Any, Any, WeatherDataset, LoadProfile]:
    if not req.components.pv.enabled:
        raise EngineError("invalid_pv_config", "Komponen PV harus diaktifkan pada simulasi hybrid.")

    time_config = TimeConfig(
        step_minutes=req.simulation.step_minutes,
        timezone=req.project.timezone,
        leap_day_policy=req.simulation.leap_day_policy,
    )

    pv_raw = req.components.pv.model_dump(exclude_none=True)
    pv_config = _parse_pv_config(pv_raw)

    bess_raw = req.components.bess.model_dump(exclude_none=True) if req.components.bess is not None else None
    bess_config = _parse_bess_config(bess_raw)
    if bess_config is not None:
        BESSComponent(bess_config).validate()

    bio_raw = req.components.biomass.model_dump(exclude_none=True) if req.components.biomass is not None else None
    biomass_config = _parse_biomass_config(bio_raw)
    if biomass_config is not None:
        BiomassComponent(biomass_config).validate()

    diesel_raw = req.components.diesel.model_dump(exclude_none=True) if req.components.diesel is not None else None
    diesel_config = _parse_diesel_config(diesel_raw)
    if diesel_config is not None:
        DieselComponent(diesel_config).validate()

    sim_raw = req.simulation.model_dump(exclude_none=True)
    dispatch_config = _parse_dispatch_config(sim_raw)

    sim_config = SimulationConfig(
        project_name=req.project.project_name,
        time_config=time_config,
        pv=pv_config,
        contract_version=req.contract_version,
        bess=bess_config,
        dispatch=dispatch_config,
        biomass=biomass_config,
        diesel=diesel_config,
    )

    fin_raw = req.finance.model_dump(exclude_none=True) if req.finance is not None else None
    lifetime_cfg = resolve_lifetime_config(sim_raw, fin_raw)
    finance_cfg = resolve_finance_config(fin_raw, currency_code=req.project.currency_code) if fin_raw is not None else None

    weather = _resolve_weather(
        latitude=req.project.latitude,
        longitude=req.project.longitude,
        time_config=time_config,
        weather_source=req.simulation.weather_source,
        weather_data=req.simulation.weather_data,
    )
    load_profile = _resolve_load(req.load_profile, time_config)
    return sim_config, lifetime_cfg, finance_cfg, weather, load_profile


def _prepare_and_run(
    req: HybridSimulateRequest,
    progress_cb: Any = None,
) -> dict[str, Any]:
    sim_config, lifetime_cfg, finance_cfg, weather, load_profile = _build_core_inputs(req)

    if progress_cb is not None:
        progress_cb(8, "Menjalankan simulasi energi per jam")

    def on_year(year: int, total_years: int) -> None:
        if progress_cb is not None:
            pct = 10 + int(80 * year / max(total_years, 1))
            progress_cb(pct, f"Menjalankan tahun {year} dari {total_years}")

    lifetime_result = run_lifetime_simulation(
        sim_config,
        weather,
        load_profile,
        lifetime_cfg,
        progress_callback=on_year,
    )

    finance_result: FinanceResult | None = None
    if finance_cfg is not None:
        if progress_cb is not None:
            progress_cb(93, "Menghitung arus kas, LCOE, dan emisi")
        finance_result = run_financial_analysis(lifetime_result, finance_cfg)

    return _build_simulation_response(lifetime_result.year_1_result, lifetime_result, finance_result, req)


@router.get("/presets")
def get_presets() -> dict[str, Any]:
    """Mengembalikan katalog preset bahan bakar, sampel pembangkit, strategi EMS, dan sampel lokasi [REAL DATA]."""
    sample_config = {
        "contract_version": CONTRACT_VERSION,
        "project": {
            "project_name": "Pabrik Hybrid Cikarang [REAL DATA]",
            "latitude": -6.28,
            "longitude": 107.15,
            "elevation_m": 25.0,
            "timezone": "Asia/Jakarta",
            "currency_code": "IDR",
        },
        "simulation": {
            "step_minutes": 60,
            "leap_day_policy": "ignore_feb_29",
            "weather_source": "pvgis_tmy",
            "dispatch_strategy": "load_following",
            "dispatch_params": {
                "allow_grid_import": False,
                "allow_grid_export": False,
                "target_soc_fraction": 0.80,
            },
            "project_lifetime_years": 25,
            "multi_year_mode": "scaled_year_1",
        },
        "load_profile": {
            "mode": "synthetic",
            "base_load_kw": 120.0,
            "peak_load_kw": 350.0,
            "seed": 42,
            "noise_fraction": 0.05,
        },
        "components": {
            "pv": {
                "enabled": True,
                "model": "detailed_v1",
                "capacity_kwp": 500.0,
                "inverter_ac_kw": 420.0,
                "transposition_model": "perez",
                "tracking_mode": "fixed",
                "tilt_degrees": 10.0,
                "azimuth_degrees": 0.0,
                "cell_temp_model": "faiman",
                "dc_model": "pvwatts",
                "annual_degradation_fraction": 0.005,
            },
            "bess": {
                "enabled": True,
                "nominal_capacity_kwh": 600.0,
                "max_charge_kw": 300.0,
                "max_discharge_kw": 300.0,
                "soc_min_fraction": 0.20,
                "soc_max_fraction": 0.95,
                "initial_soc_fraction": 0.50,
                "replacement_cost": 1_800_000_000.0,
            },
            "biomass": {
                "enabled": True,
                "plant_sample": "sample_gasifier_250kw",
                "fuel_preset": "efb",
                "supply_period": "monthly",
                "supply_limit_tons": 220.0,
                "overhaul_cost": 150_000_000.0,
            },
        },
        "finance": {
            "tax_model": "pre_tax",
            "revenue_mode": "avoided_cost",
            "discount_rate": 0.10,
            "tariff_escalation_rate": 0.02,
            "om_escalation_rate": 0.02,
            "fuel_escalation_rate": 0.02,
            "replacement_escalation_rate": 0.0,
            "electricity_tariff_per_kwh": 1445.0,
            "grid_import_tariff_per_kwh": 1445.0,
            "grid_export_tariff_per_kwh": 0.0,
            "pv_capex_per_kwp": 11_500_000.0,
            "bess_capex_per_kwh": 3_500_000.0,
            "biomass_capex_per_kw": 18_000_000.0,
            "pv_om_fraction_of_capex": 0.015,
            "bess_fixed_om_per_kwh_year": 50_000.0,
            "inverter_replacement_year": 13,
            "inverter_replacement_cost": 420_000_000.0,
            "bess_design_life_years": 10.0,
            "inverter_design_life_years": 12.0,
            "biomass_overhaul_life_years": 5.0,
            "grid_emission_factor_kg_co2e_per_kwh": 0.78,
        },
    }
    diesel_defaults = {
        "rated_capacity_kw": 250.0,
        "min_load_fraction": DEFAULT_DIESEL_MIN_LOAD_FRACTION,
        "fuel_curve_model": "willans_linear",
        "slope_liters_per_kwh": DEFAULT_DIESEL_SLOPE_L_PER_KWH,
        "min_run_time_hours": 1.0,
        "min_down_time_hours": 1.0,
        "fuel_price_per_liter": DEFAULT_DIESEL_FUEL_PRICE_IDR,
        "fixed_om_per_kw_year": DEFAULT_DIESEL_FIXED_OM_IDR,
        "variable_om_per_operating_hour": 0.0,
        "startup_cost": 0.0,
        "overhaul_interval_operating_hours": DEFAULT_DIESEL_OVERHAUL_HOURS,
        "overhaul_cost": 120_000_000.0,
        "emission_factor_kg_co2e_per_liter": DEFAULT_DIESEL_EMISSION_FACTOR_KG_PER_LITER,
        "is_renewable": False,
        "diesel_capex_per_kw": 4_500_000.0,
        "diesel_overhaul_life_years": 5.0,
    }
    return {
        "engine_version": ENGINE_VERSION,
        "contract_version": CONTRACT_VERSION,
        "fuel_presets": BIOMASS_FUEL_PRESETS,
        "plant_samples": BIOMASS_PLANT_SAMPLES,
        "diesel_defaults": diesel_defaults,
        "dispatch_strategies": DISPATCH_STRATEGIES,
        "location_presets": LOCATION_PRESETS,
        "sample_config": sample_config,
    }


@router.post("/weather/preview")
def preview_weather(req: HybridWeatherPreviewRequest) -> dict[str, Any]:
    """Mengambil data cuaca per jam dan merangkum metrik tahunan serta bulanan."""
    try:
        time_config = TimeConfig(step_minutes=req.step_minutes, timezone=req.timezone)
        weather = _resolve_weather(
            latitude=req.latitude,
            longitude=req.longitude,
            time_config=time_config,
            weather_source=req.weather_source,
            weather_data=req.weather_data,
        )
    except EngineError as exc:
        _raise_engine_error(exc)
    except ResourceError as exc:
        _raise_resource_error(exc)

    h = time_config.step_hours
    month_idx = time_config.month_indices()
    monthly = []
    for m in range(1, 13):
        mask = month_idx == m
        monthly.append({
            "month": m,
            "ghi_kwh_m2": round(float(np.sum(weather.ghi_w_m2[mask]) * h / 1000.0), 2),
            "dni_kwh_m2": round(float(np.sum(weather.dni_w_m2[mask]) * h / 1000.0), 2),
            "dhi_kwh_m2": round(float(np.sum(weather.dhi_w_m2[mask]) * h / 1000.0), 2),
            "avg_temp_c": round(float(np.mean(weather.temp_air_c[mask])), 2),
            "avg_wind_m_s": round(float(np.mean(weather.wind_speed_m_s[mask])), 2),
        })

    return {
        "engine_version": ENGINE_VERSION,
        "contract_version": CONTRACT_VERSION,
        "weather_source": _weather_metadata_dict(weather),
        "annual_summary": {
            "steps_count": time_config.steps_per_year,
            "total_ghi_kwh_m2": round(float(np.sum(weather.ghi_w_m2) * h / 1000.0), 2),
            "total_dni_kwh_m2": round(float(np.sum(weather.dni_w_m2) * h / 1000.0), 2),
            "total_dhi_kwh_m2": round(float(np.sum(weather.dhi_w_m2) * h / 1000.0), 2),
            "avg_temp_c": round(float(np.mean(weather.temp_air_c)), 2),
            "min_temp_c": round(float(np.min(weather.temp_air_c)), 2),
            "max_temp_c": round(float(np.max(weather.temp_air_c)), 2),
            "avg_wind_m_s": round(float(np.mean(weather.wind_speed_m_s)), 2),
        },
        "monthly": monthly,
    }


@router.post("/load/preview")
def preview_load(req: HybridLoadPreviewRequest) -> dict[str, Any]:
    """Memvalidasi profil beban (sintetis atau CSV) dan mengembalikan ringkasan serta deret per jam."""
    try:
        time_config = TimeConfig(step_minutes=req.step_minutes, timezone=req.timezone)
        lp = _resolve_load(req.load_profile, time_config)
    except EngineError as exc:
        _raise_engine_error(exc)

    arr = lp.load_kw
    h = time_config.step_hours
    avg_kw = float(np.mean(arr))
    peak_kw = lp.peak_kw
    min_kw = float(np.min(arr))
    load_factor = (avg_kw / peak_kw) if peak_kw > 0.0 else 0.0

    # Agregasi profil harian rata-rata 24 jam.
    steps_per_day = time_config.steps_per_day
    hours_floor = (np.arange(time_config.steps_per_year) % steps_per_day) * time_config.step_minutes // 60
    daily_24h = []
    for hr in range(24):
        mask = hours_floor == hr
        slice_hr = arr[mask]
        daily_24h.append({
            "hour": hr,
            "avg_kw": round(float(np.mean(slice_hr)), 3),
            "min_kw": round(float(np.min(slice_hr)), 3),
            "max_kw": round(float(np.max(slice_hr)), 3),
        })

    month_idx = time_config.month_indices()
    monthly = []
    for m in range(1, 13):
        mask = month_idx == m
        monthly.append({
            "month": m,
            "load_kwh": round(float(np.sum(arr[mask]) * h), 3),
            "peak_kw": round(float(np.max(arr[mask])), 3),
        })

    return {
        "engine_version": ENGINE_VERSION,
        "contract_version": CONTRACT_VERSION,
        "source": lp.source,
        "summary": {
            "steps_count": time_config.steps_per_year,
            "step_minutes": time_config.step_minutes,
            "total_load_kwh": round(lp.total_energy_kwh, 3),
            "peak_load_kw": round(peak_kw, 3),
            "min_load_kw": round(min_kw, 3),
            "average_load_kw": round(avg_kw, 3),
            "load_factor": round(load_factor, 4),
        },
        "daily_average_24h": daily_24h,
        "monthly": monthly,
        "hourly_load_kw": _round_list(arr, 3),
    }


@router.post("/simulate")
def simulate_hybrid(req: HybridSimulateRequest) -> dict[str, Any]:
    """Menjalankan simulasi hybrid lengkap secara langsung dan mengembalikan hasil terstruktur."""
    try:
        return _prepare_and_run(req)
    except EngineError as exc:
        _raise_engine_error(exc)
    except ResourceError as exc:
        _raise_resource_error(exc)


def _prune_jobs_locked(now: float) -> None:
    expired = [
        jid for jid, job in _jobs_store.items()
        if job["status"] in ("completed", "failed") and (now - job["updated_at"]) > JOB_TTL_SECONDS
    ]
    for jid in expired:
        del _jobs_store[jid]

    if len(_jobs_store) >= MAX_JOBS:
        done_jobs = sorted(
            ((jid, job["updated_at"]) for jid, job in _jobs_store.items() if job["status"] in ("completed", "failed")),
            key=lambda item: item[1],
        )
        for jid, _ in done_jobs:
            if len(_jobs_store) < MAX_JOBS:
                break
            del _jobs_store[jid]


def _run_job(job_id: str, req: HybridSimulateRequest) -> None:
    def update_progress(pct: int, label: str) -> None:
        with _jobs_lock:
            job = _jobs_store.get(job_id)
            if job is not None:
                job["status"] = "running"
                job["progress_percent"] = max(0, min(99, int(pct)))
                job["current_step_label"] = label
                job["updated_at"] = time.monotonic()

    try:
        update_progress(2, "Menyiapkan konfigurasi dan data cuaca")
        result = _prepare_and_run(req, progress_cb=update_progress)
        with _jobs_lock:
            job = _jobs_store.get(job_id)
            if job is not None:
                job["status"] = "completed"
                job["progress_percent"] = 100
                job["current_step_label"] = "Simulasi selesai"
                job["result"] = result
                job["updated_at"] = time.monotonic()
    except EngineError as exc:
        with _jobs_lock:
            job = _jobs_store.get(job_id)
            if job is not None:
                job["status"] = "failed"
                job["current_step_label"] = "Simulasi gagal"
                job["error"] = {"code": exc.code, "msg": str(exc)}
                job["updated_at"] = time.monotonic()
    except ResourceError as exc:
        code, msg = _map_resource_error(exc)
        with _jobs_lock:
            job = _jobs_store.get(job_id)
            if job is not None:
                job["status"] = "failed"
                job["current_step_label"] = "Gagal mengambil data cuaca"
                job["error"] = {"code": code, "msg": msg}
                job["updated_at"] = time.monotonic()
    except Exception as exc:
        with _jobs_lock:
            job = _jobs_store.get(job_id)
            if job is not None:
                job["status"] = "failed"
                job["current_step_label"] = "Kesalahan internal simulasi"
                job["error"] = {"code": "internal_simulation_error", "msg": str(exc)}
                job["updated_at"] = time.monotonic()


@router.post("/jobs", status_code=202)
def create_hybrid_job(req: HybridSimulateRequest) -> JSONResponse:
    """Mendaftarkan simulasi hybrid ke antrean job asinkron di memori."""
    job_id = str(uuid.uuid4())
    now = time.monotonic()
    with _jobs_lock:
        _prune_jobs_locked(now)
        if len(_jobs_store) >= MAX_JOBS:
            raise HTTPException(
                status_code=422,
                detail=[{
                    "type": "value_error",
                    "code": "job_capacity_exceeded",
                    "loc": ["body"],
                    "msg": "Antrean simulasi sedang penuh. Coba beberapa saat lagi.",
                }],
            )
        _jobs_store[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "progress_percent": 0,
            "current_step_label": "Menunggu giliran antrean",
            "result": None,
            "error": None,
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "updated_at": now,
        }

    _job_executor.submit(_run_job, job_id, req)
    return JSONResponse(
        status_code=202,
        content={
            "job_id": job_id,
            "status": "queued",
            "progress_percent": 0,
            "current_step_label": "Menunggu giliran antrean",
        },
    )


@router.get("/jobs/{job_id}")
def get_hybrid_job(job_id: str) -> dict[str, Any]:
    """Mengambil status progres dan hasil simulasi asinkron berdasarkan job_id."""
    with _jobs_lock:
        job = _jobs_store.get(job_id)
        if job is None:
            raise HTTPException(
                status_code=404,
                detail=[{
                    "type": "value_error",
                    "code": "job_not_found",
                    "loc": ["path", "job_id"],
                    "msg": "Job simulasi tidak ditemukan atau sudah kedaluwarsa.",
                }],
            )
        return {
            "job_id": job["job_id"],
            "status": job["status"],
            "progress_percent": job["progress_percent"],
            "current_step_label": job["current_step_label"],
            "created_at": job["created_at"],
            "result": job["result"],
            "error": job["error"],
        }


# ---------------------------------------------------------------------------
# Endpoint Tahap 7 & 8B: Sapuan Kombinasi, Sensitivitas Hybrid, dan Ekspor Excel
# ---------------------------------------------------------------------------


def _prune_sweep_jobs_locked(now: float) -> None:
    terminal = ("completed", "failed", "cancelled")
    expired = [
        jid for jid, job in _sweep_jobs_store.items()
        if job["status"] in terminal and (now - job["updated_at"]) > SWEEP_JOB_TTL_SECONDS
    ]
    for jid in expired:
        del _sweep_jobs_store[jid]

    if len(_sweep_jobs_store) >= MAX_SWEEP_JOBS:
        done_jobs = sorted(
            ((jid, job["updated_at"]) for jid, job in _sweep_jobs_store.items() if job["status"] in terminal),
            key=lambda item: item[1],
        )
        for jid, _ in done_jobs:
            if len(_sweep_jobs_store) < MAX_SWEEP_JOBS:
                break
            del _sweep_jobs_store[jid]


def _run_sweep_job(job_id: str, req: HybridSweepJobRequest, cancel_event: threading.Event) -> None:
    def set_state(status: str, pct: int, done_cnt: int, label: str) -> None:
        with _sweep_jobs_lock:
            job = _sweep_jobs_store.get(job_id)
            if job is not None:
                job["status"] = status
                job["progress_percent"] = max(0, min(99, int(pct)))
                job["completed_combinations"] = done_cnt
                job["current_step_label"] = label
                job["updated_at"] = time.monotonic()

    try:
        if cancel_event.is_set():
            raise EngineError("sweep_job_cancelled", "Job sapuan kombinasi dibatalkan oleh pengguna.")

        set_state("running", 3, 0, "Menyiapkan data cuaca dan profil beban")
        sim_config, lifetime_cfg, finance_cfg, weather, load_profile = _build_core_inputs(req.base_request)
        if finance_cfg is None:
            finance_cfg = resolve_finance_config({}, currency_code=req.base_request.project.currency_code)

        def on_combo(done_idx: int, total_cnt: int, combo_id: str) -> None:
            pct = 5 + int(92 * done_idx / max(total_cnt, 1))
            set_state("running", pct, done_idx, f"Mengevaluasi {done_idx} dari {total_cnt} ({combo_id})")

        sweep_out = run_hybrid_sweep(
            base_sim_config=sim_config,
            weather=weather,
            load_profile=load_profile,
            base_lifetime_config=lifetime_cfg,
            base_finance_config=finance_cfg,
            pv_values=req.sweep.pv_capacity_kwp_values,
            bess_values=req.sweep.bess_capacity_kwh_values,
            biomass_values=req.sweep.biomass_capacity_kw_values,
            diesel_values=req.sweep.diesel_capacity_kw_values,
            inverter_sizing_mode=req.sweep.pv_inverter_sizing_mode,
            scale_replacement_costs=req.sweep.scale_replacement_costs,
            bess_replacement_cost_per_kwh=req.sweep.bess_replacement_cost_per_kwh,
            max_unmet_load_fraction=req.constraints.max_unmet_load_fraction,
            min_renewable_fraction=req.constraints.min_renewable_fraction,
            sort_by=req.ranking.sort_by,
            feasible_first=req.ranking.feasible_first,
            progress_callback=on_combo,
            cancel_event=cancel_event,
        )
        sweep_out["weather_source"] = _weather_metadata_dict(weather)

        with _sweep_jobs_lock:
            job = _sweep_jobs_store.get(job_id)
            if job is not None:
                job["status"] = "completed"
                job["progress_percent"] = 100
                job["completed_combinations"] = sweep_out["total_combinations"]
                job["current_step_label"] = f"Sapuan selesai: {sweep_out['total_combinations']} kombinasi dievaluasi"
                job["result"] = sweep_out
                job["updated_at"] = time.monotonic()
    except EngineError as exc:
        with _sweep_jobs_lock:
            job = _sweep_jobs_store.get(job_id)
            if job is not None:
                if exc.code == "sweep_job_cancelled":
                    job["status"] = "cancelled"
                    job["current_step_label"] = "Sapuan dibatalkan"
                else:
                    job["status"] = "failed"
                    job["current_step_label"] = "Sapuan gagal"
                job["error"] = {"code": exc.code, "msg": str(exc)}
                job["updated_at"] = time.monotonic()
    except ResourceError as exc:
        code, msg = _map_resource_error(exc)
        with _sweep_jobs_lock:
            job = _sweep_jobs_store.get(job_id)
            if job is not None:
                job["status"] = "failed"
                job["current_step_label"] = "Gagal mengambil data cuaca"
                job["error"] = {"code": code, "msg": msg}
                job["updated_at"] = time.monotonic()
    except Exception as exc:
        with _sweep_jobs_lock:
            job = _sweep_jobs_store.get(job_id)
            if job is not None:
                job["status"] = "failed"
                job["current_step_label"] = "Kesalahan internal sapuan"
                job["error"] = {"code": "internal_simulation_error", "msg": str(exc)}
                job["updated_at"] = time.monotonic()


@router.post("/sweep/jobs", status_code=202)
def create_hybrid_sweep_job(req: HybridSweepJobRequest) -> JSONResponse:
    """Mendaftarkan job sapuan kombinasi gaya HOMER secara asinkron."""
    try:
        if not req.base_request.components.pv.enabled:
            raise EngineError("invalid_pv_config", "Komponen PV harus diaktifkan pada sapuan hybrid.")
        pv_vals = validate_sweep_axis(req.sweep.pv_capacity_kwp_values, "pv_capacity_kwp_values", allow_zero=False)
        bess_vals = validate_sweep_axis(req.sweep.bess_capacity_kwh_values, "bess_capacity_kwh_values", allow_zero=True)
        bio_vals = validate_sweep_axis(req.sweep.biomass_capacity_kw_values, "biomass_capacity_kw_values", allow_zero=True)
        diesel_vals = (
            validate_sweep_axis(req.sweep.diesel_capacity_kw_values, "diesel_capacity_kw_values", allow_zero=True)
            if req.sweep.diesel_capacity_kw_values is not None
            else None
        )
        total_combos = validate_sweep_limits(
            pv_vals,
            bess_vals,
            bio_vals,
            req.base_request.simulation.multi_year_mode,
            diesel_values=diesel_vals,
        )
    except EngineError as exc:
        _raise_engine_error(exc)

    job_id = str(uuid.uuid4())
    now = time.monotonic()
    cancel_event = threading.Event()
    with _sweep_jobs_lock:
        _prune_sweep_jobs_locked(now)
        if len(_sweep_jobs_store) >= MAX_SWEEP_JOBS:
            raise HTTPException(
                status_code=422,
                detail=[{
                    "type": "value_error",
                    "code": "job_capacity_exceeded",
                    "loc": ["body"],
                    "msg": "Antrean sapuan kombinasi sedang penuh. Coba beberapa saat lagi.",
                }],
            )
        _sweep_jobs_store[job_id] = {
            "job_id": job_id,
            "engine_version": ENGINE_VERSION,
            "contract_version": req.contract_version,
            "status": "queued",
            "progress_percent": 0,
            "completed_combinations": 0,
            "total_combinations": total_combos,
            "current_step_label": "Menunggu giliran antrean sapuan",
            "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "updated_at": now,
            "result": None,
            "error": None,
            "cancel_event": cancel_event,
        }

    _sweep_executor.submit(_run_sweep_job, job_id, req, cancel_event)
    return JSONResponse(
        status_code=202,
        content={
            "job_id": job_id,
            "engine_version": ENGINE_VERSION,
            "contract_version": req.contract_version,
            "status": "queued",
            "progress_percent": 0,
            "completed_combinations": 0,
            "total_combinations": total_combos,
            "current_step_label": "Menunggu giliran antrean sapuan",
        },
    )


@router.get("/sweep/jobs/{job_id}")
def get_hybrid_sweep_job(job_id: str) -> dict[str, Any]:
    """Mengambil status progres dan hasil terurut sapuan kombinasi."""
    with _sweep_jobs_lock:
        job = _sweep_jobs_store.get(job_id)
        if job is None:
            raise HTTPException(
                status_code=404,
                detail=[{
                    "type": "value_error",
                    "code": "sweep_job_not_found",
                    "loc": ["path", "job_id"],
                    "msg": "Job sapuan kombinasi tidak ditemukan atau sudah kedaluwarsa di server.",
                }],
            )
        return {
            "job_id": job["job_id"],
            "engine_version": job["engine_version"],
            "contract_version": job["contract_version"],
            "status": job["status"],
            "progress_percent": job["progress_percent"],
            "completed_combinations": job["completed_combinations"],
            "total_combinations": job["total_combinations"],
            "current_step_label": job["current_step_label"],
            "created_at": job["created_at"],
            "result": job["result"],
            "error": job["error"],
        }


@router.post("/sweep/jobs/{job_id}/cancel")
def cancel_hybrid_sweep_job(job_id: str) -> dict[str, Any]:
    """Mengirim sinyal pembatalan kooperatif ke job sapuan kombinasi."""
    with _sweep_jobs_lock:
        job = _sweep_jobs_store.get(job_id)
        if job is None:
            raise HTTPException(
                status_code=404,
                detail=[{
                    "type": "value_error",
                    "code": "sweep_job_not_found",
                    "loc": ["path", "job_id"],
                    "msg": "Job sapuan kombinasi tidak ditemukan atau sudah kedaluwarsa.",
                }],
            )
        job["cancel_event"].set()
        if job["status"] == "queued":
            job["status"] = "cancelled"
            job["current_step_label"] = "Sapuan dibatalkan sebelum dijalankan"
            job["error"] = {"code": "sweep_job_cancelled", "msg": "Job sapuan dibatalkan oleh pengguna."}
            job["updated_at"] = time.monotonic()
        return {
            "job_id": job["job_id"],
            "status": job["status"],
            "current_step_label": job["current_step_label"],
        }


@router.post("/sensitivity")
def sensitivity_hybrid(req: HybridSensitivityRequest) -> dict[str, Any]:
    """Menjalankan analisis sensitivitas Tornado dan Matriks 5x5 untuk sistem hybrid."""
    try:
        sim_config, lifetime_cfg, finance_cfg, weather, load_profile = _build_core_inputs(req.base_request)
        if finance_cfg is None:
            finance_cfg = resolve_finance_config({}, currency_code=req.base_request.project.currency_code)

        res = run_hybrid_sensitivity(
            base_sim_config=sim_config,
            weather=weather,
            load_profile=load_profile,
            base_lifetime_config=lifetime_cfg,
            base_finance_config=finance_cfg,
            variables=req.variables,
            shifts=req.shifts,
            matrix=req.matrix.model_dump() if req.matrix is not None else None,
        )
    except EngineError as exc:
        _raise_engine_error(exc)
    except ResourceError as exc:
        _raise_resource_error(exc)

    return {
        "engine_version": ENGINE_VERSION,
        "contract_version": req.contract_version,
        "calculated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        **res,
    }


@router.post("/export/excel")
def export_hybrid_excel(req: HybridExcelExportRequest) -> Response:
    """Menghasilkan buku kerja Excel (.xlsx) multi-sheet dari hasil simulasi hybrid."""
    try:
        xlsx_bytes = build_hybrid_excel_bytes(
            project_config=req.project_config,
            simulation_result=req.simulation_result,
            language=req.language,
            sweep_result=req.sweep_result,
            sensitivity_result=req.sensitivity_result,
        )
    except EngineError as exc:
        _raise_engine_error(exc)

    raw_name = str(req.simulation_result.get("project_name") or "proyek-hybrid").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", raw_name).strip("-") or "proyek-hybrid"
    filename = f"{slug}-laporan-hybrid.xlsx"
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
