"""Simulator neraca daya tertutup dan agregator hasil dari jam ke tahun."""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from typing import Any

import numpy as np

from app.errors import EngineError
from app.hybrid.bess import BESSComponent, BESSConfig
from app.hybrid.components import (
    LifecycleEvent,
    PVHourlyOutput,
    PVWattsComponent,
    PVWattsConfig,
)
from app.hybrid.dispatch import (
    DispatchConfig,
    DispatchContext,
    create_dispatch_strategy,
)
from app.hybrid.load import LoadProfile
from app.hybrid.pv_detailed import PVDetailedComponent, PVDetailedConfig
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset
from app.version import ENGINE_VERSION

BALANCE_TOLERANCE_KW = 1e-6


@dataclass(frozen=True)
class SimulationConfig:
    """Konfigurasi lengkap simulasi sistem hybrid."""

    project_name: str
    time_config: TimeConfig
    pv: PVWattsConfig | PVDetailedConfig
    contract_version: str = "0.1"
    bess: BESSConfig | None = None
    dispatch: DispatchConfig | None = None


@dataclass(frozen=True)
class PowerBalanceSeries:
    """Deret waktu neraca daya per langkah waktu dalam satuan kW."""

    load_kw: np.ndarray
    pv_available_kw: np.ndarray
    generation_kw: np.ndarray
    charge_kw: np.ndarray
    discharge_kw: np.ndarray
    grid_import_kw: np.ndarray
    grid_export_kw: np.ndarray
    served_load_kw: np.ndarray
    unmet_load_kw: np.ndarray
    curtailment_kw: np.ndarray
    losses_kw: np.ndarray

    def balance_residuals_kw(self) -> np.ndarray:
        """Selisih sisi pasokan dan sisi penggunaan pada setiap langkah waktu."""
        supply = self.generation_kw + self.discharge_kw + self.grid_import_kw
        demand_and_sink = (
            self.served_load_kw
            + self.charge_kw
            + self.grid_export_kw
            + self.curtailment_kw
            + self.losses_kw
        )
        return supply - demand_and_sink

    def max_balance_error_kw(self) -> float:
        return float(np.max(np.abs(self.balance_residuals_kw())))


@dataclass(frozen=True)
class DailyRow:
    day: int
    load_kwh: float
    pv_generation_kwh: float
    served_load_kwh: float
    unmet_load_kwh: float
    curtailment_kwh: float
    peak_load_kw: float
    peak_pv_kw: float


@dataclass(frozen=True)
class MonthlyRow:
    month: int
    load_kwh: float
    pv_generation_kwh: float
    served_load_kwh: float
    unmet_load_kwh: float
    curtailment_kwh: float


@dataclass(frozen=True)
class AnnualSummary:
    steps_count: int
    step_minutes: int
    total_load_kwh: float
    pv_generation_kwh: float
    served_load_kwh: float
    unmet_load_kwh: float
    curtailment_kwh: float
    renewable_fraction: float
    pv_capacity_factor: float
    pv_specific_yield_kwh_per_kwp: float
    max_balance_error_kw: float


@dataclass(frozen=True)
class BESSSummary:
    """Ringkasan tahunan kinerja dan degradasi BESS."""

    total_charge_kwh: float
    total_discharge_kwh: float
    conversion_losses_kwh: float
    aux_load_kwh: float
    equivalent_full_cycles: float
    final_soc_fraction: float
    final_effective_capacity_kwh: float
    replacement_count: int


@dataclass(frozen=True)
class SimulationResult:
    """Keluaran lengkap simulasi hybrid beserta provenance dan ringkasan berjenjang."""

    engine_version: str
    contract_version: str
    config_hash: str
    calculated_at: str
    config: SimulationConfig
    weather: WeatherDataset
    pv_output: PVHourlyOutput
    balance: PowerBalanceSeries
    daily: list[DailyRow]
    monthly: list[MonthlyRow]
    summary: AnnualSummary
    bess_soc: np.ndarray | None = None
    bess_effective_capacity_kwh: np.ndarray | None = None
    bess_summary: BESSSummary | None = None
    lifecycle_events: tuple[LifecycleEvent, ...] = ()
    trace_reasons: tuple[str, ...] = ()
    dispatch_strategy: str | None = None

    def to_summary_dict(self) -> dict[str, Any]:
        """Mengembalikan ringkasan terstruktur siap serialisasi JSON."""
        m = self.weather.metadata
        out: dict[str, Any] = {
            "engine_version": self.engine_version,
            "contract_version": self.contract_version,
            "config_hash": self.config_hash,
            "calculated_at": self.calculated_at,
            "project_name": self.config.project_name,
            "weather_source": {
                "provider": m.provider,
                "dataset": m.dataset,
                "dataset_version": m.dataset_version,
                "period": m.period,
                "latitude": m.latitude,
                "longitude": m.longitude,
                "elevation_m": m.elevation_m,
                "timezone": m.timezone,
            },
            "summary": asdict(self.summary),
            "pv_loss_breakdown_kwh": dict(self.pv_output.loss_breakdown_kwh),
            "monthly": [asdict(row) for row in self.monthly],
        }
        if self.dispatch_strategy is not None:
            out["dispatch_strategy"] = self.dispatch_strategy
        if self.bess_summary is not None:
            out["bess_summary"] = asdict(self.bess_summary)
        if self.lifecycle_events:
            out["lifecycle_events"] = [asdict(ev) for ev in self.lifecycle_events]
        return out


