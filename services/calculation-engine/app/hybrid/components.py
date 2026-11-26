"""Antarmuka komponen seragam dan model PV per jam tingkat PVWatts."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
import math
from typing import Any

import numpy as np

from app.errors import EngineError
from app.hybrid.weather import WeatherDataset


@dataclass(frozen=True)
class ComponentStepResult:
    """Keluaran satu langkah simulasi dari sebuah komponen energi."""

    available_kw: float
    generation_kw: float
    charge_kw: float
    discharge_kw: float
    losses_kw: float
    state_out: dict[str, Any]


@dataclass(frozen=True)
class LifecycleEvent:
    """Kejadian umur komponen (penggantian atau overhaul) untuk analisis tahunan."""

    year: int
    event_type: str
    description: str
    cost_amount: float


class EnergyComponent(ABC):
    """Kontrak dasar yang harus dipenuhi setiap komponen pada mesin hybrid."""

    @abstractmethod
    def validate(self) -> None:
        """Memeriksa validitas parameter komponen sebelum simulasi dimulai."""

    @abstractmethod
    def available_power_kw(
        self,
        step_idx: int,
        weather: WeatherDataset,
        state: dict[str, Any],
    ) -> float:
        """Mengembalikan daya maksimum (kW) yang tersedia dari komponen pada langkah ini."""

    @abstractmethod
    def step(
        self,
        step_idx: int,
        command_kw: float,
        weather: WeatherDataset,
        state: dict[str, Any],
    ) -> ComponentStepResult:
        """Menjalankan satu langkah simulasi dan mengembalikan aliran energi serta state baru."""

    @abstractmethod
    def lifecycle_events(self, year: int) -> list[LifecycleEvent]:
        """Mengembalikan daftar kejadian umur komponen pada tahun ke-`year`."""


@dataclass(frozen=True)
class PVWattsConfig:
    """Parameter konfigurasi model PV tingkat PVWatts untuk Tahap 1.

    Nilai default berasal dari asumsi sementara di docs/assumptions.md [REAL DATA].
    """

    capacity_kwp: float
    inverter_ac_kw: float
    tilt_degrees: float = 10.0
    azimuth_degrees: float = 0.0  # Konvensi PVGIS: 0 = Selatan, 90 = Barat, -90 = Timur, +-180 = Utara.
    system_loss_fraction: float = 0.14  # [REAL DATA] default rugi sistem PVGIS
    temp_coeff_per_c: float = -0.004  # [REAL DATA] koefisien suhu daya modul c-Si
    noct_c: float = 45.0  # [REAL DATA] Nominal Operating Cell Temperature
    inverter_efficiency: float = 0.96  # [REAL DATA] efisiensi konversi DC ke AC
    albedo: float = 0.2  # [REAL DATA] pantulan tanah standar


@dataclass(frozen=True)
class PVHourlyOutput:
    """Deret per jam tiap tahap konversi PV untuk perhitungan dan diagram rugi."""

    poa_w_m2: np.ndarray
    cell_temp_c: np.ndarray
    dc_nominal_kw: np.ndarray
    dc_after_temp_kw: np.ndarray
    dc_after_system_loss_kw: np.ndarray
    ac_before_clip_kw: np.ndarray
    ac_net_kw: np.ndarray
    loss_breakdown_kwh: dict[str, float]
    night_tare_kw: np.ndarray | None = None
    poa_beam_w_m2: np.ndarray | None = None
    poa_sky_w_m2: np.ndarray | None = None
    poa_ground_w_m2: np.ndarray | None = None


def _solar_geometry_cos_aoi(
    weather: WeatherDataset,
    tilt_degrees: float,
    azimuth_degrees: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Menghitung cos(zenith) dan cos(angle of incidence) secara vektorisasi.

    Konvensi azimuth mengikuti PVGIS (0 = Selatan, +90 = Barat, -90 = Timur, +-180 = Utara).
    """
    tc = weather.time_config
    day_num = tc.day_indices().astype(np.float64) + 1.0
    hours = tc.hour_of_day()

    # Persamaan Spencer (1971) untuk sudut deklinasi dan equation of time.
    b = 2.0 * math.pi * (day_num - 1.0) / 365.0
    eot_min = 229.18 * (
        0.000075
        + 0.001868 * np.cos(b)
        - 0.032077 * np.sin(b)
        - 0.014615 * np.cos(2.0 * b)
        - 0.04089 * np.sin(2.0 * b)
    )
    decl = (
        0.006918
        - 0.399912 * np.cos(b)
        + 0.070257 * np.sin(b)
        - 0.006758 * np.cos(2.0 * b)
        + 0.000907 * np.sin(2.0 * b)
        - 0.002697 * np.cos(3.0 * b)
        + 0.00148 * np.sin(3.0 * b)
    )

    std_meridian_deg = 15.0 * tc.utc_offset_hours
    time_offset_min = eot_min + 4.0 * (weather.metadata.longitude - std_meridian_deg)
    solar_time_hours = hours + time_offset_min / 60.0
    hour_angle = np.deg2rad(15.0 * (solar_time_hours - 12.0))

    lat = math.radians(weather.metadata.latitude)
    cos_z = np.sin(lat) * np.sin(decl) + np.cos(lat) * np.cos(decl) * np.cos(hour_angle)
    cos_z_clamped = np.clip(cos_z, -1.0, 1.0)
    sin_z = np.sqrt(np.maximum(1.0 - cos_z_clamped**2, 0.0))

    # Komponen vektor posisi matahari pada koordinat (Selatan, Barat, Atas).
    # Ketika azimuth = 0 (Selatan), s_south = sin(z)*cos(gamma_s) > 0 jika matahari di selatan.
    with np.errstate(divide="ignore", invalid="ignore"):
        cos_az_sun = np.where(
            sin_z > 1e-9,
            (np.sin(lat) * cos_z_clamped - np.sin(decl)) / (np.cos(lat) * sin_z)
            if abs(math.cos(lat)) > 1e-9
            else 0.0,
            0.0,
        )
    cos_az_sun = np.clip(cos_az_sun, -1.0, 1.0)
    sin_az_abs = np.sqrt(np.maximum(1.0 - cos_az_sun**2, 0.0))
    # Sore hari (hour_angle > 0) matahari di Barat (+), pagi hari di Timur (-).
    sun_az = np.where(hour_angle >= 0.0, np.arccos(cos_az_sun), -np.arccos(cos_az_sun))
    if abs(math.cos(lat)) <= 1e-9:
        sun_az = np.zeros_like(cos_z_clamped)
    _ = sin_az_abs

    tilt = math.radians(tilt_degrees)
    surf_az = math.radians(azimuth_degrees)
    cos_aoi = cos_z_clamped * math.cos(tilt) + sin_z * math.sin(tilt) * np.cos(sun_az - surf_az)
    return cos_z_clamped, cos_aoi


