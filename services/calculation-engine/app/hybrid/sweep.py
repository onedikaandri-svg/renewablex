"""Mesin sapuan kombinasi ukuran komponen gaya HOMER untuk sistem energi hybrid."""

from dataclasses import replace
import math
import threading
from typing import Any, Literal

from app.errors import EngineError
from app.hybrid.bess import BESSComponent, BESSConfig
from app.hybrid.biomass import BiomassComponent, BiomassConfig, build_sample_biomass_config
from app.hybrid.components import PVHourlyOutput, PVWattsConfig
from app.hybrid.finance import (
    FinanceConfig,
    FinanceResult,
    run_financial_analysis,
)
from app.hybrid.lifetime import LifetimeConfig, run_lifetime_simulation
from app.hybrid.load import LoadProfile
from app.hybrid.pv_detailed import PVDetailedConfig
from app.hybrid.simulator import SimulationConfig
from app.hybrid.weather import WeatherDataset

MAX_SWEEP_COMBINATIONS_SCALED = 64
MAX_SWEEP_COMBINATIONS_FULL_HOURLY = 12
MAX_SWEEP_AXIS_VALUES = 10
DEFAULT_INVERTER_DC_AC_RATIO = 1.19
DEFAULT_BESS_C_RATE = 0.5

SortByMode = Literal[
    "lcoe_asc",
    "total_npc_asc",
    "npv_desc",
    "irr_desc",
    "renewable_fraction_desc",
]
InverterSizingMode = Literal["keep_dc_ac_ratio", "fixed"]


def validate_sweep_axis(
    values: list[float],
    axis_name: str,
    *,
    allow_zero: bool,
) -> list[float]:
    """Memvalidasi daftar ukuran kandidat untuk satu sumbu sapuan."""
    if not values or len(values) > MAX_SWEEP_AXIS_VALUES:
        raise EngineError(
            "invalid_sweep_axis",
            f"Sumbu {axis_name} harus berisi antara 1 hingga {MAX_SWEEP_AXIS_VALUES} nilai.",
        )

    cleaned: list[float] = []
    for raw in values:
        val = float(raw)
        if not math.isfinite(val):
            raise EngineError("invalid_sweep_axis", f"Nilai pada sumbu {axis_name} harus berupa angka hingga.")
        if allow_zero:
            if val < 0.0:
                raise EngineError("invalid_sweep_axis", f"Nilai pada sumbu {axis_name} tidak boleh negatif.")
        else:
            if val <= 0.0:
                raise EngineError("invalid_sweep_axis", f"Nilai pada sumbu {axis_name} harus lebih besar dari 0.")
        if any(abs(existing - val) <= 1e-9 for existing in cleaned):
            raise EngineError("invalid_sweep_axis", f"Sumbu {axis_name} tidak boleh memiliki nilai duplikat.")
        cleaned.append(val)
    return cleaned


def validate_sweep_limits(
    pv_values: list[float],
    bess_values: list[float],
    biomass_values: list[float],
    multi_year_mode: str,
) -> int:
    """Memeriksa batas aman jumlah kombinasi terhadap mode multi-tahun."""
    total = len(pv_values) * len(bess_values) * len(biomass_values)
    if multi_year_mode == "full_hourly" and total > MAX_SWEEP_COMBINATIONS_FULL_HOURLY:
        raise EngineError(
            "sweep_full_hourly_limit_exceeded",
            f"Mode full_hourly dibatasi maksimal {MAX_SWEEP_COMBINATIONS_FULL_HOURLY} kombinasi (saat ini {total}).",
        )
    if total > MAX_SWEEP_COMBINATIONS_SCALED:
        raise EngineError(
            "sweep_combinations_exceeded",
            f"Jumlah kombinasi sapuan maksimal {MAX_SWEEP_COMBINATIONS_SCALED} (saat ini {total}).",
        )
    return total


