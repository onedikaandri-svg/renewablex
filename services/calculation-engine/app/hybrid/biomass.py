"""Model komponen pembangkit listrik biomassa dengan dinamika operasi dan preset bahan bakar."""

from dataclasses import asdict, dataclass
import math
from typing import Any, Literal

import numpy as np

from app.errors import EngineError
from app.hybrid.components import ComponentStepResult, EnergyComponent, LifecycleEvent
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset

WATER_LATENT_HEAT_MJ_PER_KG = 2.443

FuelCurveModel = Literal["piecewise_heat_rate", "piecewise_efficiency", "willans_linear"]
LHVBasis = Literal["as_received", "dry"]
SupplyPeriod = Literal["unlimited", "daily", "monthly", "annual"]
BiogenicAccounting = Literal["zero_net", "gross"]
BiomassStatus = Literal["off", "starting", "running", "stopping", "outage"]

# Katalog preset sampel jenis bahan bakar biomassa [REAL DATA] sesuai dokumen kontrak Tahap 3A.
BIOMASS_FUEL_PRESETS: dict[str, dict[str, Any]] = {
    "efb": {
        "fuel_name": "Empty Fruit Bunch (Tandan Kosong Kelapa Sawit) [REAL DATA]",
        "moisture_fraction": 0.45,
        "lhv_mj_per_kg": 8.5,
        "lhv_basis": "as_received",
        "fuel_price_per_ton": 350000.0,
        "logistics_cost_per_ton": 150000.0,
        "supply_chain_emission_kg_co2e_per_ton": 35.0,
        "biogenic_co2_accounting": "zero_net",
        "is_renewable": True,
        "emission_source_note": "Sampel ilustratif EFB [REAL DATA]",
    },
    "wood_pellet": {
        "fuel_name": "Wood Pellet (Pelet Kayu) [REAL DATA]",
        "moisture_fraction": 0.08,
        "lhv_mj_per_kg": 17.5,
        "lhv_basis": "as_received",
        "fuel_price_per_ton": 2200000.0,
        "logistics_cost_per_ton": 200000.0,
        "supply_chain_emission_kg_co2e_per_ton": 65.0,
        "biogenic_co2_accounting": "zero_net",
        "is_renewable": True,
        "emission_source_note": "Sampel ilustratif Wood Pellet [REAL DATA]",
    },
    "pks": {
        "fuel_name": "Palm Kernel Shell (Cangkang Kelapa Sawit) [REAL DATA]",
        "moisture_fraction": 0.12,
        "lhv_mj_per_kg": 16.5,
        "lhv_basis": "as_received",
        "fuel_price_per_ton": 1100000.0,
        "logistics_cost_per_ton": 150000.0,
        "supply_chain_emission_kg_co2e_per_ton": 45.0,
        "biogenic_co2_accounting": "zero_net",
        "is_renewable": True,
        "emission_source_note": "Sampel ilustratif PKS [REAL DATA]",
    },
    "woodchip": {
        "fuel_name": "Woodchip (Serpihan Kayu) [REAL DATA]",
        "moisture_fraction": 0.30,
        "lhv_mj_per_kg": 12.2,
        "lhv_basis": "as_received",
        "fuel_price_per_ton": 650000.0,
        "logistics_cost_per_ton": 150000.0,
        "supply_chain_emission_kg_co2e_per_ton": 40.0,
        "biogenic_co2_accounting": "zero_net",
        "is_renewable": True,
        "emission_source_note": "Sampel ilustratif Woodchip [REAL DATA]",
    },
    "rice_husk": {
        "fuel_name": "Rice Husk (Sekam Padi) [REAL DATA]",
        "moisture_fraction": 0.12,
        "lhv_mj_per_kg": 13.5,
        "lhv_basis": "as_received",
        "fuel_price_per_ton": 400000.0,
        "logistics_cost_per_ton": 120000.0,
        "supply_chain_emission_kg_co2e_per_ton": 30.0,
        "biogenic_co2_accounting": "zero_net",
        "is_renewable": True,
        "emission_source_note": "Sampel ilustratif Sekam Padi [REAL DATA]",
    },
}

# Dua profil sampel pembangkit biomassa [REAL DATA] untuk pengujian dan contoh awal.
BIOMASS_PLANT_SAMPLES: dict[str, dict[str, Any]] = {
    "sample_gasifier_250kw": {
        "rated_capacity_kw": 250.0,
        "min_load_fraction": 0.40,
        "ramp_up_kw_per_hour": 125.0,
        "ramp_down_kw_per_hour": 125.0,
        "startup_time_hours": 1.0,
        "shutdown_time_hours": 1.0,
        "min_up_time_hours": 4.0,
        "min_down_time_hours": 2.0,
        "fuel_curve_model": "piecewise_heat_rate",
        "fuel_curve_points": ((0.40, 16500.0), (0.75, 14200.0), (1.00, 13500.0)),
        "unplanned_outage_rate": 0.03,
        "mean_time_to_repair_hours": 6.0,
        "overhaul_interval_operating_hours": 8000.0,
    },
    "sample_steam_turbine_1000kw": {
        "rated_capacity_kw": 1000.0,
        "min_load_fraction": 0.45,
        "ramp_up_kw_per_hour": 200.0,
        "ramp_down_kw_per_hour": 250.0,
        "startup_time_hours": 3.0,
        "shutdown_time_hours": 2.0,
        "min_up_time_hours": 8.0,
        "min_down_time_hours": 4.0,
        "fuel_curve_model": "piecewise_heat_rate",
        "fuel_curve_points": ((0.45, 17800.0), (0.75, 15200.0), (1.00, 14400.0)),
        "unplanned_outage_rate": 0.04,
        "mean_time_to_repair_hours": 12.0,
        "overhaul_interval_operating_hours": 16000.0,
    },
}


@dataclass(frozen=True)
class ScheduledOutageWindow:
    """Jendela pemeliharaan terencana berbasis hari (1..365) atau jam dalam setahun."""

    start_day: int | None = None
    end_day: int | None = None
    start_hour_of_year: float | None = None
    end_hour_of_year: float | None = None


@dataclass(frozen=True)
class ResolvedFuelParams:
    """Parameter bahan bakar hasil penggabungan preset dan override pengguna."""

    fuel_name: str
    moisture_fraction: float
    lhv_mj_per_kg: float
    lhv_basis: LHVBasis
    lhv_effective_mj_per_kg: float
    fuel_price_per_ton: float
    logistics_cost_per_ton: float
    supply_chain_emission_kg_co2e_per_ton: float
    biogenic_co2_accounting: BiogenicAccounting
    is_renewable: bool
    emission_source_note: str


