"""Mesin analisis sensitivitas hybrid satu arah (Tornado) dan Matriks 2D (5 x 5)."""

from dataclasses import replace
import math
from typing import Any, Literal

import numpy as np

from app.errors import EngineError
from app.hybrid.components import PVHourlyOutput, PVWattsConfig
from app.hybrid.finance import (
    FinanceConfig,
    FinanceResult,
    run_financial_analysis,
    run_financial_analysis_from_yearly,
    validate_finance_config,
)
from app.hybrid.lifetime import (
    LifetimeConfig,
    LifetimeSimulationResult,
    run_lifetime_simulation,
    run_scaled_lifetime_from_year_1,
    validate_lifetime_config,
)
from app.hybrid.load import LoadProfile
from app.hybrid.pv_detailed import PVDetailedConfig
from app.hybrid.simulator import SimulationConfig
from app.hybrid.weather import WeatherDataset

SensitivityVariableId = Literal[
    "capex_total",
    "electricity_tariff",
    "discount_rate",
    "biomass_fuel_price",
    "diesel_fuel_price",
    "om_total",
    "pv_degradation_rate",
    "load_scale",
    "pv_capacity",
]

DEFAULT_SENSITIVITY_VARIABLES: tuple[SensitivityVariableId, ...] = (
    "capex_total",
    "electricity_tariff",
    "discount_rate",
    "biomass_fuel_price",
    "om_total",
    "pv_degradation_rate",
)
DEFAULT_SENSITIVITY_SHIFTS: tuple[float, ...] = (-0.20, -0.10, 0.10, 0.20)

FINANCE_ONLY_VARIABLES: frozenset[str] = frozenset({
    "capex_total",
    "electricity_tariff",
    "discount_rate",
    "biomass_fuel_price",
    "diesel_fuel_price",
    "om_total",
})

ALL_SENSITIVITY_VARIABLES: frozenset[str] = FINANCE_ONLY_VARIABLES | frozenset({
    "pv_degradation_rate",
    "load_scale",
    "pv_capacity",
})


def _validate_shifts(shifts: list[float], *, allow_zero: bool, max_len: int | None = None) -> list[float]:
    if not shifts:
        raise EngineError("invalid_sensitivity_shift", "Daftar pergeseran sensitivitas tidak boleh kosong.")
    if max_len is not None and len(shifts) > max_len:
        raise EngineError("invalid_matrix_axes", f"Setiap sumbu matriks maksimal berisi {max_len} nilai pergeseran.")

    cleaned: list[float] = []
    for raw in shifts:
        val = float(raw)
        if not math.isfinite(val) or val < -0.90 or val > 1.00:
            raise EngineError(
                "invalid_sensitivity_shift",
                "Nilai pergeseran sensitivitas harus berada antara -90% (-0.9) dan +100% (1.0).",
            )
        if not allow_zero and abs(val) <= 1e-12:
            raise EngineError("invalid_sensitivity_shift", "Pergeseran sensitivitas Tornado tidak boleh bernilai 0.")
        if any(abs(existing - val) <= 1e-9 for existing in cleaned):
            raise EngineError("duplicate_sensitivity_shifts", "Daftar pergeseran sensitivitas tidak boleh berulang.")
        cleaned.append(val)
    return sorted(cleaned)


def _validate_variables(variables: list[str]) -> list[str]:
    if not variables:
        raise EngineError("invalid_sensitivity_shift", "Daftar variabel sensitivitas tidak boleh kosong.")
    seen: set[str] = set()
    cleaned: list[str] = []
    for var in variables:
        if var not in ALL_SENSITIVITY_VARIABLES:
            raise EngineError("invalid_sensitivity_shift", f"Variabel sensitivitas tidak dikenal: {var}.")
        if var in seen:
            raise EngineError("duplicate_sensitivity_variables", "Daftar variabel sensitivitas tidak boleh berulang.")
        seen.add(var)
        cleaned.append(var)
    return cleaned


