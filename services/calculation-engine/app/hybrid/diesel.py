"""Model komponen pembangkit listrik diesel generator untuk sistem hybrid Tahap 8B."""

from dataclasses import asdict, dataclass
import math
from typing import Any, Literal

from app.errors import EngineError
from app.hybrid.components import ComponentStepResult, EnergyComponent, LifecycleEvent
from app.hybrid.weather import WeatherDataset

DieselFuelCurveModel = Literal["willans_linear", "piecewise_sfc"]
DieselStatus = Literal["off", "running"]

DEFAULT_DIESEL_MIN_LOAD_FRACTION = 0.30  # [REAL DATA] menghindari wet stacking pada mesin diesel
DEFAULT_DIESEL_NO_LOAD_RATIO = 0.08  # [REAL DATA] estimasi konsumsi tanpa beban ~8% dari kW (L/jam)
DEFAULT_DIESEL_SLOPE_L_PER_KWH = 0.25  # [REAL DATA] konsumsi marginal solar per kWh
DEFAULT_DIESEL_FUEL_PRICE_IDR = 18500.0  # [REAL DATA] solar industri non-subsidi ilustratif
DEFAULT_DIESEL_FIXED_OM_IDR = 150000.0  # [REAL DATA] O&M tetap tahunan per kW
DEFAULT_DIESEL_OVERHAUL_HOURS = 15000.0  # [REAL DATA] interval overhaul mayor mesin diesel
# Faktor emisi pembakaran solar stasioner (IPCC 2006 / DEFRA ~2,68 kg CO2e/liter).
DEFAULT_DIESEL_EMISSION_FACTOR_KG_PER_LITER = 2.68


def _is_non_negative_finite(val: float) -> bool:
    return math.isfinite(val) and val >= 0.0


@dataclass(frozen=True)
class DieselConfig:
    """Konfigurasi pembangkit diesel generator lewat antarmuka EnergyComponent."""

    rated_capacity_kw: float
    min_load_fraction: float = DEFAULT_DIESEL_MIN_LOAD_FRACTION
    fuel_curve_model: DieselFuelCurveModel = "willans_linear"
    no_load_fuel_liters_per_hour: float | None = None
    slope_liters_per_kwh: float = DEFAULT_DIESEL_SLOPE_L_PER_KWH
    fuel_curve_points: tuple[tuple[float, float], ...] | None = None
    min_run_time_hours: float = 1.0
    min_down_time_hours: float = 1.0
    fuel_price_per_liter: float = DEFAULT_DIESEL_FUEL_PRICE_IDR
    fixed_om_per_kw_year: float = DEFAULT_DIESEL_FIXED_OM_IDR
    variable_om_per_operating_hour: float = 0.0
    startup_cost: float = 0.0
    overhaul_interval_operating_hours: float | None = DEFAULT_DIESEL_OVERHAUL_HOURS
    overhaul_cost: float = 0.0
    emission_factor_kg_co2e_per_liter: float = DEFAULT_DIESEL_EMISSION_FACTOR_KG_PER_LITER
    is_renewable: bool = False

    @property
    def effective_no_load_fuel_lph(self) -> float:
        """Konsumsi solar tanpa beban (L/jam), memakai proporsi default [REAL DATA] bila None."""
        if self.no_load_fuel_liters_per_hour is not None:
            return float(self.no_load_fuel_liters_per_hour)
        return DEFAULT_DIESEL_NO_LOAD_RATIO * float(self.rated_capacity_kw)

    @property
    def effective_min_load_kw(self) -> float:
        """Batas daya minimum mesin diesel (kW) saat beroperasi."""
        return float(self.min_load_fraction) * float(self.rated_capacity_kw)


def resolve_diesel_config(raw: dict[str, Any]) -> DieselConfig:
    """Mem-parsing kamus konfigurasi JSON menjadi DieselConfig yang tervalidasi."""
    data = dict(raw)
    data.pop("enabled", None)

    if "fuel_curve_points" in data and data["fuel_curve_points"] is not None:
        data["fuel_curve_points"] = tuple(
            (float(pt[0]), float(pt[1])) for pt in data["fuel_curve_points"]
        )

    try:
        cfg = DieselConfig(**data)
    except TypeError as exc:
        raise EngineError("invalid_diesel_config", f"Konfigurasi diesel generator tidak valid: {exc}.") from exc
    DieselComponent(cfg).validate()
    return cfg