@dataclass(frozen=True)
class BiomassConfig:
    """Konfigurasi pembangkit biomassa untuk simulasi berurutan Tahap 3A."""

    rated_capacity_kw: float
    ramp_up_kw_per_hour: float
    ramp_down_kw_per_hour: float
    min_load_fraction: float | None = None
    min_load_kw: float | None = None
    startup_time_hours: float = 0.0
    shutdown_time_hours: float = 0.0
    min_up_time_hours: float = 0.0
    min_down_time_hours: float = 0.0
    startup_fuel_tons: float = 0.0

    fuel_curve_model: FuelCurveModel = "piecewise_heat_rate"
    fuel_curve_points: tuple[tuple[float, float], ...] | None = None
    no_load_fuel_kw_th: float | None = None
    slope_kw_th_per_kw_el: float | None = None

    fuel_preset: str | None = None
    fuel_name: str | None = None
    lhv_mj_per_kg: float | None = None
    lhv_basis: LHVBasis | None = None
    moisture_fraction: float | None = None
    fuel_price_per_ton: float | None = None
    logistics_cost_per_ton: float | None = None
    supply_period: SupplyPeriod = "unlimited"
    supply_limit_tons: float | None = None

    scheduled_outage_windows: tuple[ScheduledOutageWindow, ...] = ()
    unplanned_outage_rate: float = 0.0
    mean_time_to_repair_hours: float = 0.0
    outage_seed: int = 42

    fixed_om_per_kw_year: float = 0.0
    variable_om_per_kwh: float = 0.0
    startup_cost: float = 0.0
    overhaul_interval_operating_hours: float | None = None
    overhaul_cost: float = 0.0

    emission_factor_kg_co2e_per_kg_fuel: float = 0.0
    emission_factor_kg_co2e_per_kwh: float = 0.0
    supply_chain_emission_kg_co2e_per_ton: float | None = None
    biogenic_co2_accounting: BiogenicAccounting | None = None
    is_renewable: bool | None = None
    emission_source_note: str | None = None

    chp_enabled: bool = False
    heat_to_power_ratio: float | None = None
    thermal_efficiency_fraction: float | None = None

    @property
    def effective_min_load_kw(self) -> float:
        """Batas beban teknis minimum dalam satuan kW."""
        if self.min_load_kw is not None:
            return float(self.min_load_kw)
        if self.min_load_fraction is not None:
            return float(self.min_load_fraction) * float(self.rated_capacity_kw)
        raise EngineError("invalid_biomass_config", "min_load_fraction atau min_load_kw wajib diisi.")

    @property
    def effective_min_load_fraction(self) -> float:
        """Batas beban teknis minimum sebagai fraksi terhadap kapasitas terpasang."""
        return self.effective_min_load_kw / float(self.rated_capacity_kw)

    @property
    def effective_fuel_params(self) -> ResolvedFuelParams:
        """Mengembalikan parameter bahan bakar lengkap setelah resolusi preset dan override."""
        base: dict[str, Any] = {}
        if self.fuel_preset is not None and self.fuel_preset != "custom":
            if self.fuel_preset not in BIOMASS_FUEL_PRESETS:
                raise EngineError(
                    "invalid_biomass_config",
                    f"fuel_preset tidak dikenal: {self.fuel_preset}.",
                )
            base = dict(BIOMASS_FUEL_PRESETS[self.fuel_preset])

        fuel_name = self.fuel_name if self.fuel_name is not None else base.get("fuel_name")
        moisture = self.moisture_fraction if self.moisture_fraction is not None else base.get("moisture_fraction")
        lhv = self.lhv_mj_per_kg if self.lhv_mj_per_kg is not None else base.get("lhv_mj_per_kg")
        basis = self.lhv_basis if self.lhv_basis is not None else base.get("lhv_basis", "as_received")
        price = self.fuel_price_per_ton if self.fuel_price_per_ton is not None else base.get("fuel_price_per_ton", 0.0)
        logistics = (
            self.logistics_cost_per_ton
            if self.logistics_cost_per_ton is not None
            else base.get("logistics_cost_per_ton", 0.0)
        )
        sc_em = (
            self.supply_chain_emission_kg_co2e_per_ton
            if self.supply_chain_emission_kg_co2e_per_ton is not None
            else base.get("supply_chain_emission_kg_co2e_per_ton", 0.0)
        )
        accounting = (
            self.biogenic_co2_accounting
            if self.biogenic_co2_accounting is not None
            else base.get("biogenic_co2_accounting", "zero_net")
        )
        renewable = self.is_renewable if self.is_renewable is not None else base.get("is_renewable", True)
        note = (
            self.emission_source_note
            if self.emission_source_note is not None
            else base.get("emission_source_note", "")
        )

        if fuel_name is None or not str(fuel_name).strip():
            raise EngineError("invalid_biomass_config", "fuel_name atau fuel_preset wajib diisi.")
        if lhv is None or not math.isfinite(float(lhv)) or float(lhv) <= 0.0:
            raise EngineError("invalid_biomass_config", "lhv_mj_per_kg harus lebih besar dari 0.")
        if moisture is None:
            moisture = 0.0
        moisture_f = float(moisture)
        lhv_f = float(lhv)
        if not math.isfinite(moisture_f) or not (0.0 <= moisture_f < 1.0):
            raise EngineError("invalid_biomass_config", "moisture_fraction harus berada di rentang [0, 1).")
        if basis not in ("as_received", "dry"):
            raise EngineError("invalid_biomass_config", f"lhv_basis tidak dikenal: {basis}.")

        if basis == "dry":
            lhv_eff = lhv_f * (1.0 - moisture_f) - WATER_LATENT_HEAT_MJ_PER_KG * moisture_f
        else:
            lhv_eff = lhv_f

        if not math.isfinite(lhv_eff) or lhv_eff <= 0.0:
            raise EngineError(
                "invalid_biomass_config",
                "LHV efektif kondisi terima harus lebih besar dari 0 setelah koreksi kadar air.",
            )

        return ResolvedFuelParams(
            fuel_name=str(fuel_name),
            moisture_fraction=moisture_f,
            lhv_mj_per_kg=lhv_f,
            lhv_basis=basis,  # type: ignore[arg-type]
            lhv_effective_mj_per_kg=lhv_eff,
            fuel_price_per_ton=float(price),
            logistics_cost_per_ton=float(logistics),
            supply_chain_emission_kg_co2e_per_ton=float(sc_em),
            biogenic_co2_accounting=accounting,  # type: ignore[arg-type]
            is_renewable=bool(renewable),
            emission_source_note=str(note),
        )

    @property
    def effective_is_renewable(self) -> bool:
        """Menandai apakah pembangkit biomassa dihitung dalam renewable_fraction."""
        return self.effective_fuel_params.is_renewable