def _base_value_and_unit(
    var: str,
    sim_cfg: SimulationConfig,
    lifetime_cfg: LifetimeConfig,
    fin_cfg: FinanceConfig,
    base_finance: FinanceResult,
    load_profile: LoadProfile,
) -> tuple[float, str, bool]:
    curr = fin_cfg.currency_code
    if var == "capex_total":
        return float(base_finance.summary.gross_capex), curr, False
    if var == "electricity_tariff":
        return float(fin_cfg.electricity_tariff_per_kwh), f"{curr}/kWh", False
    if var == "discount_rate":
        return float(fin_cfg.discount_rate), "fraksi", False
    if var == "biomass_fuel_price":
        if sim_cfg.biomass is None:
            return 0.0, f"{curr}/ton", True
        return float(sim_cfg.biomass.effective_fuel_params.fuel_price_per_ton), f"{curr}/ton", False
    if var == "diesel_fuel_price":
        if sim_cfg.diesel is None:
            return 0.0, f"{curr}/L", True
        return float(sim_cfg.diesel.fuel_price_per_liter), f"{curr}/L", False
    if var == "om_total":
        yr1_om = float(base_finance.schedule[1].om_cost) if len(base_finance.schedule) > 1 else 0.0
        return yr1_om, f"{curr}/thn", False
    if var == "pv_degradation_rate":
        if lifetime_cfg.pv_annual_degradation_fraction is not None:
            deg = float(lifetime_cfg.pv_annual_degradation_fraction)
        elif isinstance(sim_cfg.pv, PVDetailedConfig):
            deg = float(sim_cfg.pv.annual_degradation_fraction)
        else:
            deg = 0.005
        return deg, "fraksi/thn", False
    if var == "load_scale":
        return float(load_profile.total_energy_kwh / 1000.0), "MWh/thn", False
    pv_kwp = (
        sim_cfg.pv.capacity_kwp
        if isinstance(sim_cfg.pv, PVWattsConfig)
        else sim_cfg.pv.effective_dc_capacity_kwp
    )
    return float(pv_kwp), "kWp", False


def _apply_finance_shift(
    var: str,
    shift: float,
    sim_cfg: SimulationConfig,
    fin_cfg: FinanceConfig,
    yearly: tuple[Any, ...],
) -> tuple[FinanceConfig, tuple[Any, ...]]:
    factor = 1.0 + shift
    next_fin = fin_cfg
    next_yearly = yearly

    if var == "capex_total":
        next_fin = replace(
            fin_cfg,
            pv_capex=(fin_cfg.pv_capex * factor) if fin_cfg.pv_capex is not None else None,
            pv_capex_per_kwp=fin_cfg.pv_capex_per_kwp * factor,
            bess_capex=(fin_cfg.bess_capex * factor) if fin_cfg.bess_capex is not None else None,
            bess_capex_per_kwh=fin_cfg.bess_capex_per_kwh * factor,
            biomass_capex=(fin_cfg.biomass_capex * factor) if fin_cfg.biomass_capex is not None else None,
            biomass_capex_per_kw=fin_cfg.biomass_capex_per_kw * factor,
            diesel_capex=(fin_cfg.diesel_capex * factor) if fin_cfg.diesel_capex is not None else None,
            diesel_capex_per_kw=fin_cfg.diesel_capex_per_kw * factor,
            bos_and_other_capex=fin_cfg.bos_and_other_capex * factor,
        )
    elif var == "electricity_tariff":
        grid_imp = (
            fin_cfg.grid_import_tariff_per_kwh * factor
            if (sim_cfg.dispatch is not None and sim_cfg.dispatch.allow_grid_import)
            else fin_cfg.grid_import_tariff_per_kwh
        )
        next_fin = replace(
            fin_cfg,
            electricity_tariff_per_kwh=fin_cfg.electricity_tariff_per_kwh * factor,
            grid_import_tariff_per_kwh=grid_imp,
        )
    elif var == "discount_rate":
        new_rate = fin_cfg.discount_rate * factor
        if not math.isfinite(new_rate) or new_rate <= -1.0:
            raise EngineError(
                "sensitivity_shift_out_of_range",
                f"Pergeseran {shift:+.0%} membuat discount_rate keluar dari batas sah.",
            )
        next_fin = replace(fin_cfg, discount_rate=new_rate)
    elif var == "biomass_fuel_price":
        next_yearly = tuple(
            replace(row, biomass_fuel_cost=row.biomass_fuel_cost * factor)
            for row in yearly
        )
    elif var == "diesel_fuel_price":
        next_yearly = tuple(
            replace(row, diesel_fuel_cost=row.diesel_fuel_cost * factor)
            for row in yearly
        )
    elif var == "om_total":
        next_fin = replace(
            fin_cfg,
            pv_fixed_om_per_kwp_year=fin_cfg.pv_fixed_om_per_kwp_year * factor,
            pv_om_fraction_of_capex=(
                fin_cfg.pv_om_fraction_of_capex * factor
                if fin_cfg.pv_om_fraction_of_capex is not None
                else None
            ),
            bess_fixed_om_per_kwh_year=fin_cfg.bess_fixed_om_per_kwh_year * factor,
            bess_om_fraction_of_capex=(
                fin_cfg.bess_om_fraction_of_capex * factor
                if fin_cfg.bess_om_fraction_of_capex is not None
                else None
            ),
            biomass_fixed_om_override=(
                fin_cfg.biomass_fixed_om_override * factor
                if fin_cfg.biomass_fixed_om_override is not None
                else None
            ),
            diesel_fixed_om_override=(
                fin_cfg.diesel_fixed_om_override * factor
                if fin_cfg.diesel_fixed_om_override is not None
                else None
            ),
        )
        next_yearly = tuple(
            replace(
                row,
                biomass_fixed_om_cost=row.biomass_fixed_om_cost * factor,
                biomass_variable_om_cost=row.biomass_variable_om_cost * factor,
                biomass_startup_cost=row.biomass_startup_cost * factor,
                diesel_fixed_om_cost=row.diesel_fixed_om_cost * factor,
                diesel_variable_om_cost=row.diesel_variable_om_cost * factor,
                diesel_startup_cost=row.diesel_startup_cost * factor,
            )
            for row in yearly
        )

    try:
        validate_finance_config(next_fin)
    except EngineError as exc:
        raise EngineError("sensitivity_shift_out_of_range", str(exc)) from exc
    return next_fin, next_yearly


