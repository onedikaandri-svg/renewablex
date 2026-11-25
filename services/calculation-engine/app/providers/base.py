"""Antarmuka dan tipe data untuk penyedia sumber daya surya.

Setiap penyedia (PVGIS, manual, dsb.) mengimplementasikan ResourceProvider
dan mengembalikan ResourceResult yang berisi yield spesifik beserta metadata
asal data. Kesalahan dikirim lewat ResourceError yang bertipe, bukan teks mentah.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Literal


class ResourceErrorKind(Enum):
    """Jenis kesalahan yang mungkin terjadi saat mengambil data sumber daya."""

    UNAVAILABLE = "unavailable"
    OUT_OF_COVERAGE = "out_of_coverage"
    INVALID_RESPONSE = "invalid_response"
    TIMEOUT = "timeout"


class ResourceError(Exception):
    """Kesalahan bertipe dari penyedia data lokasi.

    Kode mesin bercabang pada ``kind``, bukan pada teks pesan.
    """

    def __init__(self, kind: ResourceErrorKind, message: str):
        super().__init__(message)
        self.kind = kind


@dataclass(frozen=True)
class ResourceResult:
    """Hasil dari penyedia data sumber daya surya.

    Field metadata (provider_name sampai retrieval_timestamp) bisa dipetakan
    ke kolom resource_* di tabel technical_inputs.
    """

    specific_yield_kwh_per_kwp_year: float
    yield_boundary: Literal["net_ac_at_delivery", "gross_pre_loss"]

    provider_name: str
    dataset: str | None
    dataset_version: str | None
    period: str | None
    retrieval_timestamp: str


class ResourceProvider(ABC):
    """Antarmuka yang harus dipenuhi setiap penyedia data lokasi."""

    @abstractmethod
    def get_resource(
        self,
        latitude: float,
        longitude: float,
        tilt_degrees: float,
        azimuth_degrees: float,
    ) -> ResourceResult:
        """Mengembalikan data sumber daya surya untuk lokasi yang diberikan.

        Melempar ResourceError bila data tidak bisa didapat.
        """