def build_sample_biomass_config(
    sample_name: str = "sample_gasifier_250kw",
    fuel_preset: str = "efb",
    **overrides: Any,
) -> BiomassConfig:
    """Membangun konfigurasi BiomassConfig dari profil sampel pembangkit dan preset bahan bakar [REAL DATA]."""
    if sample_name not in BIOMASS_PLANT_SAMPLES:
        raise EngineError("invalid_biomass_config", f"Profil sampel pembangkit tidak dikenal: {sample_name}.")
    merged = dict(BIOMASS_PLANT_SAMPLES[sample_name])
    merged["fuel_preset"] = fuel_preset
    merged.update(overrides)
    return BiomassConfig(**merged)


def resolve_biomass_config(raw: dict[str, Any]) -> BiomassConfig:
    """Mem-parsing kamus konfigurasi JSON menjadi BiomassConfig yang tervalidasi."""
    data = dict(raw)
    data.pop("enabled", None)
    plant_sample = data.pop("plant_sample", None)

    merged: dict[str, Any] = {}
    if plant_sample is not None:
        if plant_sample not in BIOMASS_PLANT_SAMPLES:
            raise EngineError("invalid_biomass_config", f"plant_sample tidak dikenal: {plant_sample}.")
        merged.update(BIOMASS_PLANT_SAMPLES[plant_sample])
    merged.update(data)

    if "fuel_curve_points" in merged and merged["fuel_curve_points"] is not None:
        merged["fuel_curve_points"] = tuple(
            (float(pt[0]), float(pt[1])) for pt in merged["fuel_curve_points"]
        )

    if "scheduled_outage_windows" in merged and merged["scheduled_outage_windows"] is not None:
        windows: list[ScheduledOutageWindow] = []
        for w in merged["scheduled_outage_windows"]:
            if isinstance(w, ScheduledOutageWindow):
                windows.append(w)
            elif isinstance(w, dict):
                windows.append(
                    ScheduledOutageWindow(
                        start_day=None if w.get("start_day") is None else int(w["start_day"]),
                        end_day=None if w.get("end_day") is None else int(w["end_day"]),
                        start_hour_of_year=(
                            None if w.get("start_hour_of_year") is None else float(w["start_hour_of_year"])
                        ),
                        end_hour_of_year=(
                            None if w.get("end_hour_of_year") is None else float(w["end_hour_of_year"])
                        ),
                    )
                )
            else:
                raise EngineError("invalid_biomass_config", "Format scheduled_outage_windows tidak valid.")
        merged["scheduled_outage_windows"] = tuple(windows)

    try:
        cfg = BiomassConfig(**merged)
    except TypeError as exc:
        raise EngineError("invalid_biomass_config", f"Konfigurasi biomassa tidak valid: {exc}.") from exc
    BiomassComponent(cfg).validate()
    return cfg


def _is_non_negative_finite(val: float) -> bool:
    return math.isfinite(val) and val >= 0.0