class DieselComponent(EnergyComponent):
    """Komponen pembangkit diesel generator berbahan bakar fosil dengan kendala runtime dan overhaul."""

    def __init__(self, config: DieselConfig):
        self.config = config
        self._recorded_events: list[LifecycleEvent] = []
        self._min_load_kw_cache: float | None = None
        self._no_load_lph_cache: float | None = None
        self._curve_xs: tuple[float, ...] | None = None
        self._curve_ys: tuple[float, ...] | None = None

    def _get_min_load_kw(self) -> float:
        if self._min_load_kw_cache is None:
            self._min_load_kw_cache = self.config.effective_min_load_kw
        return self._min_load_kw_cache

    def _get_no_load_lph(self) -> float:
        if self._no_load_lph_cache is None:
            self._no_load_lph_cache = self.config.effective_no_load_fuel_lph
        return self._no_load_lph_cache

    def _ensure_curve_cache(self) -> tuple[tuple[float, ...], tuple[float, ...]]:
        if self._curve_xs is not None and self._curve_ys is not None:
            return self._curve_xs, self._curve_ys
        assert self.config.fuel_curve_points is not None
        xs = tuple(float(pt[0]) for pt in self.config.fuel_curve_points)
        ys = tuple(float(pt[1]) for pt in self.config.fuel_curve_points)
        self._curve_xs = xs
        self._curve_ys = ys
        return xs, ys

    def validate(self) -> None:
        c = self.config
        if not math.isfinite(c.rated_capacity_kw) or c.rated_capacity_kw <= 0.0:
            raise EngineError("invalid_diesel_config", "rated_capacity_kw diesel harus lebih besar dari 0.")
        if not math.isfinite(c.min_load_fraction) or not (0.0 <= c.min_load_fraction <= 1.0):
            raise EngineError("invalid_diesel_config", "min_load_fraction diesel harus berada di rentang [0, 1].")
        if c.is_renewable:
            raise EngineError(
                "invalid_diesel_config",
                "Diesel generator berbahan bakar fosil wajib memiliki is_renewable = False.",
            )

        for name, val in (
            ("min_run_time_hours", c.min_run_time_hours),
            ("min_down_time_hours", c.min_down_time_hours),
            ("fuel_price_per_liter", c.fuel_price_per_liter),
            ("fixed_om_per_kw_year", c.fixed_om_per_kw_year),
            ("variable_om_per_operating_hour", c.variable_om_per_operating_hour),
            ("startup_cost", c.startup_cost),
            ("overhaul_cost", c.overhaul_cost),
            ("emission_factor_kg_co2e_per_liter", c.emission_factor_kg_co2e_per_liter),
        ):
            if not _is_non_negative_finite(val):
                raise EngineError("invalid_diesel_config", f"{name} diesel harus bernilai >= 0 dan hingga.")

        if c.overhaul_interval_operating_hours is not None and (
            not math.isfinite(c.overhaul_interval_operating_hours) or c.overhaul_interval_operating_hours <= 0.0
        ):
            raise EngineError(
                "invalid_diesel_config",
                "overhaul_interval_operating_hours diesel harus lebih besar dari 0.",
            )

        if c.fuel_curve_model == "willans_linear":
            no_load = c.effective_no_load_fuel_lph
            if not _is_non_negative_finite(no_load):
                raise EngineError("invalid_diesel_config", "no_load_fuel_liters_per_hour harus >= 0 dan hingga.")
            if not math.isfinite(c.slope_liters_per_kwh) or c.slope_liters_per_kwh <= 0.0:
                raise EngineError("invalid_diesel_config", "slope_liters_per_kwh harus lebih besar dari 0.")
            return

        if c.fuel_curve_model != "piecewise_sfc":
            raise EngineError("invalid_diesel_config", f"fuel_curve_model diesel tidak dikenal: {c.fuel_curve_model}.")

        pts = c.fuel_curve_points
        if pts is None or len(pts) < 2:
            raise EngineError(
                "invalid_diesel_config",
                "fuel_curve_points minimal harus memiliki 2 titik (load_fraction, liter_per_kwh).",
            )
        prev_x = -1.0
        for x, y in pts:
            if not math.isfinite(x) or not math.isfinite(y):
                raise EngineError("invalid_diesel_config", "Titik fuel_curve_points diesel harus berupa angka hingga.")
            if not (0.0 <= x <= 1.0) or x <= prev_x:
                raise EngineError(
                    "invalid_diesel_config",
                    "load_fraction pada fuel_curve_points harus menaik ketat di rentang [0, 1].",
                )
            if y <= 0.0:
                raise EngineError("invalid_diesel_config", "Konsumsi spesifik (L/kWh) pada fuel_curve_points harus > 0.")
            prev_x = x

        if pts[0][0] > c.min_load_fraction + 1e-9 or pts[-1][0] < 1.0 - 1e-9:
            raise EngineError(
                "invalid_diesel_config",
                "fuel_curve_points harus mencakup rentang dari min_load_fraction hingga 1.0.",
            )

    def _sfc_liters_per_kwh(self, load_fraction: float) -> float:
        xs, ys = self._ensure_curve_cache()
        if load_fraction <= xs[0]:
            return ys[0]
        if load_fraction >= xs[-1]:
            return ys[-1]
        for i in range(len(xs) - 1):
            x1 = xs[i + 1]
            if load_fraction <= x1:
                x0 = xs[i]
                t = (load_fraction - x0) / (x1 - x0)
                return ys[i] + t * (ys[i + 1] - ys[i])
        return ys[-1]

    def fuel_liters_for_power_kw(self, power_kw: float, step_hours: float) -> float:
        """Menghitung konsumsi solar (liter) untuk keluaran daya listrik pada satu langkah."""
        if power_kw <= 0.0 or step_hours <= 0.0:
            return 0.0
        c = self.config
        if c.fuel_curve_model == "willans_linear":
            lph = self._get_no_load_lph() + c.slope_liters_per_kwh * power_kw
            return lph * step_hours
        load_frac = power_kw / c.rated_capacity_kw
        sfc = self._sfc_liters_per_kwh(load_frac)
        return sfc * power_kw * step_hours

    def initial_state(self, year: int = 1) -> dict[str, Any]:
        """Membuat state awal diesel generator sebelum langkah simulasi pertama."""
        self.validate()
        self._recorded_events = []
        return {
            "status": "off",
            "current_power_kw": 0.0,
            "hours_running_continuous": 0.0,
            "hours_stopped_continuous": float(self.config.min_down_time_hours),
            "total_operating_hours": 0.0,
            "hours_since_overhaul": 0.0,
            "startup_count": 0,
            "overhaul_count": 0,
            "fuel_consumed_total_liters": 0.0,
            "co2e_emitted_kg": 0.0,
            "current_year": int(year),
            "events": [],
            "last_step_fuel_liters": 0.0,
            "last_step_co2e_kg": 0.0,
            "last_step_fuel_cost": 0.0,
            "last_step_om_cost": 0.0,
            "last_step_startup_cost": 0.0,
        }

    def inspect_step_limits(
        self,
        step_idx: int,
        weather: WeatherDataset,
        state: dict[str, Any],
    ) -> dict[str, Any]:
        """Menghitung batas kemampuan dan kesiapan start/stop diesel pada langkah ini."""
        _ = step_idx, weather
        c = self.config
        status_now = str(state["status"])
        curr_kw = float(state["current_power_kw"]) if status_now == "running" else 0.0
        min_kw = self._get_min_load_kw()
        hours_run = float(state["hours_running_continuous"])
        hours_stop = float(state["hours_stopped_continuous"])

        can_start = status_now == "off" and hours_stop + 1e-12 >= c.min_down_time_hours
        can_stop = status_now == "running" and hours_run + 1e-12 >= c.min_run_time_hours
        available_kw = float(c.rated_capacity_kw) if (status_now == "running" or can_start) else 0.0

        return {
            "status": status_now,
            "available_kw": available_kw,
            "min_load_kw": float(min_kw),
            "current_power_kw": float(curr_kw),
            "can_start": bool(can_start),
            "can_stop": bool(can_stop),
        }

    def available_power_kw(
        self,
        step_idx: int,
        weather: WeatherDataset,
        state: dict[str, Any],
    ) -> float:
        """Mengembalikan daya maksimum (kW) yang tersedia dari diesel generator pada langkah ini."""
        return float(self.inspect_step_limits(step_idx, weather, state)["available_kw"])

    def step(
        self,
        step_idx: int,
        command_kw: float,
        weather: WeatherDataset,
        state: dict[str, Any],
        precomputed_limits: dict[str, Any] | None = None,
    ) -> ComponentStepResult:
        """Menjalankan satu langkah simulasi diesel generator sesuai batas teknis."""
        c = self.config
        dt = weather.time_config.step_hours
        limits = precomputed_limits if precomputed_limits is not None else self.inspect_step_limits(step_idx, weather, state)

        status_now = str(limits["status"])
        min_kw = float(limits["min_load_kw"])
        hours_run = float(state["hours_running_continuous"])
        hours_stop = float(state["hours_stopped_continuous"])
        total_op_hrs = float(state["total_operating_hours"])
        hrs_since_oh = float(state["hours_since_overhaul"])
        startup_count = int(state["startup_count"])
        overhaul_count = int(state["overhaul_count"])
        fuel_total_liters = float(state["fuel_consumed_total_liters"])
        co2e_total = float(state["co2e_emitted_kg"])
        current_year = int(state.get("current_year", 1))
        events: list[LifecycleEvent] = list(state.get("events", []))

        cmd = max(float(command_kw), 0.0)
        output_kw = 0.0
        new_status: DieselStatus = "off"
        new_hours_run = 0.0
        new_hours_stop = hours_stop + dt
        step_startup_cost = 0.0

        if status_now == "off":
            if cmd > 1e-12 and limits["can_start"]:
                startup_count += 1
                step_startup_cost = float(c.startup_cost)
                output_kw = min(max(cmd, min_kw), float(c.rated_capacity_kw))
                new_status = "running"
                new_hours_run = dt
                new_hours_stop = 0.0
        else:
            if cmd <= 1e-12 and limits["can_stop"]:
                output_kw = 0.0
                new_status = "off"
                new_hours_run = 0.0
                new_hours_stop = dt
            else:
                output_kw = min(max(cmd, min_kw), float(c.rated_capacity_kw))
                new_status = "running"
                new_hours_run = hours_run + dt
                new_hours_stop = 0.0

        step_fuel_liters = 0.0
        step_om_cost = 0.0
        if output_kw > 0.0:
            total_op_hrs += dt
            hrs_since_oh += dt
            if (
                c.overhaul_interval_operating_hours is not None
                and hrs_since_oh + 1e-12 >= c.overhaul_interval_operating_hours
            ):
                overhaul_count += 1
                ev = LifecycleEvent(
                    year=current_year,
                    event_type="diesel_overhaul",
                    description=(
                        f"Overhaul Diesel Generator ke-{overhaul_count} pada langkah {step_idx} tahun ke-{current_year} "
                        f"(jam operasi sejak overhaul mencapai {hrs_since_oh:.2f} jam)."
                    ),
                    cost_amount=float(c.overhaul_cost),
                )
                events.append(ev)
                self._recorded_events.append(ev)
                hrs_since_oh = 0.0

            step_fuel_liters = self.fuel_liters_for_power_kw(output_kw, dt)
            step_om_cost = dt * float(c.variable_om_per_operating_hour)

        step_fuel_cost = step_fuel_liters * float(c.fuel_price_per_liter)
        step_co2e_kg = step_fuel_liters * float(c.emission_factor_kg_co2e_per_liter)
        fuel_total_liters += step_fuel_liters
        co2e_total += step_co2e_kg

        state_out = {
            "status": new_status,
            "current_power_kw": float(output_kw),
            "hours_running_continuous": float(new_hours_run),
            "hours_stopped_continuous": float(new_hours_stop),
            "total_operating_hours": float(total_op_hrs),
            "hours_since_overhaul": float(hrs_since_oh),
            "startup_count": startup_count,
            "overhaul_count": overhaul_count,
            "fuel_consumed_total_liters": float(fuel_total_liters),
            "co2e_emitted_kg": float(co2e_total),
            "current_year": current_year,
            "events": events,
            "last_step_fuel_liters": float(step_fuel_liters),
            "last_step_co2e_kg": float(step_co2e_kg),
            "last_step_fuel_cost": float(step_fuel_cost),
            "last_step_om_cost": float(step_om_cost),
            "last_step_startup_cost": float(step_startup_cost),
        }

        return ComponentStepResult(
            available_kw=float(limits["available_kw"]),
            generation_kw=float(output_kw),
            charge_kw=0.0,
            discharge_kw=0.0,
            losses_kw=0.0,
            state_out=state_out,
        )

    def lifecycle_events(self, year: int) -> list[LifecycleEvent]:
        """Mengembalikan daftar kejadian overhaul Diesel Generator untuk tahun ke-`year`."""
        return [ev for ev in self._recorded_events if ev.year == year]


def diesel_config_to_dict(config: DieselConfig) -> dict[str, Any]:
    """Mengonversi DieselConfig menjadi kamus serializable JSON."""
    return asdict(config)