def _apply_technical_shift(
    var: str,
    shift: float,
    sim_cfg: SimulationConfig,
    lifetime_cfg: LifetimeConfig,
    load_profile: LoadProfile,
) -> tuple[SimulationConfig, LifetimeConfig, LoadProfile]:
    factor = 1.0 + shift
    if var == "pv_degradation_rate":
        base_deg = (
            lifetime_cfg.pv_annual_degradation_fraction
            if lifetime_cfg.pv_annual_degradation_fraction is not None
            else (
                sim_cfg.pv.annual_degradation_fraction
                if isinstance(sim_cfg.pv, PVDetailedConfig)
                else 0.005
            )
        )
        new_deg = float(base_deg) * factor
        if not math.isfinite(new_deg) or not (0.0 <= new_deg < 1.0):
            raise EngineError(
                "sensitivity_shift_out_of_range",
                f"Pergeseran {shift:+.0%} membuat laju degradasi PV di luar rentang [0, 1).",
            )
        next_pv = (
            replace(sim_cfg.pv, annual_degradation_fraction=new_deg)
            if isinstance(sim_cfg.pv, PVDetailedConfig)
            else sim_cfg.pv
        )
        next_lc = replace(lifetime_cfg, pv_annual_degradation_fraction=new_deg)
        validate_lifetime_config(next_lc)
        return replace(sim_cfg, pv=next_pv), next_lc, load_profile

    if var == "load_scale":
        scaled_arr = np.asarray(load_profile.load_kw, dtype=np.float64) * factor
        if np.any(scaled_arr < 0.0):
            raise EngineError("sensitivity_shift_out_of_range", "Pergeseran beban tidak boleh menghasilkan nilai negatif.")
        next_lp = LoadProfile(
            load_kw=scaled_arr,
            time_config=load_profile.time_config,
            source=load_profile.source,
            total_energy_kwh=float(np.sum(scaled_arr) * load_profile.time_config.step_hours),
            peak_kw=float(np.max(scaled_arr)),
        )
        return sim_cfg, lifetime_cfg, next_lp

    # pv_capacity
    if isinstance(sim_cfg.pv, PVWattsConfig):
        new_kwp = sim_cfg.pv.capacity_kwp * factor
        new_inv = sim_cfg.pv.inverter_ac_kw * factor
        if new_kwp <= 0.0 or new_inv <= 0.0:
            raise EngineError("sensitivity_shift_out_of_range", "Kapasitas PV harus tetap positif.")
        next_pv = replace(sim_cfg.pv, capacity_kwp=new_kwp, inverter_ac_kw=new_inv)
    else:
        base_kwp = sim_cfg.pv.effective_dc_capacity_kwp
        new_kwp = base_kwp * factor
        new_inv = sim_cfg.pv.inverter_ac_kw * factor
        if new_kwp <= 0.0 or new_inv <= 0.0:
            raise EngineError("sensitivity_shift_out_of_range", "Kapasitas PV harus tetap positif.")
        next_pv = replace(
            sim_cfg.pv,
            capacity_kwp=new_kwp,
            inverter_ac_kw=new_inv,
            n_modules_series=None,
            n_strings_parallel=None,
        )
    return replace(sim_cfg, pv=next_pv), lifetime_cfg, load_profile


