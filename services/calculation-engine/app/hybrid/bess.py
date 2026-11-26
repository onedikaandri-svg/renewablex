"""Model komponen penyimpanan energi baterai (BESS) dengan degradasi dan penggantian EOL."""

from dataclasses import dataclass
import math
from typing import Any

from app.errors import EngineError
from app.hybrid.components import ComponentStepResult, EnergyComponent, LifecycleEvent
from app.hybrid.weather import WeatherDataset


@dataclass(frozen=True)
class BESSConfig:
    """Konfigurasi komponen baterai BESS untuk simulasi berurutan Tahap 2.

    Nilai default berasal dari asumsi sementara di docs/assumptions.md [REAL DATA].
    """

    nominal_capacity_kwh: float
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

    @property
    def rated_max_charge_kw(self) -> float:
        """Batas daya pengisian maksimum (kW) pada sisi AC."""
        if self.max_charge_kw is not None:
            return float(self.max_charge_kw)
        if self.c_rate_charge is not None:
            return float(self.c_rate_charge) * float(self.nominal_capacity_kwh)
        raise EngineError("invalid_bess_config", "max_charge_kw atau c_rate_charge wajib diisi.")

    @property
    def rated_max_discharge_kw(self) -> float:
        """Batas daya pelepasan maksimum (kW) pada sisi AC."""
        if self.max_discharge_kw is not None:
            return float(self.max_discharge_kw)
        if self.c_rate_discharge is not None:
            return float(self.c_rate_discharge) * float(self.nominal_capacity_kwh)
        raise EngineError("invalid_bess_config", "max_discharge_kw atau c_rate_discharge wajib diisi.")


