"""Adaptor dan struktur data cuaca per jam untuk simulasi hybrid."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import time
from typing import Any

import httpx
import numpy as np

from app.errors import EngineError
from app.hybrid.time_grid import TimeConfig
from app.providers.base import ResourceError, ResourceErrorKind

PVGIS_TMY_URL = "https://re.jrc.ec.europa.eu/api/v5_3/tmy"
PVGIS_DATASET_VERSION = "v5_3"
_RETRYABLE_STATUS_CODES = {429, 502, 503, 504, 529}


@dataclass(frozen=True)
class WeatherMetadata:
    """Metadata asal data cuaca untuk keterlacakan hasil simulasi."""

    provider: str
    dataset: str | None
    dataset_version: str | None
    period: str | None
    latitude: float
    longitude: float
    elevation_m: float | None
    timezone: str
    timezone_offset_hours: float
    retrieved_at: str


@dataclass(frozen=True)
class WeatherDataset:
    """Deret cuaca tervalidasi pada zona waktu lokal proyek."""

    ghi_w_m2: np.ndarray
    dni_w_m2: np.ndarray
    dhi_w_m2: np.ndarray
    temp_air_c: np.ndarray
    wind_speed_m_s: np.ndarray
    time_config: TimeConfig
    metadata: WeatherMetadata

    def __post_init__(self) -> None:
        expected = self.time_config.steps_per_year
        arrays = {
            "ghi_w_m2": self.ghi_w_m2,
            "dni_w_m2": self.dni_w_m2,
            "dhi_w_m2": self.dhi_w_m2,
            "temp_air_c": self.temp_air_c,
            "wind_speed_m_s": self.wind_speed_m_s,
        }
        for name, arr in arrays.items():
            if not isinstance(arr, np.ndarray) or arr.ndim != 1 or len(arr) != expected:
                raise EngineError(
                    "invalid_weather_length",
                    f"Deret {name} harus berdimensi 1 dengan panjang {expected}.",
                )
            if not np.all(np.isfinite(arr)):
                raise EngineError(
                    "non_finite_weather_value",
                    f"Deret {name} mengandung nilai tidak terhingga atau NaN.",
                )

        for name in ("ghi_w_m2", "dni_w_m2", "dhi_w_m2", "wind_speed_m_s"):
            if np.any(arrays[name] < 0):
                raise EngineError(
                    "negative_weather_value",
                    f"Deret {name} tidak boleh mengandung nilai negatif.",
                )


def shift_utc_to_local(values: np.ndarray, offset_hours: float, step_minutes: int) -> np.ndarray:
    """Menggeser deret UTC secara siklik ke waktu lokal lokasi proyek."""
    shift_steps = int(round(offset_hours * 60.0 / step_minutes))
    return np.roll(values, shift_steps)


class WeatherProvider(ABC):
    """Antarmuka penyedia deret cuaca per langkah waktu."""

    @abstractmethod
    def get_weather(
        self,
        latitude: float,
        longitude: float,
        time_config: TimeConfig,
    ) -> WeatherDataset:
        """Mengambil dan menormalisasi data cuaca untuk lokasi dan konfigurasi waktu."""


def _validate_coordinates(latitude: float, longitude: float) -> None:
    if not -90.0 <= latitude <= 90.0:
        raise EngineError("invalid_latitude", "Latitude harus berada antara -90 dan 90.")
    if not -180.0 <= longitude <= 180.0:
        raise EngineError("invalid_longitude", "Longitude harus berada antara -180 dan 180.")


def _clean_non_negative_series(raw_values: list[Any], field_name: str) -> np.ndarray:
    try:
        arr = np.array([float(v) for v in raw_values], dtype=np.float64)
    except (TypeError, ValueError) as exc:
        raise ResourceError(
            ResourceErrorKind.INVALID_RESPONSE,
            f"Nilai {field_name} tidak dapat diubah ke angka.",
        ) from exc

    if not np.all(np.isfinite(arr)):
        raise ResourceError(
            ResourceErrorKind.INVALID_RESPONSE,
            f"Nilai {field_name} mengandung angka tidak terhingga atau NaN.",
        )
    # Nilai negatif ekstrem (misalnya -999 sebagai sentinel hilang) harus ditolak.
    if np.any(arr < -10.0):
        raise ResourceError(
            ResourceErrorKind.INVALID_RESPONSE,
            f"Nilai {field_name} mengandung penanda data hilang atau nilai negatif tidak wajar.",
        )
    return np.maximum(arr, 0.0)


def _clean_temperature_series(raw_values: list[Any]) -> np.ndarray:
    try:
        arr = np.array([float(v) for v in raw_values], dtype=np.float64)
    except (TypeError, ValueError) as exc:
        raise ResourceError(
            ResourceErrorKind.INVALID_RESPONSE,
            "Nilai T2m tidak dapat diubah ke angka.",
        ) from exc

    if not np.all(np.isfinite(arr)) or np.any(arr < -90.0) or np.any(arr > 70.0):
        raise ResourceError(
            ResourceErrorKind.INVALID_RESPONSE,
            "Nilai suhu udara T2m di luar rentang fisik wajar.",
        )
    return arr


class PVGISTMYWeatherProvider(WeatherProvider):
    """Mengambil data cuaca per jam TMY (8760 jam) dari API PVGIS v5.3."""

    def __init__(
        self,
        timeout_seconds: float = 15.0,
        max_retries: int = 2,
        cache_ttl_seconds: float = 3600.0,
        client: httpx.Client | None = None,
    ):
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds harus lebih besar dari 0.")
        if max_retries < 0:
            raise ValueError("max_retries tidak boleh negatif.")
        if cache_ttl_seconds < 0:
            raise ValueError("cache_ttl_seconds tidak boleh negatif.")

        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._cache_ttl_seconds = cache_ttl_seconds
        self._client = client
        self._cache: dict[tuple[float, float, int, str], tuple[float, WeatherDataset]] = {}

    def get_weather(
        self,
        latitude: float,
        longitude: float,
        time_config: TimeConfig,
    ) -> WeatherDataset:
        _validate_coordinates(latitude, longitude)
        if time_config.step_minutes != 60:
            raise EngineError(
                "unsupported_step_minutes",
                "PVGISTMYWeatherProvider saat ini hanya mendukung step_minutes = 60.",
            )

        cache_key = (
            round(latitude, 5),
            round(longitude, 5),
            time_config.step_minutes,
            time_config.timezone,
        )
        now = time.monotonic()
        if self._cache_ttl_seconds > 0 and cache_key in self._cache:
            expires_at, cached = self._cache[cache_key]
            if now < expires_at:
                return cached
            del self._cache[cache_key]

        params = {
            "lat": latitude,
            "lon": longitude,
            "outputformat": "json",
        }
        payload = self._fetch_with_retries(params)
        dataset = self._parse_pvgis_tmy_payload(payload, latitude, longitude, time_config)

        if self._cache_ttl_seconds > 0:
            self._cache[cache_key] = (time.monotonic() + self._cache_ttl_seconds, dataset)

        return dataset

    def _fetch_with_retries(self, params: dict[str, float | str]) -> dict[str, Any]:
        last_error: ResourceError | None = None
        for attempt in range(self._max_retries + 1):
            try:
                response = self._request_once(params)
            except httpx.TimeoutException as exc:
                last_error = ResourceError(
                    ResourceErrorKind.TIMEOUT,
                    f"Batas waktu permintaan ke PVGIS TMY ({self._timeout_seconds} detik) terlampaui.",
                )
                if attempt < self._max_retries:
                    continue
                raise last_error from exc
            except httpx.RequestError as exc:
                last_error = ResourceError(
                    ResourceErrorKind.UNAVAILABLE,
                    "Gagal menghubungi layanan PVGIS TMY.",
                )
                if attempt < self._max_retries:
                    continue
                raise last_error from exc

            if response.status_code == 200:
                try:
                    data = response.json()
                except ValueError as exc:
                    raise ResourceError(
                        ResourceErrorKind.INVALID_RESPONSE,
                        "Respons PVGIS TMY bukan JSON yang valid.",
                    ) from exc
                if not isinstance(data, dict):
                    raise ResourceError(
                        ResourceErrorKind.INVALID_RESPONSE,
                        "Struktur JSON PVGIS TMY tidak sesuai harapan.",
                    )
                return data

            if response.status_code == 400:
                raise self._map_400_error(response)

            if response.status_code in _RETRYABLE_STATUS_CODES:
                last_error = ResourceError(
                    ResourceErrorKind.UNAVAILABLE,
                    f"Layanan PVGIS TMY sementara tidak tersedia (HTTP {response.status_code}).",
                )
                if attempt < self._max_retries:
                    continue
                raise last_error

            if 500 <= response.status_code < 600:
                raise ResourceError(
                    ResourceErrorKind.UNAVAILABLE,
                    f"Layanan PVGIS TMY mengalami gangguan server (HTTP {response.status_code}).",
                )

            raise ResourceError(
                ResourceErrorKind.INVALID_RESPONSE,
                f"Status HTTP tidak terduga dari PVGIS TMY: {response.status_code}.",
            )

        assert last_error is not None
        raise last_error

    def _request_once(self, params: dict[str, float | str]) -> httpx.Response:
        if self._client is not None:
            return self._client.get(PVGIS_TMY_URL, params=params, timeout=self._timeout_seconds)
        with httpx.Client(timeout=self._timeout_seconds) as client:
            return client.get(PVGIS_TMY_URL, params=params)

    @staticmethod
    def _map_400_error(response: httpx.Response) -> ResourceError:
        message = ""
        try:
            body = response.json()
            if isinstance(body, dict):
                message = str(body.get("message", ""))
        except ValueError:
            message = response.text

        lowered = message.lower()
        coverage_markers = ("over the sea", "coverage", "outside", "out of range")
        if any(marker in lowered for marker in coverage_markers):
            return ResourceError(
                ResourceErrorKind.OUT_OF_COVERAGE,
                f"Lokasi di luar cakupan data PVGIS TMY: {message}".strip(),
            )
        return ResourceError(
            ResourceErrorKind.INVALID_RESPONSE,
            f"Permintaan ditolak oleh PVGIS TMY (HTTP 400): {message}".strip(),
        )

    @staticmethod
    def _parse_pvgis_tmy_payload(
        payload: dict[str, Any],
        latitude: float,
        longitude: float,
        time_config: TimeConfig,
    ) -> WeatherDataset:
        try:
            hourly = payload["outputs"]["tmy_hourly"]
        except (KeyError, TypeError) as exc:
            raise ResourceError(
                ResourceErrorKind.INVALID_RESPONSE,
                "Field outputs.tmy_hourly tidak ditemukan pada respons PVGIS TMY.",
            ) from exc

        expected = time_config.steps_per_year
        if not isinstance(hourly, list) or len(hourly) != expected:
            raise ResourceError(
                ResourceErrorKind.INVALID_RESPONSE,
                f"Data PVGIS TMY harus berisi {expected} baris per jam.",
            )

        try:
            ghi_utc = _clean_non_negative_series([row["G(h)"] for row in hourly], "G(h)")
            dni_utc = _clean_non_negative_series([row["Gb(n)"] for row in hourly], "Gb(n)")
            dhi_utc = _clean_non_negative_series([row["Gd(h)"] for row in hourly], "Gd(h)")
            temp_utc = _clean_temperature_series([row["T2m"] for row in hourly])
            ws_utc = _clean_non_negative_series([row["WS10m"] for row in hourly], "WS10m")
        except KeyError as exc:
            raise ResourceError(
                ResourceErrorKind.INVALID_RESPONSE,
                f"Kolom wajib {exc} tidak ditemukan pada baris tmy_hourly PVGIS.",
            ) from exc

        offset_hours = time_config.utc_offset_hours
        ghi = shift_utc_to_local(ghi_utc, offset_hours, time_config.step_minutes)
        dni = shift_utc_to_local(dni_utc, offset_hours, time_config.step_minutes)
        dhi = shift_utc_to_local(dhi_utc, offset_hours, time_config.step_minutes)
        temp_air = shift_utc_to_local(temp_utc, offset_hours, time_config.step_minutes)
        wind_speed = shift_utc_to_local(ws_utc, offset_hours, time_config.step_minutes)

        inputs = payload.get("inputs") or {}
        meteo = inputs.get("meteo_data") if isinstance(inputs, dict) else {}
        location = inputs.get("location") if isinstance(inputs, dict) else {}
        months_sel = payload.get("outputs", {}).get("months_selected")

        dataset_name = None
        if isinstance(meteo, dict) and meteo.get("radiation_db"):
            dataset_name = str(meteo["radiation_db"])

        elevation_m = None
        if isinstance(location, dict) and location.get("elevation") is not None:
            elevation_m = float(location["elevation"])

        period = None
        if isinstance(months_sel, list) and months_sel:
            years = [int(m["year"]) for m in months_sel if isinstance(m, dict) and "year" in m]
            if years:
                period = f"{min(years)}-{max(years)} TMY"

        metadata = WeatherMetadata(
            provider="pvgis_tmy",
            dataset=dataset_name or "PVGIS-ERA5",
            dataset_version=PVGIS_DATASET_VERSION,
            period=period,
            latitude=latitude,
            longitude=longitude,
            elevation_m=elevation_m,
            timezone=time_config.timezone,
            timezone_offset_hours=offset_hours,
            retrieved_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        return WeatherDataset(
            ghi_w_m2=ghi,
            dni_w_m2=dni,
            dhi_w_m2=dhi,
            temp_air_c=temp_air,
            wind_speed_m_s=wind_speed,
            time_config=time_config,
            metadata=metadata,
        )


def load_weather_from_json(source: Path | str | dict[str, Any], time_config: TimeConfig) -> WeatherDataset:
    """Membaca data cuaca lokal dari file JSON atau dict (format PVGIS TMY atau ternormalisasi)."""
    if isinstance(source, dict):
        payload = source
    else:
        path = Path(source)
        payload = json.loads(path.read_text(encoding="utf-8"))

    if not isinstance(payload, dict):
        raise EngineError("invalid_weather_json", "Berkas JSON cuaca harus berupa objek.")

    # Format 1: langsung berisi respons PVGIS TMY (outputs.tmy_hourly).
    if "outputs" in payload and isinstance(payload["outputs"], dict) and "tmy_hourly" in payload["outputs"]:
        loc = payload.get("inputs", {}).get("location", {})
        lat = float(loc.get("latitude", 0.0))
        lon = float(loc.get("longitude", 0.0))
        return PVGISTMYWeatherProvider._parse_pvgis_tmy_payload(payload, lat, lon, time_config)

    # Format 2: format ternormalisasi lokal (sudah dalam waktu lokal proyek).
    meta_raw = payload.get("metadata") or {}
    hourly_raw = payload.get("hourly") or {}
    required = ("ghi_w_m2", "dni_w_m2", "dhi_w_m2", "temp_air_c", "wind_speed_m_s")
    for key in required:
        if key not in hourly_raw or not isinstance(hourly_raw[key], list):
            raise EngineError("invalid_weather_json", f"Field hourly.{key} wajib berupa daftar angka.")

    metadata = WeatherMetadata(
        provider=str(meta_raw.get("provider", "local_json")),
        dataset=meta_raw.get("dataset"),
        dataset_version=meta_raw.get("dataset_version"),
        period=meta_raw.get("period"),
        latitude=float(meta_raw.get("latitude", 0.0)),
        longitude=float(meta_raw.get("longitude", 0.0)),
        elevation_m=None if meta_raw.get("elevation_m") is None else float(meta_raw["elevation_m"]),
        timezone=time_config.timezone,
        timezone_offset_hours=time_config.utc_offset_hours,
        retrieved_at=str(meta_raw.get("retrieved_at", "local")),
    )

    return WeatherDataset(
        ghi_w_m2=np.array(hourly_raw["ghi_w_m2"], dtype=np.float64),
        dni_w_m2=np.array(hourly_raw["dni_w_m2"], dtype=np.float64),
        dhi_w_m2=np.array(hourly_raw["dhi_w_m2"], dtype=np.float64),
        temp_air_c=np.array(hourly_raw["temp_air_c"], dtype=np.float64),
        wind_speed_m_s=np.array(hourly_raw["wind_speed_m_s"], dtype=np.float64),
        time_config=time_config,
        metadata=metadata,
    )