class PVWattsComponent(EnergyComponent):
    """Komponen PV per jam tingkat PVWatts untuk fondasi Tahap 1."""

    def __init__(self, config: PVWattsConfig):
        self.config = config
        self._cached_weather_id: int | None = None
        self._cached_output: PVHourlyOutput | None = None

    def validate(self) -> None:
        c = self.config
        if not math.isfinite(c.capacity_kwp) or c.capacity_kwp <= 0:
            raise EngineError("invalid_pv_config", "capacity_kwp harus lebih besar dari 0.")
        if not math.isfinite(c.inverter_ac_kw) or c.inverter_ac_kw <= 0:
            raise EngineError("invalid_pv_config", "inverter_ac_kw harus lebih besar dari 0.")
        if not 0.0 <= c.tilt_degrees <= 90.0:
            raise EngineError("invalid_pv_config", "tilt_degrees harus berada antara 0 dan 90.")
        if not -180.0 <= c.azimuth_degrees <= 180.0:
            raise EngineError("invalid_pv_config", "azimuth_degrees harus berada antara -180 dan 180.")
        if not 0.0 <= c.system_loss_fraction < 1.0:
            raise EngineError("invalid_pv_config", "system_loss_fraction harus antara 0 dan kurang dari 1.")
        if not -0.02 <= c.temp_coeff_per_c <= 0.0:
            raise EngineError("invalid_pv_config", "temp_coeff_per_c harus berada antara -0.02 dan 0.")
        if not 20.0 <= c.noct_c <= 70.0:
            raise EngineError("invalid_pv_config", "noct_c harus berada antara 20 dan 70 C.")
        if not 0.0 < c.inverter_efficiency <= 1.0:
            raise EngineError("invalid_pv_config", "inverter_efficiency harus lebih dari 0 hingga 1.")
        if not 0.0 <= c.albedo <= 1.0:
            raise EngineError("invalid_pv_config", "albedo harus berada antara 0 dan 1.")

    def compute_hourly(self, weather: WeatherDataset) -> PVHourlyOutput:
        """Menghitung potensi dan rugi tiap tahap PV secara vektorisasi untuk seluruh tahun."""
        self.validate()
        c = self.config
        step_hours = weather.time_config.step_hours

        cos_z, cos_aoi = _solar_geometry_cos_aoi(weather, c.tilt_degrees, c.azimuth_degrees)
        # Batasi proyeksi beam pada sudut zenith < 87.5 derajat untuk mencegah nilai semu di ufuk.
        sun_up = cos_z > math.cos(math.radians(87.5))
        daytime = (weather.ghi_w_m2 > 0.0) | (weather.dni_w_m2 > 0.0) | (weather.dhi_w_m2 > 0.0)

        tilt_rad = math.radians(c.tilt_degrees)
        vf_sky = 0.5 * (1.0 + math.cos(tilt_rad))
        vf_ground = 0.5 * (1.0 - math.cos(tilt_rad))

        poa_beam = np.where(sun_up, weather.dni_w_m2 * np.maximum(cos_aoi, 0.0), 0.0)
        poa_sky = np.where(daytime, weather.dhi_w_m2 * vf_sky, 0.0)
        poa_ground = np.where(daytime, weather.ghi_w_m2 * c.albedo * vf_ground, 0.0)
        poa = np.maximum(poa_beam + poa_sky + poa_ground, 0.0)

        cell_temp_c = weather.temp_air_c + ((c.noct_c - 20.0) / 800.0) * poa
        dc_nominal_kw = c.capacity_kwp * (poa / 1000.0)

        temp_factor = np.maximum(1.0 + c.temp_coeff_per_c * (cell_temp_c - 25.0), 0.0)
        dc_after_temp_kw = dc_nominal_kw * temp_factor
        dc_after_system_loss_kw = dc_after_temp_kw * (1.0 - c.system_loss_fraction)

        ac_before_clip_kw = dc_after_system_loss_kw * c.inverter_efficiency
        ac_net_kw = np.minimum(ac_before_clip_kw, c.inverter_ac_kw)

        loss_breakdown_kwh = {
            "dc_nominal_kwh": float(np.sum(dc_nominal_kw) * step_hours),
            "temperature_loss_kwh": float(np.sum(dc_nominal_kw - dc_after_temp_kw) * step_hours),
            "system_loss_kwh": float(np.sum(dc_after_temp_kw - dc_after_system_loss_kw) * step_hours),
            "inverter_loss_kwh": float(np.sum(dc_after_system_loss_kw - ac_before_clip_kw) * step_hours),
            "clipping_loss_kwh": float(np.sum(ac_before_clip_kw - ac_net_kw) * step_hours),
            "ac_net_kwh": float(np.sum(ac_net_kw) * step_hours),
        }

        output = PVHourlyOutput(
            poa_w_m2=poa,
            cell_temp_c=cell_temp_c,
            dc_nominal_kw=dc_nominal_kw,
            dc_after_temp_kw=dc_after_temp_kw,
            dc_after_system_loss_kw=dc_after_system_loss_kw,
            ac_before_clip_kw=ac_before_clip_kw,
            ac_net_kw=ac_net_kw,
            loss_breakdown_kwh=loss_breakdown_kwh,
        )
        self._cached_weather_id = id(weather)
        self._cached_output = output
        return output

    def prepare(self, weather: WeatherDataset) -> PVHourlyOutput:
        """Memastikan deret vektor potensi PV sudah dihitung dan di-cache."""
        if self._cached_weather_id == id(weather) and self._cached_output is not None:
            return self._cached_output
        return self.compute_hourly(weather)

    def set_precomputed_output(self, weather: WeatherDataset, output: PVHourlyOutput) -> PVHourlyOutput:
        """Menyematkan hasil PVHourlyOutput yang sudah dihitung sebelumnya untuk cuaca yang sama."""
        self.validate()
        self._cached_weather_id = id(weather)
        self._cached_output = output
        return output

    def available_power_kw(
        self,
        step_idx: int,
        weather: WeatherDataset,
        state: dict[str, Any],
    ) -> float:
        output = self.prepare(weather)
        return float(output.ac_net_kw[step_idx])

    def night_tare_power_kw(self, step_idx: int, weather: WeatherDataset) -> float:
        """Mengembalikan konsumsi malam inverter (0.0 kW pada model PVWatts Tahap 1)."""
        _ = step_idx, weather
        return 0.0

    def step(
        self,
        step_idx: int,
        command_kw: float,
        weather: WeatherDataset,
        state: dict[str, Any],
    ) -> ComponentStepResult:
        output = self.prepare(weather)
        available = float(output.ac_net_kw[step_idx])
        target = min(max(float(command_kw), 0.0), available)
        # Rugi internal PV tercatat di loss_breakdown_kwh; selisih command terhadap available
        # adalah curtailment sistem yang dicatat oleh simulator neraca daya.
        return ComponentStepResult(
            available_kw=available,
            generation_kw=available,
            charge_kw=0.0,
            discharge_kw=0.0,
            losses_kw=0.0,
            state_out={"dispatched_kw": target},
        )

    def lifecycle_events(self, year: int) -> list[LifecycleEvent]:
        return []
