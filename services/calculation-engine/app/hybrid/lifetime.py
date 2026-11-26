"""Orkestrator simulasi umur proyek multi-tahun dengan degradasi dan penggantian komponen."""

from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
import math
from typing import Any, Literal

import numpy as np

from app.errors import EngineError
from app.hybrid.components import LifecycleEvent, PVWattsConfig
from app.hybrid.load import LoadProfile
from app.hybrid.pv_detailed import PVDetailedConfig
from app.hybrid.simulator import SimulationConfig, SimulationResult, run_simulation
from app.hybrid.weather import WeatherDataset

MultiYearMode = Literal["full_hourly", "scaled_year_1"]
DEFAULT_PVWATTS_DEGRADATION_FRACTION = 0.005  # [REAL DATA] 0.5% per tahun sesuai docs/assumptions.md


@dataclass(frozen=True)
class LifetimeConfig:
    """Konfigurasi simulasi umur proyek multi-tahun."""

    project_lifetime_years: int = 25
    multi_year_mode: MultiYearMode = "full_hourly"
    pv_annual_degradation_fraction: float | None = None
    inverter_replacement_year: int | None = None
    inverter_replacement_cost: float = 0.0
    scaled_bess_replacement_interval_years: int | None = None
    scaled_biomass_overhaul_interval_years: int | None = None


def validate_lifetime_config(config: LifetimeConfig) -> None:
    """Memvalidasi parameter konfigurasi simulasi multi-tahun."""
    if isinstance(config.project_lifetime_years, bool) or not isinstance(config.project_lifetime_years, int):
        raise EngineError("invalid_lifetime_config", "project_lifetime_years harus berupa bilangan bulat.")
    if not (1 <= config.project_lifetime_years <= 40):
        raise EngineError("invalid_lifetime_config", "project_lifetime_years harus berada di antara 1 dan 40 tahun.")
    if config.multi_year_mode not in ("full_hourly", "scaled_year_1"):
        raise EngineError(
            "invalid_lifetime_config",
            f"multi_year_mode tidak dikenal: {config.multi_year_mode}.",
        )
    if config.pv_annual_degradation_fraction is not None:
        deg = config.pv_annual_degradation_fraction
        if not math.isfinite(deg) or not (0.0 <= deg < 1.0):
            raise EngineError(
                "invalid_lifetime_config",
                "pv_annual_degradation_fraction harus berada di antara 0 dan kurang dari 1.",
            )
    if config.inverter_replacement_year is not None:
        yr = config.inverter_replacement_year
        if isinstance(yr, bool) or not isinstance(yr, int) or not (1 <= yr <= config.project_lifetime_years):
            raise EngineError(
                "invalid_lifetime_config",
                "inverter_replacement_year harus berada di rentang 1..project_lifetime_years.",
            )
    if not math.isfinite(config.inverter_replacement_cost) or config.inverter_replacement_cost < 0.0:
        raise EngineError("invalid_lifetime_config", "inverter_replacement_cost tidak boleh negatif.")
    for name, iv in (
        ("scaled_bess_replacement_interval_years", config.scaled_bess_replacement_interval_years),
        ("scaled_biomass_overhaul_interval_years", config.scaled_biomass_overhaul_interval_years),
    ):
        if iv is not None and (isinstance(iv, bool) or not isinstance(iv, int) or iv <= 0):
            raise EngineError("invalid_lifetime_config", f"{name} harus berupa bilangan bulat positif.")


