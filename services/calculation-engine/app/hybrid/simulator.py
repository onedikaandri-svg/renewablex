"""Simulator neraca daya tertutup dan agregator hasil dari jam ke tahun."""

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from typing import Any

import numpy as np

from app.errors import EngineError
from app.hybrid.components import PVHourlyOutput, PVWattsComponent, PVWattsConfig
from app.hybrid.load import LoadProfile
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset
from app.version import ENGINE_VERSION

BALANCE_TOLERANCE_KW = 1e-6


@dataclass(frozen=True)
class SimulationConfig:
    """Konfigurasi lengkap simulasi sistem hybrid Tahap 1."""

    project_name: str
    time_config: TimeConfig
    pv: PVWattsConfig
    contract_version: str = "0.1"


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

    def to_summary_dict(self) -> dict[str, Any]:
        """Mengembalikan ringkasan terstruktur siap serialisasi JSON."""
        m = self.weather.metadata
        return {
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


def _compute_config_hash(config: SimulationConfig, weather: WeatherDataset, load_profile: LoadProfile) -> str:
    payload = {
        "contract_version": config.contract_version,
        "project_name": config.project_name,
        "time_config": asdict(config.time_config),
        "pv": asdict(config.pv),
        "weather_meta": asdict(weather.metadata),
        "load_source": load_profile.source,
        "load_total_kwh": round(load_profile.total_energy_kwh, 6),
    }
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

    pv_component = PVWattsComponent(config.pv)
    pv_output = pv_component.prepare(weather)

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

    # Loop berurutan per langkah waktu sebagai fondasi mesin dispatch (Tahap 2 dan 3 menambah state baterai/generator).
    pv_state: dict[str, Any] = {}
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

    renewable_fraction = (served_kwh / total_load_kwh) if total_load_kwh > 0 else 0.0
    total_hours = n * h
    capacity_factor = pv_gen_kwh / (config.pv.capacity_kwp * total_hours)
    specific_yield = pv_gen_kwh / config.pv.capacity_kwp

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
    )