def _compute_config_hash(config: SimulationConfig, weather: WeatherDataset, load_profile: LoadProfile) -> str:
    # Jaga hash Tahap 1 tetap identik bila hanya memakai komponen Tahap 1.
    is_stage_1_only = (
        config.contract_version == "0.1"
        and isinstance(config.pv, PVWattsConfig)
        and config.bess is None
        and config.dispatch is None
    )
    payload: dict[str, Any] = {
        "contract_version": config.contract_version,
        "project_name": config.project_name,
        "time_config": asdict(config.time_config),
        "pv": asdict(config.pv),
        "weather_meta": asdict(weather.metadata),
        "load_source": load_profile.source,
        "load_total_kwh": round(load_profile.total_energy_kwh, 6),
    }
    if not is_stage_1_only:
        payload["pv_model"] = "detailed_v1" if isinstance(config.pv, PVDetailedConfig) else "pvwatts_v1"
        payload["bess"] = asdict(config.bess) if config.bess is not None else None
        payload["dispatch"] = asdict(config.dispatch) if config.dispatch is not None else None

    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _aggregate_daily(balance: PowerBalanceSeries, time_config: TimeConfig) -> list[DailyRow]:
    day_idx = time_config.day_indices()
    h = time_config.step_hours
    rows: list[DailyRow] = []
    for d in range(365):
        mask = day_idx == d
        rows.append(
            DailyRow(
                day=d + 1,
                load_kwh=float(np.sum(balance.load_kw[mask]) * h),
                pv_generation_kwh=float(np.sum(balance.generation_kw[mask]) * h),
                served_load_kwh=float(np.sum(balance.served_load_kw[mask]) * h),
                unmet_load_kwh=float(np.sum(balance.unmet_load_kw[mask]) * h),
                curtailment_kwh=float(np.sum(balance.curtailment_kw[mask]) * h),
                peak_load_kw=float(np.max(balance.load_kw[mask])),
                peak_pv_kw=float(np.max(balance.generation_kw[mask])),
            )
        )
    return rows


def _aggregate_monthly(balance: PowerBalanceSeries, time_config: TimeConfig) -> list[MonthlyRow]:
    month_idx = time_config.month_indices()
    h = time_config.step_hours
    rows: list[MonthlyRow] = []
    for m in range(1, 13):
        mask = month_idx == m
        rows.append(
            MonthlyRow(
                month=m,
                load_kwh=float(np.sum(balance.load_kw[mask]) * h),
                pv_generation_kwh=float(np.sum(balance.generation_kw[mask]) * h),
                served_load_kwh=float(np.sum(balance.served_load_kw[mask]) * h),
                unmet_load_kwh=float(np.sum(balance.unmet_load_kw[mask]) * h),
                curtailment_kwh=float(np.sum(balance.curtailment_kw[mask]) * h),
            )
        )
    return rows