@dataclass(frozen=True)
class YearlyTechnicalResult:
    """Ringkasan hasil teknis dan kejadian umur proyek untuk satu tahun simulasi."""

    year: int
    pv_degradation_factor: float
    total_load_kwh: float
    pv_generation_kwh: float
    biomass_generation_kwh: float
    served_load_kwh: float
    unmet_load_kwh: float
    curtailment_kwh: float
    grid_import_kwh: float
    grid_export_kwh: float
    renewable_fraction: float
    max_balance_error_kw: float
    bess_charge_kwh: float = 0.0
    bess_discharge_kwh: float = 0.0
    bess_yearly_efc: float = 0.0
    bess_final_effective_capacity_kwh: float = 0.0
    bess_replacement_count: int = 0
    biomass_operating_hours: float = 0.0
    biomass_fuel_tons: float = 0.0
    biomass_fuel_cost: float = 0.0
    biomass_logistics_cost: float = 0.0
    biomass_variable_om_cost: float = 0.0
    biomass_fixed_om_cost: float = 0.0
    biomass_startup_cost: float = 0.0
    biomass_co2e_kg: float = 0.0
    biomass_overhaul_count: int = 0
    biomass_thermal_output_kwh_th: float = 0.0
    lifecycle_events: tuple[LifecycleEvent, ...] = ()


@dataclass(frozen=True)
class LifetimeSimulationResult:
    """Keluaran lengkap simulasi umur proyek multi-tahun."""

    lifetime_config: LifetimeConfig
    year_1_result: SimulationResult
    yearly: tuple[YearlyTechnicalResult, ...]
    all_lifecycle_events: tuple[LifecycleEvent, ...]
    total_load_kwh: float
    total_pv_generation_kwh: float
    total_biomass_generation_kwh: float
    total_served_load_kwh: float
    total_unmet_load_kwh: float
    total_curtailment_kwh: float
    total_grid_import_kwh: float
    total_grid_export_kwh: float
    total_bess_replacements: int
    total_biomass_overhauls: int
    max_balance_error_kw: float

    def to_summary_dict(self) -> dict[str, Any]:
        """Mengembalikan ringkasan umur proyek siap serialisasi JSON."""
        return {
            "project_lifetime_years": self.lifetime_config.project_lifetime_years,
            "multi_year_mode": self.lifetime_config.multi_year_mode,
            "total_load_kwh": self.total_load_kwh,
            "total_pv_generation_kwh": self.total_pv_generation_kwh,
            "total_biomass_generation_kwh": self.total_biomass_generation_kwh,
            "total_served_load_kwh": self.total_served_load_kwh,
            "total_unmet_load_kwh": self.total_unmet_load_kwh,
            "total_curtailment_kwh": self.total_curtailment_kwh,
            "total_grid_import_kwh": self.total_grid_import_kwh,
            "total_grid_export_kwh": self.total_grid_export_kwh,
            "total_bess_replacements": self.total_bess_replacements,
            "total_biomass_overhauls": self.total_biomass_overhauls,
            "max_balance_error_kw": self.max_balance_error_kw,
            "lifecycle_events": [asdict(ev) for ev in self.all_lifecycle_events],
            "yearly": [
                {
                    "year": r.year,
                    "pv_degradation_factor": r.pv_degradation_factor,
                    "total_load_kwh": r.total_load_kwh,
                    "pv_generation_kwh": r.pv_generation_kwh,
                    "biomass_generation_kwh": r.biomass_generation_kwh,
                    "served_load_kwh": r.served_load_kwh,
                    "unmet_load_kwh": r.unmet_load_kwh,
                    "curtailment_kwh": r.curtailment_kwh,
                    "grid_import_kwh": r.grid_import_kwh,
                    "grid_export_kwh": r.grid_export_kwh,
                    "renewable_fraction": r.renewable_fraction,
                    "bess_yearly_efc": r.bess_yearly_efc,
                    "bess_final_effective_capacity_kwh": r.bess_final_effective_capacity_kwh,
                    "bess_replacement_count": r.bess_replacement_count,
                    "biomass_fuel_tons": r.biomass_fuel_tons,
                    "biomass_overhaul_count": r.biomass_overhaul_count,
                }
                for r in self.yearly
            ],
        }


