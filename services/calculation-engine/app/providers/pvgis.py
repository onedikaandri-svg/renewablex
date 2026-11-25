"""Adapter penyedia data lokasi untuk PVGIS (Joint Research Centre, Komisi Eropa).

Dokumentasi resmi API PVGIS 5 non-interaktif:
https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en
Dibaca pada: 2026-11-25.
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

PVGIS_PVCALC_URL = "https://re.jrc.ec.europa.eu/api/v5_3/PVcalc"
PVGIS_DATASET_VERSION = "v5_3"
_RETRYABLE_STATUS_CODES = {429, 502, 503, 504, 529}


class PVGISProvider(ResourceProvider):
    """Mengambil estimasi specific yield PV dari API PVGIS v5.3 (PVcalc)."""

    def __init__(
        self,
        loss_percent: float = 14.0,
        timeout_seconds: float = 10.0,
        max_retries: int = 2,
        cache_ttl_seconds: float = 3600.0,
        client: httpx.Client | None = None,
    ):
        if not 0 <= loss_percent < 100:
            raise ValueError("loss_percent harus berada di antara 0 dan kurang dari 100.")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds harus lebih besar dari 0.")
        if max_retries < 0:
            raise ValueError("max_retries tidak boleh negatif.")
        if cache_ttl_seconds < 0:
            raise ValueError("cache_ttl_seconds tidak boleh negatif.")

        self._loss_percent = loss_percent
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._cache_ttl_seconds = cache_ttl_seconds
        self._client = client
        self._cache: dict[tuple[float, float, float, float, float], tuple[float, ResourceResult]] = {}

    def get_resource(
        self,
        latitude: float,
        longitude: float,
        tilt_degrees: float,
        azimuth_degrees: float,
    ) -> ResourceResult:
        cache_key = (
            round(latitude, 5),
            round(longitude, 5),
            round(tilt_degrees, 2),
            round(azimuth_degrees, 2),
            round(self._loss_percent, 2),
        )
        now = time.monotonic()
        if self._cache_ttl_seconds > 0 and cache_key in self._cache:
            expires_at, cached_result = self._cache[cache_key]
            if now < expires_at:
                return cached_result
            del self._cache[cache_key]

        params = {
            "lat": latitude,
            "lon": longitude,
            "peakpower": 1,
            "loss": self._loss_percent,
            "angle": tilt_degrees,
            "aspect": azimuth_degrees,
            "outputformat": "json",
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
                    f"Batas waktu permintaan ke PVGIS ({self._timeout_seconds} detik) terlampaui.",
                )
                if attempt < self._max_retries:
                    continue
                raise last_error from exc
            except httpx.RequestError as exc:
                last_error = ResourceError(
                    ResourceErrorKind.UNAVAILABLE,
                    "Gagal menghubungi layanan PVGIS.",
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
                        "Respons PVGIS bukan JSON yang valid.",
                    ) from exc
                if not isinstance(data, dict):
                    raise ResourceError(
                        ResourceErrorKind.INVALID_RESPONSE,
                        "Struktur JSON PVGIS tidak sesuai harapan.",
                    )
                return data

            if response.status_code == 400:
                raise self._map_400_error(response)

            if response.status_code in _RETRYABLE_STATUS_CODES:
                last_error = ResourceError(
                    ResourceErrorKind.UNAVAILABLE,
                    f"Layanan PVGIS sementara tidak tersedia (HTTP {response.status_code}).",
                )
                if attempt < self._max_retries:
                    continue
                raise last_error

            if 500 <= response.status_code < 600:
                raise ResourceError(
                    ResourceErrorKind.UNAVAILABLE,
                    f"Layanan PVGIS mengalami gangguan server (HTTP {response.status_code}).",
                )

            raise ResourceError(
                ResourceErrorKind.INVALID_RESPONSE,
                f"Status HTTP tidak terduga dari PVGIS: {response.status_code}.",
            )

        assert last_error is not None
        raise last_error

    def _request_once(self, params: dict[str, float | int | str]) -> httpx.Response:
        if self._client is not None:
            return self._client.get(PVGIS_PVCALC_URL, params=params, timeout=self._timeout_seconds)
        with httpx.Client(timeout=self._timeout_seconds) as client:
            return client.get(PVGIS_PVCALC_URL, params=params)

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
                f"Lokasi di luar cakupan data PVGIS: {message}".strip(),
            )
        return ResourceError(
            ResourceErrorKind.INVALID_RESPONSE,
            f"Permintaan ditolak oleh PVGIS (HTTP 400): {message}".strip(),
        )

    @staticmethod
    def _parse_response(payload: dict) -> ResourceResult:
        try:
            e_y = payload["outputs"]["totals"]["fixed"]["E_y"]
        except (KeyError, TypeError) as exc:
            raise ResourceError(
                ResourceErrorKind.INVALID_RESPONSE,
                "Field outputs.totals.fixed.E_y tidak ditemukan pada respons PVGIS.",
            ) from exc

        if not isinstance(e_y, (int, float)) or isinstance(e_y, bool) or not math.isfinite(e_y) or e_y <= 0:
            raise ResourceError(
                ResourceErrorKind.INVALID_RESPONSE,
                "Nilai E_y dari PVGIS tidak valid atau bukan angka positif yang terhingga.",
            )

        meteo = payload.get("inputs", {}).get("meteo_data", {})
        if not isinstance(meteo, dict):
            meteo = {}

        radiation_db = meteo.get("radiation_db")
        dataset = str(radiation_db) if radiation_db else None

        year_min = meteo.get("year_min")
        year_max = meteo.get("year_max")
        period = f"{year_min}-{year_max}" if year_min is not None and year_max is not None else None

        return ResourceResult(
            specific_yield_kwh_per_kwp_year=float(e_y),
            yield_boundary="net_ac_at_delivery",
            provider_name="pvgis",
            dataset=dataset,
            dataset_version=PVGIS_DATASET_VERSION,
            period=period,
            retrieval_timestamp=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