class BESSComponent(EnergyComponent):
    """Komponen BESS dengan pelacakan SOC, degradasi kalender + siklus, dan penggantian EOL."""

    def __init__(self, config: BESSConfig):
        self.config = config
        self._recorded_events: list[LifecycleEvent] = []

    def validate(self) -> None:
        c = self.config
        if not math.isfinite(c.nominal_capacity_kwh) or c.nominal_capacity_kwh <= 0.0:
            raise EngineError("invalid_bess_config", "nominal_capacity_kwh harus lebih besar dari 0.")

        if c.max_charge_kw is None and c.c_rate_charge is None:
            raise EngineError("invalid_bess_config", "max_charge_kw atau c_rate_charge wajib diisi.")
        if c.max_discharge_kw is None and c.c_rate_discharge is None:
            raise EngineError("invalid_bess_config", "max_discharge_kw atau c_rate_discharge wajib diisi.")

        if c.max_charge_kw is not None and (not math.isfinite(c.max_charge_kw) or c.max_charge_kw <= 0.0):
            raise EngineError("invalid_bess_config", "max_charge_kw harus lebih besar dari 0.")
        if c.max_discharge_kw is not None and (not math.isfinite(c.max_discharge_kw) or c.max_discharge_kw <= 0.0):
            raise EngineError("invalid_bess_config", "max_discharge_kw harus lebih besar dari 0.")
        if c.c_rate_charge is not None and (not math.isfinite(c.c_rate_charge) or c.c_rate_charge <= 0.0):
            raise EngineError("invalid_bess_config", "c_rate_charge harus lebih besar dari 0.")
        if c.c_rate_discharge is not None and (not math.isfinite(c.c_rate_discharge) or c.c_rate_discharge <= 0.0):
            raise EngineError("invalid_bess_config", "c_rate_discharge harus lebih besar dari 0.")

        if not (0.0 <= c.soc_min_fraction < c.soc_max_fraction <= 1.0):
            raise EngineError(
                "invalid_bess_config",
                "Batas SOC harus memenuhi 0 <= soc_min_fraction < soc_max_fraction <= 1.",
            )
        if not (c.soc_min_fraction <= c.initial_soc_fraction <= c.soc_max_fraction):
            raise EngineError(
                "invalid_bess_config",
                "initial_soc_fraction harus berada antara soc_min_fraction dan soc_max_fraction.",
            )

        if not (0.0 < c.charge_efficiency <= 1.0) or not (0.0 < c.discharge_efficiency <= 1.0):
            raise EngineError("invalid_bess_config", "Efisiensi charge dan discharge harus > 0 dan <= 1.")
        if not (0.0 <= c.pcs_loss_fraction < 1.0):
            raise EngineError("invalid_bess_config", "pcs_loss_fraction harus antara 0 dan kurang dari 1.")
        if not math.isfinite(c.aux_load_kw) or c.aux_load_kw < 0.0:
            raise EngineError("invalid_bess_config", "aux_load_kw tidak boleh negatif.")

        if not math.isfinite(c.calendar_fade_per_year) or not (0.0 <= c.calendar_fade_per_year < 1.0):
            raise EngineError("invalid_bess_config", "calendar_fade_per_year harus antara 0 dan kurang dari 1.")
        if not math.isfinite(c.cycle_fade_per_efc) or not (0.0 <= c.cycle_fade_per_efc < 0.1):
            raise EngineError("invalid_bess_config", "cycle_fade_per_efc harus antara 0 dan kurang dari 0.1.")
        if not math.isfinite(c.eol_capacity_fraction) or not (0.0 < c.eol_capacity_fraction < 1.0):
            raise EngineError("invalid_bess_config", "eol_capacity_fraction harus antara 0 dan 1.")
        if not math.isfinite(c.replacement_cost) or c.replacement_cost < 0.0:
            raise EngineError("invalid_bess_config", "replacement_cost tidak boleh negatif.")

    def initial_state(self, year: int = 1) -> dict[str, Any]:
        """Membuat state awal BESS yang valid sebelum langkah simulasi pertama."""
        self.validate()
        self._recorded_events = []
        return {
            "soc_fraction": float(self.config.initial_soc_fraction),
            "effective_capacity_kwh": float(self.config.nominal_capacity_kwh),
            "equivalent_full_cycles": 0.0,
            "calendar_age_years": 0.0,
            "cycles_since_replacement": 0.0,
            "age_since_replacement": 0.0,
            "replacement_count": 0,
            "current_year": int(year),
            "events": [],
            "last_step_delta_energy_kwh": 0.0,
            "last_step_internal_in_kwh": 0.0,
            "last_step_internal_out_kwh": 0.0,
        }

    def max_charge_power_kw(self, weather: WeatherDataset, state: dict[str, Any]) -> float:
        """Mengembalikan daya pengisian AC maksimum (kW) tanpa melampaui soc_max_fraction."""
        c = self.config
        dt = weather.time_config.step_hours
        soc = float(state["soc_fraction"])
        cap = float(state["effective_capacity_kwh"])
        eta_in = c.charge_efficiency * (1.0 - c.pcs_loss_fraction)
        headroom_kwh = max((c.soc_max_fraction - soc) * cap, 0.0)
        max_by_soc = headroom_kwh / (dt * eta_in)
        return min(c.rated_max_charge_kw, max_by_soc)

    def available_power_kw(
        self,
        step_idx: int,
        weather: WeatherDataset,
        state: dict[str, Any],
    ) -> float:
        """Mengembalikan daya pelepasan AC maksimum (kW) tanpa turun di bawah soc_min_fraction."""
        _ = step_idx
        c = self.config
        dt = weather.time_config.step_hours
        soc = float(state["soc_fraction"])
        cap = float(state["effective_capacity_kwh"])
        eta_out = c.discharge_efficiency * (1.0 - c.pcs_loss_fraction)
        usable_kwh = max((soc - c.soc_min_fraction) * cap, 0.0)
        max_by_soc = (usable_kwh * eta_out) / dt
        return min(c.rated_max_discharge_kw, max_by_soc)

    def step(
        self,
        step_idx: int,
        command_kw: float,
        weather: WeatherDataset,
        state: dict[str, Any],
    ) -> ComponentStepResult:
        """Menjalankan satu langkah simulasi BESS (positif = charge, negatif = discharge)."""
        c = self.config
        dt = weather.time_config.step_hours
        steps_per_year = weather.time_config.steps_per_year

        soc = float(state["soc_fraction"])
        cap = float(state["effective_capacity_kwh"])
        total_efc = float(state["equivalent_full_cycles"])
        total_age = float(state["calendar_age_years"])
        cyc_since = float(state["cycles_since_replacement"])
        age_since = float(state["age_since_replacement"])
        repl_count = int(state["replacement_count"])
        current_year = int(state.get("current_year", 1))
        events: list[LifecycleEvent] = list(state.get("events", []))

        eta_pcs = 1.0 - c.pcs_loss_fraction
        eta_in = c.charge_efficiency * eta_pcs
        eta_out = c.discharge_efficiency * eta_pcs

        max_chg = self.max_charge_power_kw(weather, state)
        max_dis = self.available_power_kw(step_idx, weather, state)

        cmd = float(command_kw)
        charge_kw = 0.0
        discharge_kw = 0.0
        e_in = 0.0
        e_out = 0.0
        conversion_loss_kw = 0.0

        if cmd > 1e-12:
            charge_kw = min(cmd, max_chg)
            e_in = charge_kw * dt * eta_in
            conversion_loss_kw = charge_kw * (1.0 - eta_in)
        elif cmd < -1e-12:
            discharge_kw = min(-cmd, max_dis)
            e_out = (discharge_kw * dt) / eta_out
            conversion_loss_kw = (e_out / dt) - discharge_kw

        energy_before = soc * cap
        energy_after = energy_before + e_in - e_out
        new_soc = min(max(energy_after / cap, c.soc_min_fraction), c.soc_max_fraction)

        delta_efc = e_out / cap if cap > 0.0 else 0.0
        delta_years = 1.0 / float(steps_per_year)
        total_efc += delta_efc
        total_age += delta_years
        cyc_since += delta_efc
        age_since += delta_years

        fade = c.calendar_fade_per_year * age_since + c.cycle_fade_per_efc * cyc_since
        new_cap = c.nominal_capacity_kwh * max(1.0 - fade, 0.0)

        eol_threshold = c.nominal_capacity_kwh * c.eol_capacity_fraction
        if new_cap <= eol_threshold + 1e-12:
            repl_count += 1
            ev = LifecycleEvent(
                year=current_year,
                event_type="bess_replacement",
                description=(
                    f"Penggantian BESS ke-{repl_count} pada langkah {step_idx} tahun ke-{current_year} "
                    f"(kapasitas efektif turun ke {new_cap:.2f} kWh <= ambang {eol_threshold:.2f} kWh)."
                ),
                cost_amount=float(c.replacement_cost),
            )
            events.append(ev)
            self._recorded_events.append(ev)
            new_cap = float(c.nominal_capacity_kwh)
            cyc_since = 0.0
            age_since = 0.0

        state_out = {
            "soc_fraction": new_soc,
            "effective_capacity_kwh": new_cap,
            "equivalent_full_cycles": total_efc,
            "calendar_age_years": total_age,
            "cycles_since_replacement": cyc_since,
            "age_since_replacement": age_since,
            "replacement_count": repl_count,
            "current_year": current_year,
            "events": events,
            "last_step_delta_energy_kwh": energy_after - energy_before,
            "last_step_internal_in_kwh": e_in,
            "last_step_internal_out_kwh": e_out,
        }

        return ComponentStepResult(
            available_kw=max_dis,
            generation_kw=0.0,
            charge_kw=charge_kw,
            discharge_kw=discharge_kw,
            losses_kw=conversion_loss_kw,
            state_out=state_out,
        )

    def lifecycle_events(self, year: int) -> list[LifecycleEvent]:
        """Mengembalikan kejadian penggantian BESS yang tercatat untuk tahun ke-`year`."""
        return [ev for ev in self._recorded_events if ev.year == year]