def _resolve_pv_degradation(config: SimulationConfig, lifetime_config: LifetimeConfig) -> float:
    if lifetime_config.pv_annual_degradation_fraction is not None:
        return float(lifetime_config.pv_annual_degradation_fraction)
    if isinstance(config.pv, PVDetailedConfig):
        return float(config.pv.annual_degradation_fraction)
    return DEFAULT_PVWATTS_DEGRADATION_FRACTION


def _make_year_sim_config(
    base_config: SimulationConfig,
    year: int,
    pv_deg: float,
) -> SimulationConfig:
    if isinstance(base_config.pv, PVDetailedConfig):
        pv_year = replace(
            base_config.pv,
            simulation_year=year,
            annual_degradation_fraction=pv_deg,
        )
    else:
        deg_factor = (1.0 - pv_deg) ** (year - 1)
        pv_year = replace(
            base_config.pv,
            capacity_kwp=max(base_config.pv.capacity_kwp * deg_factor, 1e-9),
        )

    biomass_year = base_config.biomass
    if biomass_year is not None:
        biomass_year = replace(biomass_year, outage_seed=base_config.biomass.outage_seed + (year - 1))

    return replace(base_config, pv=pv_year, biomass=biomass_year)


def _inverter_event_for_year(lifetime_config: LifetimeConfig, year: int) -> list[LifecycleEvent]:
    if lifetime_config.inverter_replacement_year == year:
        return [
            LifecycleEvent(
                year=year,
                event_type="inverter_replacement",
                description=f"Penggantian inverter terjadwal pada tahun ke-{year}.",
                cost_amount=float(lifetime_config.inverter_replacement_cost),
            )
        ]
    return []


def _extract_yearly_row(
    sim_res: SimulationResult,
    year: int,
    deg_factor: float,
    prev_bess_efc: float,
    extra_events: list[LifecycleEvent],
) -> tuple[YearlyTechnicalResult, float]:
    h = sim_res.config.time_config.step_hours
    grid_imp_kwh = float(np.sum(sim_res.balance.grid_import_kw) * h)
    grid_exp_kwh = float(np.sum(sim_res.balance.grid_export_kw) * h)

    bess_chg = 0.0
    bess_dis = 0.0
    bess_yearly_efc = 0.0
    bess_cap_end = 0.0
    bess_repl = 0
    new_efc_total = prev_bess_efc
    if sim_res.bess_summary is not None:
        bess_chg = sim_res.bess_summary.total_charge_kwh
        bess_dis = sim_res.bess_summary.total_discharge_kwh
        new_efc_total = sim_res.bess_summary.equivalent_full_cycles
        bess_yearly_efc = max(new_efc_total - prev_bess_efc, 0.0)
        bess_cap_end = sim_res.bess_summary.final_effective_capacity_kwh
        bess_repl = sim_res.bess_summary.replacement_count

    bio_gen = 0.0
    bio_hrs = 0.0
    bio_tons = 0.0
    bio_fuel_cost = 0.0
    bio_log_cost = 0.0
    bio_var_om = 0.0
    bio_fix_om = 0.0
    bio_start_cost = 0.0
    bio_co2 = 0.0
    bio_oh = 0
    bio_th = 0.0
    if sim_res.biomass_summary is not None:
        bs = sim_res.biomass_summary
        bio_gen = bs.total_generation_kwh
        bio_hrs = bs.total_operating_hours
        bio_tons = bs.total_fuel_tons
        bio_fuel_cost = bs.total_fuel_cost
        bio_log_cost = bs.total_logistics_cost
        bio_var_om = bs.total_variable_om_cost
        bio_fix_om = bs.total_fixed_om_cost
        bio_start_cost = bs.total_startup_cost
        bio_co2 = bs.total_co2e_kg
        bio_oh = bs.overhaul_count
        bio_th = bs.total_thermal_output_kwh_th

    events = tuple(list(sim_res.lifecycle_events) + extra_events)
    row = YearlyTechnicalResult(
        year=year,
        pv_degradation_factor=deg_factor,
        total_load_kwh=sim_res.summary.total_load_kwh,
        pv_generation_kwh=sim_res.summary.pv_generation_kwh,
        biomass_generation_kwh=bio_gen,
        served_load_kwh=sim_res.summary.served_load_kwh,
        unmet_load_kwh=sim_res.summary.unmet_load_kwh,
        curtailment_kwh=sim_res.summary.curtailment_kwh,
        grid_import_kwh=grid_imp_kwh,
        grid_export_kwh=grid_exp_kwh,
        renewable_fraction=sim_res.summary.renewable_fraction,
        max_balance_error_kw=sim_res.summary.max_balance_error_kw,
        bess_charge_kwh=bess_chg,
        bess_discharge_kwh=bess_dis,
        bess_yearly_efc=bess_yearly_efc,
        bess_final_effective_capacity_kwh=bess_cap_end,
        bess_replacement_count=bess_repl,
        biomass_operating_hours=bio_hrs,
        biomass_fuel_tons=bio_tons,
        biomass_fuel_cost=bio_fuel_cost,
        biomass_logistics_cost=bio_log_cost,
        biomass_variable_om_cost=bio_var_om,
        biomass_fixed_om_cost=bio_fix_om,
        biomass_startup_cost=bio_start_cost,
        biomass_co2e_kg=bio_co2,
        biomass_overhaul_count=bio_oh,
        biomass_thermal_output_kwh_th=bio_th,
        lifecycle_events=events,
    )
    return row, new_efc_total


