"""Adapter penyedia data lokasi untuk NASA POWER (Prediction Of Worldwide Energy Resources).

Dokumentasi resmi API NASA POWER:
https://power.larc.nasa.gov/docs/services/api/
Parameter yang dipakai: ALLSKY_SFC_SW_DWN (Global Horizontal Irradiance).
Dibaca pada: 2026-11-26.
"""

from datetime import datetime, timezone
import math
import time

import httpx

from app.providers.base import (
    ResourceError,
    ResourceErrorKind,
    ResourceProvider,
    ResourceResult,
)

NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
NASA_DATASET_VERSION = "POWER v2"
_ASSUMED_PR = 0.75  # Performance Ratio tipikal untuk sistem PV
_RETRYABLE_STATUS_CODES = {429, 502, 503, 504, 529}


class NASAProvider(ResourceProvider):
    """Mengambil estimasi specific yield PV dari data radiasi NASA POWER."""

    def __init__(
        self,
        performance_ratio: float = _ASSUMED_PR,
        timeout_seconds: float = 15.0,
        max_retries: int = 2,
        cache_ttl_seconds: float = 3600.0,
        client: httpx.Client | None = None,
    ):
        if not 0 < performance_ratio <= 1:
            raise ValueError("performance_ratio harus di antara 0 dan 1.")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds harus lebih besar dari 0.")

        self._performance_ratio = performance_ratio
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._cache_ttl_seconds = cache_ttl_seconds
        self._client = client
        self._cache: dict[tuple[float, float], tuple[float, ResourceResult]] = {}

    def get_resource(
        self,
        latitude: float,
        longitude: float,
        tilt_degrees: float,
        azimuth_degrees: float,
    ) -> ResourceResult:
        cache_key = (round(latitude, 5), round(longitude, 5))
        now = time.monotonic()
        if self._cache_ttl_seconds > 0 and cache_key in self._cache:
            expires_at, cached_result = self._cache[cache_key]
            if now < expires_at:
                return cached_result
            del self._cache[cache_key]

        # Gunakan periode 1 tahun penuh (2023) untuk rata-rata tahunan.
        params = {
            "parameters": "ALLSKY_SFC_SW_DWN",
            "community": "RE",
            "longitude": longitude,
            "latitude": latitude,
            "start": "20230101",
            "end": "20231231",
            "format": "JSON",
        }

        payload = self._fetch_with_retries(params)
        result = self._parse_response(payload)

        if self._cache_ttl_seconds > 0:
            self._cache[cache_key] = (time.monotonic() + self._cache_ttl_seconds, result)

        return result

    def _fetch_with_retries(self, params: dict[str, float | int | str]) -> dict:
        last_error: ResourceError | None = None
        for attempt in range(self._max_retries + 1):
            try:
                response = self._request_once(params)
            except httpx.TimeoutException as exc:
                last_error = ResourceError(
                    ResourceErrorKind.TIMEOUT,
                    f"Batas waktu permintaan ke NASA POWER ({self._timeout_seconds} detik) terlampaui.",
                )
                if attempt < self._max_retries:
                    continue
                raise last_error from exc
            except httpx.RequestError as exc:
                last_error = ResourceError(
                    ResourceErrorKind.UNAVAILABLE,
                    "Gagal menghubungi layanan NASA POWER.",
                )
                if attempt < self._max_retries:
                    continue
                raise last_error from exc

            if response.status_code == 200:
                data = response.json()
                if not isinstance(data, dict) or "properties" not in data:
                    raise ResourceError(
                        ResourceErrorKind.INVALID_RESPONSE,
                        "Struktur JSON NASA POWER tidak sesuai harapan.",
                    )
                return data

            if response.status_code in _RETRYABLE_STATUS_CODES:
                last_error = ResourceError(
                    ResourceErrorKind.UNAVAILABLE,
                    f"Layanan NASA POWER sementara tidak tersedia (HTTP {response.status_code}).",
                )
                if attempt < self._max_retries:
                    continue
                raise last_error

            raise ResourceError(
                ResourceErrorKind.INVALID_RESPONSE,
                f"Status HTTP tidak terduga dari NASA POWER: {response.status_code}.",
            )

        assert last_error is not None
        raise last_error

    def _request_once(self, params: dict[str, float | int | str]) -> httpx.Response:
        if self._client is not None:
            return self._client.get(NASA_POWER_URL, params=params, timeout=self._timeout_seconds)
        with httpx.Client(timeout=self._timeout_seconds) as client:
            return client.get(NASA_POWER_URL, params=params)

    def _parse_response(self, payload: dict) -> ResourceResult:
        try:
            # Data harian ada di properties.parameter.ALLSKY_SFC_SW_DWN
            ghi_values = payload["properties"]["parameter"]["ALLSKY_SFC_SW_DWN"]
        except (KeyError, TypeError) as exc:
            raise ResourceError(
                ResourceErrorKind.INVALID_RESPONSE,
                "Field ALLSKY_SFC_SW_DWN tidak ditemukan pada respons NASA POWER.",
            ) from exc

        # Filter nilai yang valid (bukan -999.0 yang menandakan data hilang)
        valid_values = [v for v in ghi_values.values() if isinstance(v, (int, float)) and v > -900]
        if not valid_values:
            raise ResourceError(
                ResourceErrorKind.INVALID_RESPONSE,
                "Tidak ada nilai radiasi yang valid dari NASA POWER.",
            )

        # Rata-rata GHI harian dalam kWh/m2/day
        avg_daily_ghi = sum(valid_values) / len(valid_values)
        if not math.isfinite(avg_daily_ghi) or avg_daily_ghi <= 0:
            raise ResourceError(
                ResourceErrorKind.INVALID_RESPONSE,
                "Rata-rata radiasi dari NASA POWER tidak valid.",
            )

        # Konversi ke specific yield tahunan (kWh/kWp/tahun)
        # GHI tahunan = avg_daily_ghi * 365 (kWh/m2/tahun)
        # Specific yield = GHI tahunan * PR (kWh/kWp/tahun)
        specific_yield = avg_daily_ghi * 365 * self._performance_ratio

        return ResourceResult(
            specific_yield_kwh_per_kwp_year=round(specific_yield, 2),
            yield_boundary="net_ac_at_delivery",
            provider_name="nasa",
            dataset="NASA POWER",
            dataset_version=NASA_DATASET_VERSION,
            period="2023",
            retrieval_timestamp=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