def _evaluate_pair_shifts(
    shifts_map: dict[str, float],
    base_sim_cfg: SimulationConfig,
    weather: WeatherDataset,
    base_load: LoadProfile,
    base_lifetime_cfg: LifetimeConfig,
    base_fin_cfg: FinanceConfig,
    base_lifetime_res: LifetimeSimulationResult,
    pv_cache: dict[tuple[Any, int], PVHourlyOutput],
) -> FinanceResult:
    sim_cfg = base_sim_cfg
    lc_cfg = base_lifetime_cfg
    lp = base_load
    shifted_tech_vars: set[str] = set()

    for var, sh in shifts_map.items():
        if var not in FINANCE_ONLY_VARIABLES and abs(sh) > 1e-12:
            sim_cfg, lc_cfg, lp = _apply_technical_shift(var, sh, sim_cfg, lc_cfg, lp)
            shifted_tech_vars.add(var)

    if shifted_tech_vars:
        if (
            base_lifetime_cfg.multi_year_mode == "scaled_year_1"
            and shifted_tech_vars == {"pv_degradation_rate"}
        ):
            # Pada mode scaled_year_1, degradasi tahunan PV baru memengaruhi Tahun 2 ke atas.
            lifetime_res = run_scaled_lifetime_from_year_1(
                sim_cfg,
                base_lifetime_res.year_1_result,
                lc_cfg,
            )
        else:
            lifetime_res = run_lifetime_simulation(
                sim_cfg,
                weather,
                lp,
                lc_cfg,
                pv_output_cache=pv_cache,
            )
    else:
        lifetime_res = base_lifetime_res

    fin_cfg = base_fin_cfg
    yearly = lifetime_res.yearly
    for var, sh in shifts_map.items():
        if var in FINANCE_ONLY_VARIABLES and abs(sh) > 1e-12:
            fin_cfg, yearly = _apply_finance_shift(var, sh, sim_cfg, fin_cfg, yearly)

    pv_kwp = (
        sim_cfg.pv.capacity_kwp
        if isinstance(sim_cfg.pv, PVWattsConfig)
        else sim_cfg.pv.effective_dc_capacity_kwp
    )
    bess_kwh = sim_cfg.bess.nominal_capacity_kwh if sim_cfg.bess is not None else 0.0
    bio_kw = sim_cfg.biomass.rated_capacity_kw if sim_cfg.biomass is not None else 0.0
    diesel_kw = sim_cfg.diesel.rated_capacity_kw if sim_cfg.diesel is not None else 0.0

    return run_financial_analysis_from_yearly(
        yearly=yearly,
        finance_config=fin_cfg,
        pv_capacity_kwp=pv_kwp,
        bess_capacity_kwh=bess_kwh,
        biomass_capacity_kw=bio_kw,
        diesel_capacity_kw=diesel_kw,
    )


def _base_summary_dict(base_fin: FinanceResult) -> dict[str, Any]:
    s = base_fin.summary
    return {
        "npv": round(s.npv, 2),
        "lcoe": round(s.lcoe, 4),
        "total_npc": round(s.total_npc, 2),
        "irr": None if s.irr is None else round(s.irr, 6),
        "irr_status": s.irr_status,
        "simple_payback_years": None if s.simple_payback_years is None else round(s.simple_payback_years, 3),
        "discounted_payback_years": None if s.discounted_payback_years is None else round(s.discounted_payback_years, 3),
        "viability_status": s.viability_status,
    }