def run_lifetime_simulation(
    config: SimulationConfig,
    weather: WeatherDataset,
    load_profile: LoadProfile,
    lifetime_config: LifetimeConfig | None = None,
    progress_callback: Callable[[int, int], None] | None = None,
) -> LifetimeSimulationResult:
    """Menjalankan simulasi multi-tahun (full_hourly atau scaled_year_1) beserta kejadian umur."""
    lc = lifetime_config if lifetime_config is not None else LifetimeConfig()
    validate_lifetime_config(lc)
    pv_deg = _resolve_pv_degradation(config, lc)

    yearly_rows: list[YearlyTechnicalResult] = []
    all_events: list[LifecycleEvent] = []
    year_1_res: SimulationResult | None = None

    if lc.multi_year_mode == "full_hourly":
        bess_state: dict[str, Any] | None = None
        biomass_state: dict[str, Any] | None = None
        prev_efc = 0.0

        for year in range(1, lc.project_lifetime_years + 1):
            yr_cfg = _make_year_sim_config(config, year, pv_deg)
            res = run_simulation(
                yr_cfg,
                weather,
                load_profile,
                initial_bess_state=bess_state,
                initial_biomass_state=biomass_state,
                simulation_year=year,
            )
            if year == 1:
                year_1_res = res

            bess_state = res.final_bess_state
            biomass_state = res.final_biomass_state
            deg_factor = (1.0 - pv_deg) ** (year - 1)
            inv_events = _inverter_event_for_year(lc, year)
            row, prev_efc = _extract_yearly_row(res, year, deg_factor, prev_efc, inv_events)
            yearly_rows.append(row)
            all_events.extend(row.lifecycle_events)
            if progress_callback is not None:
                progress_callback(year, lc.project_lifetime_years)
    else:
        yr1_cfg = _make_year_sim_config(config, 1, pv_deg)
        res1 = run_simulation(yr1_cfg, weather, load_profile, simulation_year=1)
        year_1_res = res1
        row1, prev_efc = _extract_yearly_row(res1, 1, 1.0, 0.0, _inverter_event_for_year(lc, 1))
        yearly_rows.append(row1)
        all_events.extend(row1.lifecycle_events)
        if progress_callback is not None:
            progress_callback(1, lc.project_lifetime_years)

        y1_pv_to_load = max(row1.served_load_kwh - row1.grid_import_kwh - row1.biomass_generation_kwh, 0.0)
        for year in range(2, lc.project_lifetime_years + 1):
            deg_factor = (1.0 - pv_deg) ** (year - 1)
            pv_kwh = row1.pv_generation_kwh * deg_factor
            pv_served = y1_pv_to_load * deg_factor
            pv_drop = y1_pv_to_load - pv_served

            extra_events = _inverter_event_for_year(lc, year)
            bess_repl = 0
            if (
                config.bess is not None
                and lc.scaled_bess_replacement_interval_years is not None
                and year % lc.scaled_bess_replacement_interval_years == 0
            ):
                bess_repl = 1
                extra_events.append(
                    LifecycleEvent(
                        year=year,
                        event_type="bess_replacement",
                        description=f"Penggantian BESS terjadwal (scaled_year_1) pada tahun ke-{year}.",
                        cost_amount=float(config.bess.replacement_cost),
                    )
                )

            bio_oh = 0
            if (
                config.biomass is not None
                and lc.scaled_biomass_overhaul_interval_years is not None
                and year % lc.scaled_biomass_overhaul_interval_years == 0
            ):
                bio_oh = 1
                extra_events.append(
                    LifecycleEvent(
                        year=year,
                        event_type="biomass_overhaul",
                        description=f"Overhaul Biomass terjadwal (scaled_year_1) pada tahun ke-{year}.",
                        cost_amount=float(config.biomass.overhaul_cost),
                    )
                )

            if row1.grid_import_kwh > 0.0:
                grid_imp = row1.grid_import_kwh + pv_drop
                served = row1.served_load_kwh
                unmet = row1.unmet_load_kwh
            else:
                grid_imp = 0.0
                served = min(pv_served + row1.biomass_generation_kwh, row1.total_load_kwh)
                unmet = max(row1.total_load_kwh - served, 0.0)

            curtail = row1.curtailment_kwh * deg_factor
            grid_exp = row1.grid_export_kwh * deg_factor
            non_ren_bio = (
                row1.biomass_generation_kwh
                if (config.biomass is not None and not config.biomass.effective_is_renewable)
                else 0.0
            )
            ren_frac = (
                min(max((served - grid_imp - non_ren_bio) / row1.total_load_kwh, 0.0), 1.0)
                if row1.total_load_kwh > 0.0
                else 0.0
            )

            row_y = replace(
                row1,
                year=year,
                pv_degradation_factor=deg_factor,
                pv_generation_kwh=pv_kwh,
                served_load_kwh=served,
                unmet_load_kwh=unmet,
                curtailment_kwh=curtail,
                grid_import_kwh=grid_imp,
                grid_export_kwh=grid_exp,
                renewable_fraction=ren_frac,
                bess_replacement_count=bess_repl,
                biomass_overhaul_count=bio_oh,
                lifecycle_events=tuple(extra_events),
            )
            yearly_rows.append(row_y)
            all_events.extend(extra_events)

    assert year_1_res is not None
    return LifetimeSimulationResult(
        lifetime_config=lc,
        year_1_result=year_1_res,
        yearly=tuple(yearly_rows),
        all_lifecycle_events=tuple(all_events),
        total_load_kwh=sum(r.total_load_kwh for r in yearly_rows),
        total_pv_generation_kwh=sum(r.pv_generation_kwh for r in yearly_rows),
        total_biomass_generation_kwh=sum(r.biomass_generation_kwh for r in yearly_rows),
        total_served_load_kwh=sum(r.served_load_kwh for r in yearly_rows),
        total_unmet_load_kwh=sum(r.unmet_load_kwh for r in yearly_rows),
        total_curtailment_kwh=sum(r.curtailment_kwh for r in yearly_rows),
        total_grid_import_kwh=sum(r.grid_import_kwh for r in yearly_rows),
        total_grid_export_kwh=sum(r.grid_export_kwh for r in yearly_rows),
        total_bess_replacements=sum(r.bess_replacement_count for r in yearly_rows),
        total_biomass_overhauls=sum(r.biomass_overhaul_count for r in yearly_rows),
        max_balance_error_kw=max(r.max_balance_error_kw for r in yearly_rows),
    )
