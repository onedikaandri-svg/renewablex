"""Penyedia sederhana yang meneruskan yield spesifik dari pengguna.

ManualProvider tidak memanggil layanan luar. Ia membungkus nilai yang
dimasukkan pengguna ke dalam ResourceResult agar alur kode di mesin hitung
seragam untuk semua metode energi.
"""

from datetime import datetime, timezone

from app.providers.base import ResourceProvider, ResourceResult


class ManualProvider(ResourceProvider):
    """Meneruskan yield spesifik yang dimasukkan pengguna secara manual."""

    def __init__(
        self,
        specific_yield: float,
        yield_boundary: str,
    ):
        self._yield = specific_yield
        self._boundary = yield_boundary

    def get_resource(
        self,
        latitude: float,
        longitude: float,
        tilt_degrees: float,
        azimuth_degrees: float,
    ) -> ResourceResult:
        return ResourceResult(
            specific_yield_kwh_per_kwp_year=self._yield,
            yield_boundary=self._boundary,
            provider_name="manual",
            dataset=None,
            dataset_version=None,
            period=None,
            retrieval_timestamp=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