class BiomassComponent(EnergyComponent):
    """Komponen pembangkit biomassa dengan kendala teknis, pasokan, ketersediaan, dan emisi."""

    def __init__(self, config: BiomassConfig):
        self.config = config
        self._recorded_events: list[LifecycleEvent] = []
        self._cached_time_key: tuple[int, str] | None = None
        self._cached_outage_masks: tuple[np.ndarray, np.ndarray] | None = None
        self._cached_fuel_params: ResolvedFuelParams | None = None
        self._cached_min_load_kw: float | None = None
        self._cached_curve_xs: tuple[float, ...] | None = None
        self._cached_curve_ys_hr: tuple[float, ...] | None = None
        self._fuel_tons_min_cache: dict[float, float] = {}
        self._fuel_tons_rated_cache: dict[float, float] = {}

    def _get_fuel_params(self) -> ResolvedFuelParams:
        if self._cached_fuel_params is None:
            self._cached_fuel_params = self.config.effective_fuel_params
        return self._cached_fuel_params

    def _get_min_load_kw(self) -> float:
        if self._cached_min_load_kw is None:
            self._cached_min_load_kw = self.config.effective_min_load_kw
        return self._cached_min_load_kw

    def _ensure_curve_cache(self) -> tuple[tuple[float, ...], tuple[float, ...]]:
        if self._cached_curve_xs is not None and self._cached_curve_ys_hr is not None:
            return self._cached_curve_xs, self._cached_curve_ys_hr
        c = self.config
        assert c.fuel_curve_points is not None
        xs = tuple(float(pt[0]) for pt in c.fuel_curve_points)
        if c.fuel_curve_model == "piecewise_efficiency":
            ys_hr = tuple(3600.0 / float(pt[1]) for pt in c.fuel_curve_points)
        else:
            ys_hr = tuple(float(pt[1]) for pt in c.fuel_curve_points)
        self._cached_curve_xs = xs
        self._cached_curve_ys_hr = ys_hr
        return xs, ys_hr

    def validate(self) -> None:
        c = self.config
        if not math.isfinite(c.rated_capacity_kw) or c.rated_capacity_kw <= 0.0:
            raise EngineError("invalid_biomass_config", "rated_capacity_kw harus lebih besar dari 0.")
        if not math.isfinite(c.ramp_up_kw_per_hour) or c.ramp_up_kw_per_hour <= 0.0:
            raise EngineError("invalid_biomass_config", "ramp_up_kw_per_hour harus lebih besar dari 0.")
        if not math.isfinite(c.ramp_down_kw_per_hour) or c.ramp_down_kw_per_hour <= 0.0:
            raise EngineError("invalid_biomass_config", "ramp_down_kw_per_hour harus lebih besar dari 0.")

        if c.min_load_fraction is None and c.min_load_kw is None:
            raise EngineError("invalid_biomass_config", "min_load_fraction atau min_load_kw wajib diisi.")
        if c.min_load_fraction is not None and (
            not math.isfinite(c.min_load_fraction) or not (0.0 <= c.min_load_fraction <= 1.0)
        ):
            raise EngineError("invalid_biomass_config", "min_load_fraction harus berada di antara 0 dan 1.")
        if c.min_load_kw is not None and (
            not math.isfinite(c.min_load_kw) or not (0.0 <= c.min_load_kw <= c.rated_capacity_kw)
        ):
            raise EngineError("invalid_biomass_config", "min_load_kw harus berada antara 0 dan rated_capacity_kw.")
        if c.min_load_fraction is not None and c.min_load_kw is not None:
            expected = c.min_load_fraction * c.rated_capacity_kw
            if abs(expected - c.min_load_kw) > 1e-6:
                raise EngineError(
                    "invalid_biomass_config",
                    "min_load_fraction dan min_load_kw tidak konsisten terhadap rated_capacity_kw.",
                )

        for name, val in (
            ("startup_time_hours", c.startup_time_hours),
            ("shutdown_time_hours", c.shutdown_time_hours),
            ("min_up_time_hours", c.min_up_time_hours),
            ("min_down_time_hours", c.min_down_time_hours),
            ("startup_fuel_tons", c.startup_fuel_tons),
            ("fixed_om_per_kw_year", c.fixed_om_per_kw_year),
            ("variable_om_per_kwh", c.variable_om_per_kwh),
            ("startup_cost", c.startup_cost),
            ("overhaul_cost", c.overhaul_cost),
            ("emission_factor_kg_co2e_per_kg_fuel", c.emission_factor_kg_co2e_per_kg_fuel),
            ("emission_factor_kg_co2e_per_kwh", c.emission_factor_kg_co2e_per_kwh),
        ):
            if not _is_non_negative_finite(val):
                raise EngineError("invalid_biomass_config", f"{name} harus bernilai >= 0 dan hingga.")

        self._validate_fuel_curve()
        fuel = c.effective_fuel_params
        if not _is_non_negative_finite(fuel.fuel_price_per_ton):
            raise EngineError("invalid_biomass_config", "fuel_price_per_ton tidak boleh negatif.")
        if not _is_non_negative_finite(fuel.logistics_cost_per_ton):
            raise EngineError("invalid_biomass_config", "logistics_cost_per_ton tidak boleh negatif.")
        if not _is_non_negative_finite(fuel.supply_chain_emission_kg_co2e_per_ton):
            raise EngineError("invalid_biomass_config", "supply_chain_emission_kg_co2e_per_ton tidak boleh negatif.")

        if c.supply_period not in ("unlimited", "daily", "monthly", "annual"):
            raise EngineError("invalid_biomass_config", f"supply_period tidak dikenal: {c.supply_period}.")
        if c.supply_period != "unlimited":
            if c.supply_limit_tons is None or not math.isfinite(c.supply_limit_tons) or c.supply_limit_tons <= 0.0:
                raise EngineError(
                    "invalid_biomass_config",
                    "supply_limit_tons wajib diisi (> 0) ketika supply_period bukan unlimited.",
                )

        if not math.isfinite(c.unplanned_outage_rate) or not (0.0 <= c.unplanned_outage_rate < 1.0):
            raise EngineError("invalid_biomass_config", "unplanned_outage_rate harus di rentang [0, 1).")
        if c.unplanned_outage_rate > 0.0 and (
            not math.isfinite(c.mean_time_to_repair_hours) or c.mean_time_to_repair_hours <= 0.0
        ):
            raise EngineError(
                "invalid_biomass_config",
                "mean_time_to_repair_hours wajib > 0 ketika unplanned_outage_rate > 0.",
            )
        if not _is_non_negative_finite(c.mean_time_to_repair_hours):
            raise EngineError("invalid_biomass_config", "mean_time_to_repair_hours tidak boleh negatif.")

        for w in c.scheduled_outage_windows:
            has_days = w.start_day is not None or w.end_day is not None
            has_hours = w.start_hour_of_year is not None or w.end_hour_of_year is not None
            if has_days == has_hours:
                raise EngineError(
                    "invalid_biomass_config",
                    "Setiap jendela pemeliharaan harus memakai start_day/end_day ATAU start_hour_of_year/end_hour_of_year.",
                )
            if has_days:
                if w.start_day is None or w.end_day is None:
                    raise EngineError("invalid_biomass_config", "start_day dan end_day harus diisi berpasangan.")
                if not (1 <= w.start_day <= w.end_day <= 365):
                    raise EngineError("invalid_biomass_config", "start_day dan end_day harus memenuhi 1 <= start <= end <= 365.")
            if has_hours:
                if w.start_hour_of_year is None or w.end_hour_of_year is None:
                    raise EngineError("invalid_biomass_config", "start_hour_of_year dan end_hour_of_year harus berpasangan.")
                if not (0.0 <= w.start_hour_of_year < w.end_hour_of_year <= 8760.0):
                    raise EngineError(
                        "invalid_biomass_config",
                        "start_hour_of_year dan end_hour_of_year harus memenuhi 0 <= start < end <= 8760.",
                    )

        if c.overhaul_interval_operating_hours is not None and (
            not math.isfinite(c.overhaul_interval_operating_hours) or c.overhaul_interval_operating_hours <= 0.0
        ):
            raise EngineError("invalid_biomass_config", "overhaul_interval_operating_hours harus lebih besar dari 0.")

        if c.chp_enabled:
            has_htp = c.heat_to_power_ratio is not None
            has_th_eff = c.thermal_efficiency_fraction is not None
            if not has_htp and not has_th_eff:
                raise EngineError(
                    "invalid_biomass_config",
                    "heat_to_power_ratio atau thermal_efficiency_fraction wajib diisi saat chp_enabled=True.",
                )
            if c.heat_to_power_ratio is not None and (
                not math.isfinite(c.heat_to_power_ratio) or c.heat_to_power_ratio <= 0.0
            ):
                raise EngineError("invalid_biomass_config", "heat_to_power_ratio harus lebih besar dari 0.")
            if c.thermal_efficiency_fraction is not None and (
                not math.isfinite(c.thermal_efficiency_fraction) or not (0.0 < c.thermal_efficiency_fraction <= 1.0)
            ):
                raise EngineError("invalid_biomass_config", "thermal_efficiency_fraction harus di rentang (0, 1].")

    def _validate_fuel_curve(self) -> None:
        c = self.config
        min_frac = c.effective_min_load_fraction
        if c.fuel_curve_model == "willans_linear":
            if c.no_load_fuel_kw_th is None or c.slope_kw_th_per_kw_el is None:
                raise EngineError(
                    "invalid_biomass_config",
                    "no_load_fuel_kw_th dan slope_kw_th_per_kw_el wajib diisi untuk willans_linear.",
                )
            if not _is_non_negative_finite(c.no_load_fuel_kw_th):
                raise EngineError("invalid_biomass_config", "no_load_fuel_kw_th harus >= 0.")
            if not math.isfinite(c.slope_kw_th_per_kw_el) or c.slope_kw_th_per_kw_el <= 0.0:
                raise EngineError("invalid_biomass_config", "slope_kw_th_per_kw_el harus > 0.")
            return

        if c.fuel_curve_model not in ("piecewise_heat_rate", "piecewise_efficiency"):
            raise EngineError("invalid_biomass_config", f"fuel_curve_model tidak dikenal: {c.fuel_curve_model}.")

        pts = c.fuel_curve_points
        if pts is None or len(pts) < 2:
            raise EngineError(
                "invalid_biomass_config",
                "fuel_curve_points minimal harus memiliki 2 titik (load_fraction, nilai).",
            )
        prev_x = -1.0
        for x, y in pts:
            if not math.isfinite(x) or not math.isfinite(y):
                raise EngineError("invalid_biomass_config", "Titik fuel_curve_points harus berupa angka hingga.")
            if not (0.0 <= x <= 1.0) or x <= prev_x:
                raise EngineError(
                    "invalid_biomass_config",
                    "load_fraction pada fuel_curve_points harus menaik ketat di rentang [0, 1].",
                )
            if c.fuel_curve_model == "piecewise_heat_rate" and y <= 0.0:
                raise EngineError("invalid_biomass_config", "Nilai heat rate (kJ/kWh) harus lebih besar dari 0.")
            if c.fuel_curve_model == "piecewise_efficiency" and not (0.0 < y <= 1.0):
                raise EngineError("invalid_biomass_config", "Nilai efisiensi listrik harus di rentang (0, 1].")
            prev_x = x

        if pts[0][0] > min_frac + 1e-9 or pts[-1][0] < 1.0 - 1e-9:
            raise EngineError(
                "invalid_biomass_config",
                "fuel_curve_points harus mencakup rentang dari min_load_fraction hingga 1.0.",
            )

    def _heat_rate_kj_per_kwh(self, load_fraction: float) -> float:
        c = self.config
        if c.fuel_curve_model == "willans_linear":
            assert c.no_load_fuel_kw_th is not None and c.slope_kw_th_per_kw_el is not None
            power_kw = max(load_fraction * c.rated_capacity_kw, 1e-9)
            thermal_kw = c.no_load_fuel_kw_th + c.slope_kw_th_per_kw_el * power_kw
            return (thermal_kw / power_kw) * 3600.0

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

    def fuel_energy_mj_for_power_kw(self, power_kw: float, step_hours: float) -> float:
        """Menghitung kebutuhan energi panas bahan bakar (MJ) untuk keluaran daya listrik tertentu."""
        if power_kw <= 0.0 or step_hours <= 0.0:
            return 0.0
        c = self.config
        if c.fuel_curve_model == "willans_linear":
            assert c.no_load_fuel_kw_th is not None and c.slope_kw_th_per_kw_el is not None
            thermal_kw = c.no_load_fuel_kw_th + c.slope_kw_th_per_kw_el * power_kw
            return thermal_kw * 3.6 * step_hours
        load_frac = power_kw / c.rated_capacity_kw
        hr = self._heat_rate_kj_per_kwh(load_frac)
        return (hr * power_kw * step_hours) / 1000.0

    def fuel_tons_for_power_kw(self, power_kw: float, step_hours: float) -> float:
        """Menghitung konsumsi massa bahan bakar (ton) untuk keluaran daya listrik pada satu langkah."""
        energy_mj = self.fuel_energy_mj_for_power_kw(power_kw, step_hours)
        if energy_mj <= 0.0:
            return 0.0
        lhv_eff = self._get_fuel_params().lhv_effective_mj_per_kg
        fuel_kg = energy_mj / lhv_eff
        return fuel_kg / 1000.0

    def _get_min_fuel_tons(self, step_hours: float) -> float:
        val = self._fuel_tons_min_cache.get(step_hours)
        if val is None:
            val = self.fuel_tons_for_power_kw(self._get_min_load_kw(), step_hours)
            self._fuel_tons_min_cache[step_hours] = val
        return val

    def _get_rated_fuel_tons(self, step_hours: float) -> float:
        val = self._fuel_tons_rated_cache.get(step_hours)
        if val is None:
            val = self.fuel_tons_for_power_kw(self.config.rated_capacity_kw, step_hours)
            self._fuel_tons_rated_cache[step_hours] = val
        return val

    def max_power_for_fuel_tons(self, remaining_tons: float, step_hours: float) -> float:
        """Mencari daya listrik maksimum (kW) yang dapat ditopang oleh sisa bahan bakar."""
        c = self.config
        if remaining_tons <= 0.0 or step_hours <= 0.0:
            return 0.0
        min_kw = self._get_min_load_kw()
        if self._get_min_fuel_tons(step_hours) > remaining_tons + 1e-12:
            return 0.0
        if self._get_rated_fuel_tons(step_hours) <= remaining_tons + 1e-12:
            return float(c.rated_capacity_kw)

        lo = min_kw
        hi = float(c.rated_capacity_kw)
        for _ in range(44):
            mid = 0.5 * (lo + hi)
            if self.fuel_tons_for_power_kw(mid, step_hours) <= remaining_tons:
                lo = mid
            else:
                hi = mid
        return lo

    def prepare_outage_masks(self, time_config: TimeConfig) -> tuple[np.ndarray, np.ndarray]:
        """Membangun mask gangguan terjadwal dan tak terjadwal secara deterministik."""
        key = (time_config.steps_per_year, time_config.timezone)
        if self._cached_time_key == key and self._cached_outage_masks is not None:
            return self._cached_outage_masks

        self.validate()
        n = time_config.steps_per_year
        dt = time_config.step_hours
        day_idx = time_config.day_indices()

        scheduled = np.zeros(n, dtype=bool)
        if self.config.scheduled_outage_windows:
            step_starts = np.arange(n, dtype=np.float64) * dt
            step_ends = step_starts + dt
            for w in self.config.scheduled_outage_windows:
                if w.start_day is not None and w.end_day is not None:
                    scheduled |= (day_idx >= (w.start_day - 1)) & (day_idx <= (w.end_day - 1))
                elif w.start_hour_of_year is not None and w.end_hour_of_year is not None:
                    scheduled |= (step_ends > w.start_hour_of_year) & (step_starts < w.end_hour_of_year)

        unplanned = np.zeros(n, dtype=bool)
        for_rate = self.config.unplanned_outage_rate
        if for_rate > 0.0:
            mttr = self.config.mean_time_to_repair_hours
            p_repair = min(dt / mttr, 1.0)
            p_fail = min((for_rate / (1.0 - for_rate)) * p_repair, 1.0)
            rng = np.random.default_rng(self.config.outage_seed)
            in_outage = False
            for t in range(n):
                if scheduled[t]:
                    in_outage = False
                    continue
                u = float(rng.random())
                if in_outage:
                    if u < p_repair:
                        in_outage = False
                else:
                    if u < p_fail:
                        in_outage = True
                unplanned[t] = in_outage

        self._cached_time_key = key
        self._cached_outage_masks = (scheduled, unplanned)
        return scheduled, unplanned

    def _period_key(self, step_idx: int, weather: WeatherDataset, year: int) -> int:
        period = self.config.supply_period
        if period == "daily":
            return int(weather.time_config.day_indices()[step_idx])
        if period == "monthly":
            return int(weather.time_config.month_indices()[step_idx])
        if period == "annual":
            return int(year)
        return 0

    def initial_state(self, year: int = 1) -> dict[str, Any]:
        """Membuat state awal pembangkit biomassa sebelum langkah simulasi pertama."""
        self.validate()
        self._recorded_events = []
        return {
            "status": "off",
            "current_power_kw": 0.0,
            "hours_in_state": float(self.config.min_down_time_hours),
            "hours_running_continuous": 0.0,
            "hours_stopped_continuous": float(self.config.min_down_time_hours),
            "total_operating_hours": 0.0,
            "hours_since_overhaul": 0.0,
            "startup_count": 0,
            "overhaul_count": 0,
            "fuel_consumed_period_tons": 0.0,
            "fuel_consumed_total_tons": 0.0,
            "co2e_emitted_kg": 0.0,
            "thermal_output_kw_th": 0.0,
            "current_period_key": None,
            "current_year": int(year),
            "events": [],
            "last_step_fuel_tons": 0.0,
            "last_step_co2e_kg": 0.0,
            "last_step_fuel_cost": 0.0,
            "last_step_logistics_cost": 0.0,
            "last_step_om_cost": 0.0,
            "last_step_startup_cost": 0.0,
            "last_step_forced_stop": False,
            "last_step_note": "",
        }

    def inspect_step_limits(
        self,
        step_idx: int,
        weather: WeatherDataset,
        state: dict[str, Any],
    ) -> dict[str, Any]:
        """Menghitung batas kemampuan dan kesiapan start/stop Biomass pada langkah `step_idx`."""
        c = self.config
        dt = weather.time_config.step_hours
        current_year = int(state.get("current_year", 1))
        scheduled, unplanned = self.prepare_outage_masks(weather.time_config)
        is_outage = bool(scheduled[step_idx] or unplanned[step_idx])

        period_key = self._period_key(step_idx, weather, current_year)
        prev_period_key = state.get("current_period_key")
        fuel_period_used = (
            0.0 if prev_period_key != period_key else float(state["fuel_consumed_period_tons"])
        )

        fuel_remaining: float | None = None
        if c.supply_period != "unlimited":
            assert c.supply_limit_tons is not None
            fuel_remaining = max(float(c.supply_limit_tons) - fuel_period_used, 0.0)

        status: str = str(state["status"])
        if is_outage:
            status_now = "outage"
        elif status == "outage":
            status_now = "off"
        else:
            status_now = status

        min_kw = self._get_min_load_kw()
        curr_kw = float(state["current_power_kw"]) if status_now == "running" else 0.0
        hours_in_state = float(state["hours_in_state"])
        hours_run = float(state["hours_running_continuous"])
        hours_stop = float(state["hours_stopped_continuous"])

        if fuel_remaining is None:
            max_by_fuel = float(c.rated_capacity_kw)
            fuel_ok_for_start = True
            fuel_ok_for_min = True
        else:
            max_by_fuel = self.max_power_for_fuel_tons(fuel_remaining, dt)
            min_fuel = self._get_min_fuel_tons(dt)
            fuel_ok_for_min = fuel_remaining + 1e-12 >= min_fuel
            if c.startup_time_hours == 0.0:
                fuel_ok_for_start = fuel_remaining + 1e-12 >= (c.startup_fuel_tons + min_fuel)
            else:
                fuel_ok_for_start = fuel_remaining + 1e-12 >= c.startup_fuel_tons

        can_start = (
            not is_outage
            and status_now == "off"
            and hours_stop + 1e-12 >= c.min_down_time_hours
            and fuel_ok_for_start
        )
        can_stop = (
            status_now == "running" and hours_run + 1e-12 >= c.min_up_time_hours
        ) or status_now == "starting"

        available_kw = 0.0
        if not is_outage:
            if status_now == "running" and fuel_ok_for_min:
                ramp_hi = min(float(c.rated_capacity_kw), curr_kw + c.ramp_up_kw_per_hour * dt)
                available_kw = min(ramp_hi, max_by_fuel)
            elif status_now == "starting" and hours_in_state + 1e-12 >= c.startup_time_hours and fuel_ok_for_min:
                first_hi = min(float(c.rated_capacity_kw), max(min_kw, c.ramp_up_kw_per_hour * dt))
                available_kw = min(first_hi, max_by_fuel)
            elif status_now == "off" and c.startup_time_hours == 0.0 and can_start:
                if fuel_remaining is None:
                    cap_fuel = float(c.rated_capacity_kw)
                elif c.startup_fuel_tons == 0.0:
                    cap_fuel = max_by_fuel
                else:
                    rem_after_startup = max(fuel_remaining - c.startup_fuel_tons, 0.0)
                    cap_fuel = self.max_power_for_fuel_tons(rem_after_startup, dt)
                first_hi = min(float(c.rated_capacity_kw), max(min_kw, c.ramp_up_kw_per_hour * dt))
                available_kw = min(first_hi, cap_fuel)

        return {
            "status": status_now,
            "available_kw": float(max(available_kw, 0.0)),
            "min_load_kw": float(min_kw),
            "current_power_kw": float(curr_kw),
            "can_start": bool(can_start),
            "can_stop": bool(can_stop),
            "fuel_remaining_tons": fuel_remaining,
            "max_by_fuel_kw": float(max_by_fuel),
            "is_outage": is_outage,
            "period_key": period_key,
            "fuel_period_used": fuel_period_used,
        }

    def available_power_kw(
        self,
        step_idx: int,
        weather: WeatherDataset,
        state: dict[str, Any],
    ) -> float:
        """Mengembalikan daya maksimum (kW) yang tersedia dari Biomass pada langkah ini."""
        return float(self.inspect_step_limits(step_idx, weather, state)["available_kw"])

    def _compute_emissions_kg(self, output_kw: float, fuel_tons: float, step_hours: float) -> float:
        c = self.config
        fuel_params = self._get_fuel_params()
        supply_chain_kg = fuel_tons * fuel_params.supply_chain_emission_kg_co2e_per_ton
        combustion_kg = 0.0
        if fuel_params.biogenic_co2_accounting == "gross":
            combustion_kg = (
                (fuel_tons * 1000.0) * c.emission_factor_kg_co2e_per_kg_fuel
                + (output_kw * step_hours) * c.emission_factor_kg_co2e_per_kwh
            )
        return supply_chain_kg + combustion_kg

    def _compute_thermal_kw_th(self, output_kw: float, fuel_energy_mj: float, step_hours: float) -> float:
        c = self.config
        if not c.chp_enabled or output_kw <= 0.0:
            return 0.0
        if c.heat_to_power_ratio is not None:
            return output_kw * float(c.heat_to_power_ratio)
        if c.thermal_efficiency_fraction is not None and step_hours > 0.0:
            fuel_kw_th = fuel_energy_mj / (3.6 * step_hours)
            return fuel_kw_th * float(c.thermal_efficiency_fraction)
        return 0.0

    def step(
        self,
        step_idx: int,
        command_kw: float,
        weather: WeatherDataset,
        state: dict[str, Any],
        start_request: bool = False,
        stop_request: bool = False,
        precomputed_limits: dict[str, Any] | None = None,
    ) -> ComponentStepResult:
        """Menjalankan satu langkah simulasi pembangkit biomassa sesuai batas fisik."""
        c = self.config
        dt = weather.time_config.step_hours
        fuel_params = self._get_fuel_params()
        limits = precomputed_limits if precomputed_limits is not None else self.inspect_step_limits(step_idx, weather, state)

        prev_status = str(state["status"])
        status_now = str(limits["status"])
        is_outage = bool(limits["is_outage"])
        min_kw = float(limits["min_load_kw"])
        curr_kw = float(limits["current_power_kw"])
        hours_in_state = float(state["hours_in_state"])
        hours_run = float(state["hours_running_continuous"])
        hours_stop = float(state["hours_stopped_continuous"])
        total_op_hrs = float(state["total_operating_hours"])
        hrs_since_oh = float(state["hours_since_overhaul"])
        startup_count = int(state["startup_count"])
        overhaul_count = int(state["overhaul_count"])
        fuel_period_used = float(limits["fuel_period_used"])
        fuel_total_used = float(state["fuel_consumed_total_tons"])
        co2e_total = float(state["co2e_emitted_kg"])
        current_year = int(state.get("current_year", 1))
        events: list[LifecycleEvent] = list(state.get("events", []))
        fuel_remaining = limits["fuel_remaining_tons"]

        if prev_status == "outage" and status_now == "off":
            hours_in_state = 0.0

        cmd = max(float(command_kw), 0.0)
        want_on = bool(start_request or cmd > 1e-12) and not bool(stop_request)

        output_kw = 0.0
        new_status = status_now
        new_hours_in_state = hours_in_state
        new_hours_run = hours_run
        new_hours_stop = hours_stop
        step_fuel_tons = 0.0
        step_startup_cost = 0.0
        forced_stop = False
        note = ""

        if is_outage:
            if prev_status in ("running", "starting"):
                forced_stop = True
                note = "forced_stop: gangguan terjadwal atau tak terjadwal"
            new_status = "outage"
            new_hours_in_state = (hours_in_state + dt) if prev_status == "outage" else dt
            new_hours_run = 0.0
            new_hours_stop = hours_stop + dt
        elif status_now == "stopping":
            new_hours_in_state = hours_in_state + dt
            new_hours_stop = hours_stop + dt
            new_hours_run = 0.0
            if new_hours_in_state + 1e-12 >= c.shutdown_time_hours:
                new_status = "off"
                new_hours_in_state = 0.0
            else:
                new_status = "stopping"
        elif status_now == "off":
            if want_on and limits["can_start"]:
                startup_count += 1
                step_fuel_tons += c.startup_fuel_tons
                step_startup_cost += c.startup_cost
                rem_after_start = None if fuel_remaining is None else max(fuel_remaining - c.startup_fuel_tons, 0.0)
                if c.startup_time_hours == 0.0:
                    if rem_after_start is None:
                        max_fuel_kw = float(c.rated_capacity_kw)
                    elif c.startup_fuel_tons == 0.0 and "max_by_fuel_kw" in limits:
                        max_fuel_kw = float(limits["max_by_fuel_kw"])
                    else:
                        max_fuel_kw = self.max_power_for_fuel_tons(rem_after_start, dt)
                    first_hi = min(float(c.rated_capacity_kw), max(min_kw, c.ramp_up_kw_per_hour * dt), max_fuel_kw)
                    if first_hi + 1e-12 >= min_kw and cmd > 1e-12:
                        output_kw = min(max(cmd, min_kw), first_hi)
                        step_fuel_tons += self.fuel_tons_for_power_kw(output_kw, dt)
                        new_status = "running"
                        new_hours_in_state = dt
                        new_hours_run = dt
                        new_hours_stop = 0.0
                    else:
                        new_status = "off"
                        new_hours_in_state = hours_in_state + dt
                        new_hours_stop = hours_stop + dt
                        new_hours_run = 0.0
                else:
                    new_status = "starting"
                    new_hours_in_state = dt
                    new_hours_stop = hours_stop + dt
                    new_hours_run = 0.0
            else:
                new_status = "off"
                new_hours_in_state = hours_in_state + dt
                new_hours_stop = hours_stop + dt
                new_hours_run = 0.0
        elif status_now == "starting":
            if stop_request:
                new_status = "off"
                new_hours_in_state = 0.0
                new_hours_stop = hours_stop + dt
                new_hours_run = 0.0
            elif hours_in_state + 1e-12 >= c.startup_time_hours:
                max_fuel_kw = (
                    float(limits["max_by_fuel_kw"])
                    if "max_by_fuel_kw" in limits
                    else (
                        float(c.rated_capacity_kw)
                        if fuel_remaining is None
                        else self.max_power_for_fuel_tons(fuel_remaining, dt)
                    )
                )
                first_hi = min(float(c.rated_capacity_kw), max(min_kw, c.ramp_up_kw_per_hour * dt), max_fuel_kw)
                if max_fuel_kw + 1e-12 < min_kw:
                    forced_stop = True
                    note = "forced_stop: sisa bahan bakar tidak mencukupi beban minimum setelah start"
                    new_status = "off"
                    new_hours_in_state = 0.0
                    new_hours_stop = hours_stop + dt
                    new_hours_run = 0.0
                elif cmd > 1e-12:
                    output_kw = min(max(cmd, min_kw), first_hi)
                    step_fuel_tons += self.fuel_tons_for_power_kw(output_kw, dt)
                    new_status = "running"
                    new_hours_in_state = dt
                    new_hours_run = dt
                    new_hours_stop = 0.0
                else:
                    new_status = "off" if c.shutdown_time_hours == 0.0 else "stopping"
                    new_hours_in_state = dt if new_status == "stopping" else 0.0
                    new_hours_stop = hours_stop + dt
                    new_hours_run = 0.0
            else:
                new_status = "starting"
                new_hours_in_state = hours_in_state + dt
                new_hours_stop = hours_stop + dt
                new_hours_run = 0.0
        elif status_now == "running":
            can_stop = bool(limits["can_stop"])
            want_stop = bool(stop_request or cmd <= 1e-12)
            max_fuel_kw = (
                float(limits["max_by_fuel_kw"])
                if "max_by_fuel_kw" in limits
                else (
                    float(c.rated_capacity_kw)
                    if fuel_remaining is None
                    else self.max_power_for_fuel_tons(fuel_remaining, dt)
                )
            )
            ramp_lo = max(min_kw, curr_kw - c.ramp_down_kw_per_hour * dt)
            ramp_hi = min(float(c.rated_capacity_kw), curr_kw + c.ramp_up_kw_per_hour * dt)

            if want_stop and can_stop:
                if c.shutdown_time_hours == 0.0 or dt >= c.shutdown_time_hours - 1e-12:
                    new_status = "off"
                    new_hours_in_state = 0.0
                else:
                    new_status = "stopping"
                    new_hours_in_state = dt
                new_hours_run = 0.0
                new_hours_stop = hours_stop + dt
            elif max_fuel_kw + 1e-12 < min_kw or (fuel_remaining is not None and max_fuel_kw + 1e-12 < ramp_lo):
                forced_stop = True
                note = "forced_stop: pasokan bahan bakar periode habis atau tidak cukup menahan ramp turun"
                new_status = "off"
                new_hours_in_state = 0.0
                new_hours_run = 0.0
                new_hours_stop = hours_stop + dt
            else:
                upper = min(ramp_hi, max_fuel_kw)
                lower = min(ramp_lo, upper)
                target = min(max(cmd, lower), upper)
                output_kw = max(target, min_kw)
                step_fuel_tons += self.fuel_tons_for_power_kw(output_kw, dt)
                new_status = "running"
                new_hours_in_state = hours_in_state + dt
                new_hours_run = hours_run + dt
                new_hours_stop = 0.0

        if output_kw > 0.0:
            total_op_hrs += dt
            hrs_since_oh += dt
            if c.overhaul_interval_operating_hours is not None and hrs_since_oh + 1e-12 >= c.overhaul_interval_operating_hours:
                overhaul_count += 1
                ev = LifecycleEvent(
                    year=current_year,
                    event_type="biomass_overhaul",
                    description=(
                        f"Overhaul Biomass ke-{overhaul_count} pada langkah {step_idx} tahun ke-{current_year} "
                        f"(jam operasi sejak overhaul mencapai {hrs_since_oh:.2f} jam)."
                    ),
                    cost_amount=float(c.overhaul_cost),
                )
                events.append(ev)
                self._recorded_events.append(ev)
                hrs_since_oh = 0.0

        fuel_period_used += step_fuel_tons
        fuel_total_used += step_fuel_tons
        step_co2e_kg = self._compute_emissions_kg(output_kw, step_fuel_tons, dt)
        co2e_total += step_co2e_kg
        fuel_energy_mj = self.fuel_energy_mj_for_power_kw(output_kw, dt)
        thermal_kw_th = self._compute_thermal_kw_th(output_kw, fuel_energy_mj, dt)

        step_fuel_cost = step_fuel_tons * fuel_params.fuel_price_per_ton
        step_logistics_cost = step_fuel_tons * fuel_params.logistics_cost_per_ton
        step_om_cost = output_kw * dt * c.variable_om_per_kwh

        state_out = {
            "status": new_status,
            "current_power_kw": float(output_kw),
            "hours_in_state": float(new_hours_in_state),
            "hours_running_continuous": float(new_hours_run),
            "hours_stopped_continuous": float(new_hours_stop),
            "total_operating_hours": float(total_op_hrs),
            "hours_since_overhaul": float(hrs_since_oh),
            "startup_count": startup_count,
            "overhaul_count": overhaul_count,
            "fuel_consumed_period_tons": float(fuel_period_used),
            "fuel_consumed_total_tons": float(fuel_total_used),
            "co2e_emitted_kg": float(co2e_total),
            "thermal_output_kw_th": float(thermal_kw_th),
            "current_period_key": limits["period_key"],
            "current_year": current_year,
            "events": events,
            "last_step_fuel_tons": float(step_fuel_tons),
            "last_step_co2e_kg": float(step_co2e_kg),
            "last_step_fuel_cost": float(step_fuel_cost),
            "last_step_logistics_cost": float(step_logistics_cost),
            "last_step_om_cost": float(step_om_cost),
            "last_step_startup_cost": float(step_startup_cost),
            "last_step_forced_stop": forced_stop,
            "last_step_note": note,
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
        """Mengembalikan daftar kejadian overhaul Biomass untuk tahun ke-`year`."""
        return [ev for ev in self._recorded_events if ev.year == year]


def biomass_config_to_dict(config: BiomassConfig) -> dict[str, Any]:
    """Mengonversi BiomassConfig menjadi kamus serializable JSON."""
    return asdict(config)