def run_hybrid_sensitivity(
    *,
    base_sim_config: SimulationConfig,
    weather: WeatherDataset,
    load_profile: LoadProfile,
    base_lifetime_config: LifetimeConfig,
    base_finance_config: FinanceConfig,
    variables: list[str] | None = None,
    shifts: list[float] | None = None,
    matrix: dict[str, Any] | None = None,
    force_full_simulation: bool = False,
) -> dict[str, Any]:
    """Menjalankan analisis sensitivitas hybrid satu arah dan matriks 2D (5 x 5) opsional."""
    var_list = _validate_variables(list(variables) if variables is not None else list(DEFAULT_SENSITIVITY_VARIABLES))
    shift_list = _validate_shifts(
        list(shifts) if shifts is not None else list(DEFAULT_SENSITIVITY_SHIFTS),
        allow_zero=False,
    )

    pv_cache: dict[tuple[Any, int], PVHourlyOutput] = {}
    base_lifetime_res = run_lifetime_simulation(
        base_sim_config,
        weather,
        load_profile,
        base_lifetime_config,
        pv_output_cache=pv_cache,
    )
    base_fin_res = run_financial_analysis(base_lifetime_res, base_finance_config)
    base_npv = base_fin_res.summary.npv
    base_lcoe = base_fin_res.summary.lcoe

    variable_results: list[dict[str, Any]] = []
    for var in var_list:
        base_val, unit, disabled = _base_value_and_unit(
            var,
            base_sim_config,
            base_lifetime_config,
            base_finance_config,
            base_fin_res,
            load_profile,
        )
        if disabled:
            variable_results.append({
                "variable": var,
                "category": "finance_only" if var in FINANCE_ONLY_VARIABLES else "technical",
                "base_value": 0.0,
                "unit": unit,
                "skipped": True,
                "skip_reason": "component_disabled",
                "zero_base": False,
                "max_abs_npv_delta": 0.0,
                "max_abs_lcoe_delta": 0.0,
                "cases": [],
            })
            continue

        zero_base = abs(base_val) <= 1e-12
        cases: list[dict[str, Any]] = []
        for sh in shift_list:
            if force_full_simulation:
                # Mode uji pembanding: menjalankan ulang simulasi penuh meski variabel keuangan murni.
                sim_cfg = base_sim_config
                lc_cfg = base_lifetime_config
                lp = load_profile
                if var not in FINANCE_ONLY_VARIABLES:
                    sim_cfg, lc_cfg, lp = _apply_technical_shift(var, sh, sim_cfg, lc_cfg, lp)
                elif var == "biomass_fuel_price" and sim_cfg.biomass is not None:
                    base_fp = sim_cfg.biomass.effective_fuel_params.fuel_price_per_ton
                    sim_cfg = replace(sim_cfg, biomass=replace(sim_cfg.biomass, fuel_price_per_ton=base_fp * (1.0 + sh)))
                elif var == "diesel_fuel_price" and sim_cfg.diesel is not None:
                    base_dp = sim_cfg.diesel.fuel_price_per_liter
                    sim_cfg = replace(sim_cfg, diesel=replace(sim_cfg.diesel, fuel_price_per_liter=base_dp * (1.0 + sh)))
                elif var == "om_total":
                    if sim_cfg.biomass is not None:
                        sim_cfg = replace(
                            sim_cfg,
                            biomass=replace(
                                sim_cfg.biomass,
                                fixed_om_per_kw_year=sim_cfg.biomass.fixed_om_per_kw_year * (1.0 + sh),
                                variable_om_per_kwh=sim_cfg.biomass.variable_om_per_kwh * (1.0 + sh),
                                startup_cost=sim_cfg.biomass.startup_cost * (1.0 + sh),
                            ),
                        )
                    if sim_cfg.diesel is not None:
                        sim_cfg = replace(
                            sim_cfg,
                            diesel=replace(
                                sim_cfg.diesel,
                                fixed_om_per_kw_year=sim_cfg.diesel.fixed_om_per_kw_year * (1.0 + sh),
                                variable_om_per_operating_hour=sim_cfg.diesel.variable_om_per_operating_hour * (1.0 + sh),
                                startup_cost=sim_cfg.diesel.startup_cost * (1.0 + sh),
                            ),
                        )
                lt = run_lifetime_simulation(sim_cfg, weather, lp, lc_cfg, pv_output_cache=pv_cache)
                fin_shift, _ = _apply_finance_shift(
                    var if var not in ("biomass_fuel_price", "diesel_fuel_price", "om_total") else ("om_total" if var == "om_total" else "noop"),
                    sh,
                    sim_cfg,
                    base_finance_config,
                    lt.yearly,
                )
                case_fin = run_financial_analysis(lt, fin_shift)
            else:
                case_fin = _evaluate_pair_shifts(
                    {var: sh},
                    base_sim_config,
                    weather,
                    load_profile,
                    base_lifetime_config,
                    base_finance_config,
                    base_lifetime_res,
                    pv_cache,
                )

            fs = case_fin.summary
            cases.append({
                "shift_fraction": sh,
                "input_value": round(base_val * (1.0 + sh), 6),
                "npv": round(fs.npv, 2),
                "npv_delta": round(fs.npv - base_npv, 2),
                "lcoe": round(fs.lcoe, 4),
                "lcoe_delta": round(fs.lcoe - base_lcoe, 4),
                "irr": None if fs.irr is None else round(fs.irr, 6),
                "irr_status": fs.irr_status,
                "simple_payback_years": None if fs.simple_payback_years is None else round(fs.simple_payback_years, 3),
                "discounted_payback_years": None if fs.discounted_payback_years is None else round(fs.discounted_payback_years, 3),
                "viability_status": fs.viability_status,
            })

        max_npv_delta = max((abs(c["npv_delta"]) for c in cases), default=0.0)
        max_lcoe_delta = max((abs(c["lcoe_delta"]) for c in cases), default=0.0)
        variable_results.append({
            "variable": var,
            "category": "finance_only" if var in FINANCE_ONLY_VARIABLES else "technical",
            "base_value": round(base_val, 6),
            "unit": unit,
            "skipped": False,
            "skip_reason": None,
            "zero_base": zero_base,
            "max_abs_npv_delta": round(max_npv_delta, 2),
            "max_abs_lcoe_delta": round(max_lcoe_delta, 4),
            "cases": cases,
        })

    variable_results.sort(key=lambda r: (1 if r["skipped"] else 0, -r["max_abs_npv_delta"]))

    matrix_result: dict[str, Any] | None = None
    if matrix is not None:
        x_var = str(matrix["x_variable"])
        y_var = str(matrix["y_variable"])
        if x_var not in ALL_SENSITIVITY_VARIABLES or y_var not in ALL_SENSITIVITY_VARIABLES or x_var == y_var:
            raise EngineError(
                "invalid_matrix_axes",
                "Sumbu X dan Y matriks sensitivitas harus merupakan variabel yang sah dan berbeda.",
            )
        x_shifts = _validate_shifts(list(matrix["x_shifts"]), allow_zero=True, max_len=5)
        y_shifts = _validate_shifts(list(matrix["y_shifts"]), allow_zero=True, max_len=5)

        if (x_var == "biomass_fuel_price" or y_var == "biomass_fuel_price") and base_sim_config.biomass is None:
            raise EngineError(
                "invalid_matrix_axes",
                "Variabel biomass_fuel_price tidak dapat dipakai pada matriks saat Biomass nonaktif.",
            )
        if (x_var == "diesel_fuel_price" or y_var == "diesel_fuel_price") and base_sim_config.diesel is None:
            raise EngineError(
                "invalid_matrix_axes",
                "Variabel diesel_fuel_price tidak dapat dipakai pada matriks saat Diesel Generator nonaktif.",
            )

        cells: list[dict[str, Any]] = []
        for xi, x_sh in enumerate(x_shifts):
            for yi, y_sh in enumerate(y_shifts):
                cell_fin = _evaluate_pair_shifts(
                    {x_var: x_sh, y_var: y_sh},
                    base_sim_config,
                    weather,
                    load_profile,
                    base_lifetime_config,
                    base_finance_config,
                    base_lifetime_res,
                    pv_cache,
                )
                fs = cell_fin.summary
                cells.append({
                    "x_index": xi,
                    "y_index": yi,
                    "x_shift": x_sh,
                    "y_shift": y_sh,
                    "npv": round(fs.npv, 2),
                    "npv_delta": round(fs.npv - base_npv, 2),
                    "lcoe": round(fs.lcoe, 4),
                    "lcoe_delta": round(fs.lcoe - base_lcoe, 4),
                    "irr": None if fs.irr is None else round(fs.irr, 6),
                    "viability_status": fs.viability_status,
                })

        matrix_result = {
            "x_variable": x_var,
            "x_shifts": x_shifts,
            "y_variable": y_var,
            "y_shifts": y_shifts,
            "cells": cells,
        }

    return {
        "currency_code": base_finance_config.currency_code,
        "base": _base_summary_dict(base_fin_res),
        "variables": variable_results,
        "matrix_result": matrix_result,
    }