def run_simulation(
    config: SimulationConfig,
    weather: WeatherDataset,
    load_profile: LoadProfile,
) -> SimulationResult:
    """Menjalankan simulasi hybrid per langkah waktu dan memverifikasi neraca energi."""
    if weather.time_config != config.time_config:
        raise EngineError(
            "time_config_mismatch",
            "TimeConfig pada data cuaca tidak sama dengan konfigurasi simulasi.",
        )
    if load_profile.time_config != config.time_config:
        raise EngineError(
            "time_config_mismatch",
            "TimeConfig pada profil beban tidak sama dengan konfigurasi simulasi.",
        )

    pv_component: PVWattsComponent | PVDetailedComponent
    if isinstance(config.pv, PVDetailedConfig):
        pv_component = PVDetailedComponent(config.pv)
        pv_cap_kwp = config.pv.effective_dc_capacity_kwp
    else:
        pv_component = PVWattsComponent(config.pv)
        pv_cap_kwp = config.pv.capacity_kwp
    pv_output = pv_component.prepare(weather)

    bess_component: BESSComponent | None = None
    bess_state: dict[str, Any] = {}
    if config.bess is not None:
        bess_component = BESSComponent(config.bess)
        sim_year = config.pv.simulation_year if isinstance(config.pv, PVDetailedConfig) else 1
        bess_state = bess_component.initial_state(year=sim_year)

    is_stage_1_loop = (
        bess_component is None
        and config.dispatch is None
        and isinstance(config.pv, PVWattsConfig)
    )

    dispatch_cfg = config.dispatch if config.dispatch is not None else DispatchConfig(strategy="self_consumption")
    strategy = None if is_stage_1_loop else create_dispatch_strategy(dispatch_cfg)

    n = config.time_config.steps_per_year
    load_kw = load_profile.load_kw

    pv_available = np.zeros(n, dtype=np.float64)
    generation_kw = np.zeros(n, dtype=np.float64)
    charge_kw = np.zeros(n, dtype=np.float64)
    discharge_kw = np.zeros(n, dtype=np.float64)
    grid_import_kw = np.zeros(n, dtype=np.float64)
    grid_export_kw = np.zeros(n, dtype=np.float64)
    served_load_kw = np.zeros(n, dtype=np.float64)
    unmet_load_kw = np.zeros(n, dtype=np.float64)
    curtailment_kw = np.zeros(n, dtype=np.float64)
    losses_kw = np.zeros(n, dtype=np.float64)

    bess_soc_series = np.zeros(n, dtype=np.float64) if bess_component is not None else None
    bess_cap_series = np.zeros(n, dtype=np.float64) if bess_component is not None else None
    bess_conv_losses_kw = np.zeros(n, dtype=np.float64) if bess_component is not None else None
    bess_aux_served_kw = np.zeros(n, dtype=np.float64) if bess_component is not None else None
    trace_reasons: list[str] = []

    hours_local = config.time_config.hour_of_day()
    months_local = config.time_config.month_indices()

    pv_state: dict[str, Any] = {}
    if is_stage_1_loop:
        for t in range(n):
            avail = pv_component.available_power_kw(t, weather, pv_state)
            demand = float(load_kw[t])
            served = min(avail, demand)
            step_res = pv_component.step(t, served, weather, pv_state)
            pv_state = step_res.state_out

            pv_available[t] = step_res.available_kw
            generation_kw[t] = step_res.generation_kw
            served_load_kw[t] = served
            unmet_load_kw[t] = max(demand - served, 0.0)
            curtailment_kw[t] = max(step_res.generation_kw - served, 0.0)
            losses_kw[t] = step_res.losses_kw
    else:
        assert strategy is not None
        for t in range(n):
            avail = pv_component.available_power_kw(t, weather, pv_state)
            demand = float(load_kw[t])
            pv_night_tare = pv_component.night_tare_power_kw(t, weather)
            bess_aux = bess_component.config.aux_load_kw if bess_component is not None else 0.0
            parasitic = pv_night_tare + bess_aux

            if bess_component is not None:
                soc_now = float(bess_state["soc_fraction"])
                max_chg = bess_component.max_charge_power_kw(weather, bess_state)
                max_dis = bess_component.available_power_kw(t, weather, bess_state)
            else:
                soc_now = 0.0
                max_chg = 0.0
                max_dis = 0.0

            ctx = DispatchContext(
                step_idx=t,
                hour_of_day=int(hours_local[t]),
                month=int(months_local[t]),
                load_kw=demand,
                pv_available_kw=avail,
                bess_soc=soc_now,
                bess_max_charge_kw=max_chg,
                bess_max_discharge_kw=max_dis,
                allow_grid_import=dispatch_cfg.allow_grid_import,
                allow_grid_export=dispatch_cfg.allow_grid_export,
                parasitic_load_kw=parasitic,
            )
            decision = strategy.decide(ctx)
            trace_reasons.append(decision.trace_reason)

            pv_step = pv_component.step(t, demand, weather, pv_state)
            pv_state = pv_step.state_out
            pv_gen = pv_step.generation_kw

            chg = 0.0
            dis = 0.0
            if bess_component is not None:
                cmd = decision.bess_command_kw
                if cmd > 0.0 and not dispatch_cfg.allow_grid_import:
                    cmd = min(cmd, max(pv_gen - demand - parasitic, 0.0))
                bess_step = bess_component.step(t, cmd, weather, bess_state)
                bess_state = bess_step.state_out
                chg = bess_step.charge_kw
                dis = bess_step.discharge_kw
                assert bess_soc_series is not None
                assert bess_cap_series is not None
                assert bess_conv_losses_kw is not None
                bess_soc_series[t] = float(bess_state["soc_fraction"])
                bess_cap_series[t] = float(bess_state["effective_capacity_kwh"])
                bess_conv_losses_kw[t] = bess_step.losses_kw

            if dispatch_cfg.allow_grid_import:
                g_import = max((demand + parasitic + chg) - (pv_gen + dis), 0.0)
            else:
                g_import = 0.0

            total_supply = pv_gen + dis + g_import
            served_parasitic = min(total_supply, parasitic)
            remaining_for_load = max(total_supply - served_parasitic - chg, 0.0)
            served = min(remaining_for_load, demand)
            surplus_after = max(total_supply - served_parasitic - chg - served, 0.0)

            if dispatch_cfg.allow_grid_export:
                g_export = surplus_after
                curtail = 0.0
            else:
                g_export = 0.0
                curtail = surplus_after

            if bess_aux_served_kw is not None and parasitic > 0.0:
                bess_aux_served_kw[t] = served_parasitic * (bess_aux / parasitic)

            pv_available[t] = pv_step.available_kw
            generation_kw[t] = pv_gen
            charge_kw[t] = chg
            discharge_kw[t] = dis
            grid_import_kw[t] = g_import
            grid_export_kw[t] = g_export
            served_load_kw[t] = served
            unmet_load_kw[t] = max(demand - served, 0.0)
            curtailment_kw[t] = curtail
            losses_kw[t] = pv_step.losses_kw + served_parasitic

    balance = PowerBalanceSeries(
        load_kw=load_kw,
        pv_available_kw=pv_available,
        generation_kw=generation_kw,
        charge_kw=charge_kw,
        discharge_kw=discharge_kw,
        grid_import_kw=grid_import_kw,
        grid_export_kw=grid_export_kw,
        served_load_kw=served_load_kw,
        unmet_load_kw=unmet_load_kw,
        curtailment_kw=curtailment_kw,
        losses_kw=losses_kw,
    )

    max_err = balance.max_balance_error_kw()
    if max_err > BALANCE_TOLERANCE_KW:
        raise EngineError(
            "power_balance_violation",
            f"Neraca daya tidak tertutup: galat maksimum {max_err} kW.",
        )

    h = config.time_config.step_hours
    total_load_kwh = float(np.sum(load_kw) * h)
    pv_gen_kwh = float(np.sum(generation_kw) * h)
    served_kwh = float(np.sum(served_load_kw) * h)
    unmet_kwh = float(np.sum(unmet_load_kw) * h)
    curtail_kwh = float(np.sum(curtailment_kw) * h)
    grid_imp_kwh = float(np.sum(grid_import_kw) * h)

    if total_load_kwh > 0.0:
        renewable_fraction = min(max((served_kwh - grid_imp_kwh) / total_load_kwh, 0.0), 1.0)
    else:
        renewable_fraction = 0.0
    total_hours = n * h
    capacity_factor = pv_gen_kwh / (pv_cap_kwp * total_hours)
    specific_yield = pv_gen_kwh / pv_cap_kwp

    summary = AnnualSummary(
        steps_count=n,
        step_minutes=config.time_config.step_minutes,
        total_load_kwh=total_load_kwh,
        pv_generation_kwh=pv_gen_kwh,
        served_load_kwh=served_kwh,
        unmet_load_kwh=unmet_kwh,
        curtailment_kwh=curtail_kwh,
        renewable_fraction=renewable_fraction,
        pv_capacity_factor=capacity_factor,
        pv_specific_yield_kwh_per_kwp=specific_yield,
        max_balance_error_kw=max_err,
    )

    bess_summary: BESSSummary | None = None
    events: tuple[LifecycleEvent, ...] = ()
    if bess_component is not None:
        assert bess_conv_losses_kw is not None
        assert bess_aux_served_kw is not None
        bess_summary = BESSSummary(
            total_charge_kwh=float(np.sum(charge_kw) * h),
            total_discharge_kwh=float(np.sum(discharge_kw) * h),
            conversion_losses_kwh=float(np.sum(bess_conv_losses_kw) * h),
            aux_load_kwh=float(np.sum(bess_aux_served_kw) * h),
            equivalent_full_cycles=float(bess_state["equivalent_full_cycles"]),
            final_soc_fraction=float(bess_state["soc_fraction"]),
            final_effective_capacity_kwh=float(bess_state["effective_capacity_kwh"]),
            replacement_count=int(bess_state["replacement_count"]),
        )
        events = tuple(bess_state.get("events", []))

    return SimulationResult(
        engine_version=ENGINE_VERSION,
        contract_version=config.contract_version,
        config_hash=_compute_config_hash(config, weather, load_profile),
        calculated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        config=config,
        weather=weather,
        pv_output=pv_output,
        balance=balance,
        daily=_aggregate_daily(balance, config.time_config),
        monthly=_aggregate_monthly(balance, config.time_config),
        summary=summary,
        bess_soc=bess_soc_series,
        bess_effective_capacity_kwh=bess_cap_series,
        bess_summary=bess_summary,
        lifecycle_events=events,
        trace_reasons=tuple(trace_reasons),
        dispatch_strategy=None if is_stage_1_loop else dispatch_cfg.strategy,
    )