def _scale_pv_config(
    base_pv: PVWattsConfig | PVDetailedConfig,
    target_kwp: float,
    inverter_sizing_mode: InverterSizingMode,
) -> tuple[PVWattsConfig | PVDetailedConfig, float]:
    base_kwp = (
        base_pv.capacity_kwp
        if isinstance(base_pv, PVWattsConfig)
        else base_pv.effective_dc_capacity_kwp
    )
    base_inv_kw = float(base_pv.inverter_ac_kw) if base_pv.inverter_ac_kw > 0 else (base_kwp / DEFAULT_INVERTER_DC_AC_RATIO)

    if inverter_sizing_mode == "keep_dc_ac_ratio":
        ratio = (base_kwp / base_inv_kw) if base_inv_kw > 0 else DEFAULT_INVERTER_DC_AC_RATIO
        target_inv_kw = target_kwp / ratio
    else:
        target_inv_kw = base_inv_kw

    if isinstance(base_pv, PVWattsConfig):
        scaled_pv: PVWattsConfig | PVDetailedConfig = replace(
            base_pv,
            capacity_kwp=target_kwp,
            inverter_ac_kw=target_inv_kw,
        )
    else:
        scaled_pv = replace(
            base_pv,
            capacity_kwp=target_kwp,
            inverter_ac_kw=target_inv_kw,
            n_modules_series=None,
            n_strings_parallel=None,
        )
    inv_scale = (target_inv_kw / base_inv_kw) if base_inv_kw > 0 else 1.0
    return scaled_pv, inv_scale


def _scale_bess_config(
    base_bess: BESSConfig | None,
    target_kwh: float,
    finance_cfg: FinanceConfig,
    scale_replacement_costs: bool,
    bess_replacement_cost_per_kwh: float | None,
) -> BESSConfig | None:
    if target_kwh <= 0.0:
        return None

    if base_bess is not None and base_bess.nominal_capacity_kwh > 0.0:
        base_kwh = base_bess.nominal_capacity_kwh
        chg_rate = base_bess.rated_max_charge_kw / base_kwh
        dis_rate = base_bess.rated_max_discharge_kw / base_kwh
        if bess_replacement_cost_per_kwh is not None:
            repl_cost = bess_replacement_cost_per_kwh * target_kwh
        elif scale_replacement_costs:
            repl_cost = (base_bess.replacement_cost / base_kwh) * target_kwh
        else:
            repl_cost = base_bess.replacement_cost

        cand = replace(
            base_bess,
            nominal_capacity_kwh=target_kwh,
            max_charge_kw=target_kwh * chg_rate,
            max_discharge_kw=target_kwh * dis_rate,
            c_rate_charge=None,
            c_rate_discharge=None,
            replacement_cost=repl_cost,
        )
    else:
        per_kwh_repl = (
            bess_replacement_cost_per_kwh
            if bess_replacement_cost_per_kwh is not None
            else finance_cfg.bess_capex_per_kwh
        )
        cand = BESSConfig(
            nominal_capacity_kwh=target_kwh,
            max_charge_kw=target_kwh * DEFAULT_BESS_C_RATE,
            max_discharge_kw=target_kwh * DEFAULT_BESS_C_RATE,
            replacement_cost=per_kwh_repl * target_kwh if scale_replacement_costs else 0.0,
        )

    BESSComponent(cand).validate()
    return cand


def _scale_biomass_config(
    base_biomass: BiomassConfig | None,
    target_kw: float,
    scale_replacement_costs: bool,
) -> BiomassConfig | None:
    if target_kw <= 0.0:
        return None

    ref = base_biomass
    if ref is None:
        # Gunakan profil sampel standar [REAL DATA] bila proyek dasar belum mengaktifkan Biomass.
        ref = build_sample_biomass_config(
            sample_name="sample_gasifier_250kw",
            fuel_preset="efb",
            fixed_om_per_kw_year=450_000.0,
            variable_om_per_kwh=120.0,
            overhaul_cost=150_000_000.0,
        )

    base_kw = ref.rated_capacity_kw if ref.rated_capacity_kw > 0.0 else 250.0
    scale = target_kw / base_kw

    cand = replace(
        ref,
        rated_capacity_kw=target_kw,
        min_load_kw=(ref.min_load_kw * scale) if ref.min_load_kw is not None else None,
        ramp_up_kw_per_hour=ref.ramp_up_kw_per_hour * scale,
        ramp_down_kw_per_hour=ref.ramp_down_kw_per_hour * scale,
        overhaul_cost=(ref.overhaul_cost * scale) if scale_replacement_costs else ref.overhaul_cost,
    )
    BiomassComponent(cand).validate()
    return cand


def _sort_key_for_combo(combo: dict[str, Any], sort_by: SortByMode, feasible_first: bool) -> tuple[Any, ...]:
    fin = combo["finance"]
    tech = combo["technical"]
    feasible_rank = 0 if (not feasible_first or combo["feasible"]) else 1

    if sort_by == "lcoe_asc":
        metric_key: tuple[Any, ...] = (fin["lcoe"], fin["total_npc"])
    elif sort_by == "total_npc_asc":
        metric_key = (fin["total_npc"], fin["lcoe"])
    elif sort_by == "npv_desc":
        metric_key = (-fin["npv"], fin["lcoe"])
    elif sort_by == "irr_desc":
        irr_val = fin["irr"]
        metric_key = (0 if irr_val is not None else 1, -(irr_val or 0.0), -fin["npv"])
    else:
        metric_key = (-tech["renewable_fraction"], fin["lcoe"])

    return (feasible_rank, *metric_key, combo["combination_id"])


def run_hybrid_sweep(
    *,
    base_sim_config: SimulationConfig,
    weather: WeatherDataset,
    load_profile: LoadProfile,
    base_lifetime_config: LifetimeConfig,
    base_finance_config: FinanceConfig,
    pv_values: list[float],
    bess_values: list[float],
    biomass_values: list[float],
    inverter_sizing_mode: InverterSizingMode = "keep_dc_ac_ratio",
    scale_replacement_costs: bool = True,
    bess_replacement_cost_per_kwh: float | None = None,
    max_unmet_load_fraction: float | None = None,
    min_renewable_fraction: float | None = None,
    sort_by: SortByMode = "lcoe_asc",
    feasible_first: bool = True,
    use_pv_cache: bool = True,
    progress_callback: Any = None,
    cancel_event: threading.Event | None = None,
) -> dict[str, Any]:
    """Menjalankan sapuan kombinasi ukuran PV, BESS, dan Biomass lalu mengurutkan hasilnya."""
    pv_clean = validate_sweep_axis(pv_values, "pv_capacity_kwp_values", allow_zero=False)
    bess_clean = validate_sweep_axis(bess_values, "bess_capacity_kwh_values", allow_zero=True)
    bio_clean = validate_sweep_axis(biomass_values, "biomass_capacity_kw_values", allow_zero=True)

    total = validate_sweep_limits(
        pv_clean,
        bess_clean,
        bio_clean,
        base_lifetime_config.multi_year_mode,
    )

    if max_unmet_load_fraction is not None and not (0.0 <= max_unmet_load_fraction <= 1.0):
        raise EngineError("invalid_sweep_axis", "max_unmet_load_fraction harus antara 0 dan 1.")
    if min_renewable_fraction is not None and not (0.0 <= min_renewable_fraction <= 1.0):
        raise EngineError("invalid_sweep_axis", "min_renewable_fraction harus antara 0 dan 1.")

    pv_cache: dict[tuple[Any, int], PVHourlyOutput] | None = {} if use_pv_cache else None
    combinations: list[dict[str, Any]] = []
    done_count = 0

    for pv_kwp in pv_clean:
        scaled_pv, inv_scale = _scale_pv_config(base_sim_config.pv, pv_kwp, inverter_sizing_mode)
        cand_inv_kw = float(scaled_pv.inverter_ac_kw)
        cand_lifetime = replace(
            base_lifetime_config,
            inverter_replacement_cost=(
                base_lifetime_config.inverter_replacement_cost * inv_scale
                if scale_replacement_costs
                else base_lifetime_config.inverter_replacement_cost
            ),
        )

        for bess_kwh in bess_clean:
            cand_bess = _scale_bess_config(
                base_sim_config.bess,
                bess_kwh,
                base_finance_config,
                scale_replacement_costs,
                bess_replacement_cost_per_kwh,
            )

            for bio_kw in bio_clean:
                if cancel_event is not None and cancel_event.is_set():
                    raise EngineError("sweep_job_cancelled", "Job sapuan kombinasi dibatalkan oleh pengguna.")

                cand_bio = _scale_biomass_config(
                    base_sim_config.biomass,
                    bio_kw,
                    scale_replacement_costs,
                )

                cand_sim = replace(
                    base_sim_config,
                    pv=scaled_pv,
                    bess=cand_bess,
                    biomass=cand_bio,
                )

                lifetime_res = run_lifetime_simulation(
                    cand_sim,
                    weather,
                    load_profile,
                    cand_lifetime,
                    pv_output_cache=pv_cache,
                )
                fin_res: FinanceResult = run_financial_analysis(lifetime_res, base_finance_config)

                y1 = lifetime_res.year_1_result
                y1_summary = y1.summary
                unmet_frac = (
                    y1_summary.unmet_load_kwh / y1_summary.total_load_kwh
                    if y1_summary.total_load_kwh > 0.0
                    else 0.0
                )

                infeasible_reasons: list[str] = []
                if max_unmet_load_fraction is not None and unmet_frac > max_unmet_load_fraction + 1e-9:
                    infeasible_reasons.append("unmet_load_exceeded")
                if min_renewable_fraction is not None and y1_summary.renewable_fraction + 1e-9 < min_renewable_fraction:
                    infeasible_reasons.append("renewable_fraction_below_min")

                combo_id = f"pv{pv_kwp:g}-bess{bess_kwh:g}-bio{bio_kw:g}"
                fs = fin_res.summary
                em = fin_res.emissions

                combinations.append({
                    "rank": 0,
                    "combination_id": combo_id,
                    "feasible": len(infeasible_reasons) == 0,
                    "infeasible_reasons": infeasible_reasons,
                    "sizing": {
                        "pv_capacity_kwp": round(pv_kwp, 3),
                        "pv_inverter_ac_kw": round(cand_inv_kw, 3),
                        "bess_enabled": cand_bess is not None,
                        "bess_nominal_capacity_kwh": round(bess_kwh, 3),
                        "bess_max_charge_kw": round(cand_bess.rated_max_charge_kw, 3) if cand_bess is not None else 0.0,
                        "bess_max_discharge_kw": round(cand_bess.rated_max_discharge_kw, 3) if cand_bess is not None else 0.0,
                        "biomass_enabled": cand_bio is not None,
                        "biomass_rated_capacity_kw": round(bio_kw, 3),
                    },
                    "technical": {
                        "pv_generation_kwh": round(y1_summary.pv_generation_kwh, 3),
                        "biomass_generation_kwh": round(
                            y1.biomass_summary.total_generation_kwh if y1.biomass_summary is not None else 0.0,
                            3,
                        ),
                        "served_load_kwh": round(y1_summary.served_load_kwh, 3),
                        "unmet_load_kwh": round(y1_summary.unmet_load_kwh, 3),
                        "unmet_load_fraction": round(unmet_frac, 6),
                        "curtailment_kwh": round(y1_summary.curtailment_kwh, 3),
                        "renewable_fraction": round(y1_summary.renewable_fraction, 6),
                        "bess_equivalent_full_cycles": round(
                            y1.bess_summary.equivalent_full_cycles if y1.bess_summary is not None else 0.0,
                            3,
                        ),
                        "biomass_fuel_tons": round(
                            y1.biomass_summary.total_fuel_tons if y1.biomass_summary is not None else 0.0,
                            3,
                        ),
                        "avoided_emissions_tons_co2e": round(em.avoided_emissions_tons_co2e, 3),
                    },
                    "finance": {
                        "currency_code": fs.currency_code,
                        "gross_capex": round(fs.gross_capex, 2),
                        "net_capex": round(fs.net_capex, 2),
                        "total_npc": round(fs.total_npc, 2),
                        "lcoe": round(fs.lcoe, 4),
                        "npv": round(fs.npv, 2),
                        "irr": None if fs.irr is None else round(fs.irr, 6),
                        "irr_status": fs.irr_status,
                        "simple_payback_years": None if fs.simple_payback_years is None else round(fs.simple_payback_years, 3),
                        "discounted_payback_years": None if fs.discounted_payback_years is None else round(fs.discounted_payback_years, 3),
                        "viability_status": fs.viability_status,
                    },
                })

                done_count += 1
                if progress_callback is not None:
                    progress_callback(done_count, total, combo_id)

    combinations.sort(key=lambda item: _sort_key_for_combo(item, sort_by, feasible_first))
    for idx, item in enumerate(combinations, start=1):
        item["rank"] = idx

    feasible_count = sum(1 for c in combinations if c["feasible"])
    best_id = combinations[0]["combination_id"] if combinations else None

    return {
        "sort_by": sort_by,
        "feasible_count": feasible_count,
        "total_combinations": total,
        "best_combination_id": best_id,
        "combinations": combinations,
    }
