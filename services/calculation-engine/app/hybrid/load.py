"""Pemuat dan pembangkit profil beban listrik dengan validasi ketat."""

import csv
from dataclasses import dataclass, field
import io
import math
from pathlib import Path
from typing import Any

import numpy as np

from app.errors import EngineError
from app.hybrid.time_grid import TimeConfig

# Faktor bentuk beban harian 24 jam bawaan (0..1) untuk pembangkit profil sintetis.
_DEFAULT_DAILY_SHAPE_24: tuple[float, ...] = (
    0.10, 0.08, 0.06, 0.06, 0.08, 0.15,
    0.35, 0.58, 0.78, 0.90, 0.96, 1.00,
    0.95, 0.97, 0.94, 0.88, 0.76, 0.65,
    0.58, 0.50, 0.42, 0.30, 0.20, 0.14,
)


@dataclass(frozen=True)
class LoadProfile:
    """Deret beban listrik (kW) yang sudah divalidasi sepanjang langkah simulasi."""

    load_kw: np.ndarray
    time_config: TimeConfig
    source: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        expected = self.time_config.steps_per_year
        if not isinstance(self.load_kw, np.ndarray) or self.load_kw.ndim != 1:
            raise EngineError("invalid_load_format", "Deret beban harus berupa array 1 dimensi.")
        if len(self.load_kw) != expected:
            raise EngineError(
                "invalid_load_length",
                f"Panjang deret beban harus {expected}, diterima {len(self.load_kw)}.",
            )
        if not np.all(np.isfinite(self.load_kw)):
            raise EngineError(
                "non_finite_load_value",
                "Deret beban mengandung nilai kosong, NaN, atau tidak terhingga.",
            )
        if np.any(self.load_kw < 0):
            raise EngineError(
                "negative_load_value",
                "Deret beban tidak boleh mengandung nilai negatif.",
            )

    @property
    def total_energy_kwh(self) -> float:
        return float(np.sum(self.load_kw) * self.time_config.step_hours)

    @property
    def peak_kw(self) -> float:
        return float(np.max(self.load_kw))


def _is_float_token(token: str) -> bool:
    try:
        float(token)
        return True
    except ValueError:
        return False


def _select_load_column(rows: list[list[str]]) -> tuple[int, list[list[str]]]:
    first_row = [cell.strip() for cell in rows[0]]
    if len(first_row) == 1:
        if _is_float_token(first_row[0]):
            return 0, rows
        return 0, rows[1:]

    # Jika ada header teks, cari kolom bernama load_kw atau pakai kolom kedua untuk 2 kolom.
    has_header = not all(_is_float_token(cell) for cell in first_row)
    if has_header:
        lowered = [c.lower() for c in first_row]
        if "load_kw" in lowered:
            return lowered.index("load_kw"), rows[1:]
        if len(first_row) == 2:
            return 1, rows[1:]
        raise EngineError(
            "invalid_csv_format",
            "CSV memiliki lebih dari 2 kolom tanpa kolom bernama 'load_kw'.",
        )

    if len(first_row) == 2:
        return 1, rows
    raise EngineError(
        "invalid_csv_format",
        "CSV tanpa header hanya mendukung 1 kolom (load_kw) atau 2 kolom (waktu, load_kw).",
    )


def load_profile_from_csv(source: Path | str, time_config: TimeConfig) -> LoadProfile:
    """Membaca deret beban dari berkas CSV atau string CSV dan memvalidasi isi serta panjangnya."""
    if isinstance(source, Path):
        csv_text = source.read_text(encoding="utf-8")
        source_label = str(source)
    elif "\n" not in source and "\r" not in source:
        path = Path(source)
        csv_text = path.read_text(encoding="utf-8")
        source_label = str(path)
    else:
        csv_text = source
        source_label = "inline_csv"

    reader = csv.reader(io.StringIO(csv_text))
    rows = list(reader)
    # Abaikan baris kosong hanya di awal atau akhir berkas; baris kosong di tengah dihitung nilai hilang.
    while rows and not any(cell.strip() for cell in rows[0]):
        rows.pop(0)
    while rows and not any(cell.strip() for cell in rows[-1]):
        rows.pop()
    if not rows:
        raise EngineError("invalid_csv_format", "Berkas CSV beban kosong.")

    col_idx, data_rows = _select_load_column(rows)
    if len(data_rows) != time_config.steps_per_year:
        raise EngineError(
            "invalid_load_length",
            f"Jumlah baris data beban harus {time_config.steps_per_year}, ditemukan {len(data_rows)}.",
        )

    values: list[float] = []
    for line_no, row in enumerate(data_rows, start=1):
        if len(row) == 0 and col_idx == 0:
            raw = ""
        elif len(row) <= col_idx:
            raise EngineError(
                "invalid_csv_format",
                f"Baris data ke-{line_no} tidak memiliki kolom beban.",
            )
        else:
            raw = row[col_idx].strip()
        if raw == "":
            raise EngineError(
                "non_finite_load_value",
                f"Nilai beban kosong pada baris data ke-{line_no}.",
            )
        try:
            val = float(raw)
        except ValueError as exc:
            raise EngineError(
                "invalid_csv_format",
                f"Nilai beban tidak valid pada baris data ke-{line_no}: '{raw}'.",
            ) from exc
        if not math.isfinite(val):
            raise EngineError(
                "non_finite_load_value",
                f"Nilai beban tidak terhingga atau NaN pada baris data ke-{line_no}.",
            )
        if val < 0:
            raise EngineError(
                "negative_load_value",
                f"Nilai beban negatif pada baris data ke-{line_no}: {val}.",
            )
        values.append(val)

    return LoadProfile(
        load_kw=np.array(values, dtype=np.float64),
        time_config=time_config,
        source="csv",
        metadata={"origin": source_label},
    )


def generate_synthetic_load(
    base_load_kw: float,
    peak_load_kw: float,
    time_config: TimeConfig,
    seed: int = 42,
    daily_profile: list[float] | tuple[float, ...] | None = None,
    monthly_factors: list[float] | tuple[float, ...] | None = None,
    noise_fraction: float = 0.05,
) -> LoadProfile:
    """Membangun profil beban deterministik dari beban dasar, pola harian, musiman, dan seed."""
    if not math.isfinite(base_load_kw) or base_load_kw < 0:
        raise EngineError("negative_load_value", "base_load_kw harus terhingga dan tidak negatif.")
    if not math.isfinite(peak_load_kw) or peak_load_kw < base_load_kw:
        raise EngineError(
            "invalid_load_parameters",
            "peak_load_kw harus lebih besar atau sama dengan base_load_kw.",
        )
    if not math.isfinite(noise_fraction) or not 0.0 <= noise_fraction < 1.0:
        raise EngineError(
            "invalid_load_parameters",
            "noise_fraction harus berada antara 0 dan kurang dari 1.",
        )

    shape_24 = np.array(
        _DEFAULT_DAILY_SHAPE_24 if daily_profile is None else daily_profile,
        dtype=np.float64,
    )
    if shape_24.ndim != 1 or len(shape_24) != 24 or not np.all(np.isfinite(shape_24)) or np.any(shape_24 < 0):
        raise EngineError(
            "invalid_load_parameters",
            "daily_profile harus berisi tepat 24 angka non-negatif yang terhingga.",
        )

    max_shape = float(np.max(shape_24))
    if max_shape > 0:
        shape_24 = shape_24 / max_shape

    if monthly_factors is None:
        month_scale = np.ones(12, dtype=np.float64)
    else:
        month_scale = np.array(monthly_factors, dtype=np.float64)
        if (
            month_scale.ndim != 1
            or len(month_scale) != 12
            or not np.all(np.isfinite(month_scale))
            or np.any(month_scale < 0)
        ):
            raise EngineError(
                "invalid_load_parameters",
                "monthly_factors harus berisi tepat 12 angka non-negatif yang terhingga.",
            )

    # Interpolasi siklik pola 24 jam agar mendukung langkah 60, 30, maupun 15 menit secara halus.
    hours = time_config.hour_of_day()
    hour_knots = np.arange(25, dtype=np.float64)
    shape_knots = np.append(shape_24, shape_24[0])
    daily_factors = np.interp(hours, hour_knots, shape_knots)

    months = time_config.month_indices() - 1
    seasonal_factors = month_scale[months]

    clean_kw = (base_load_kw + (peak_load_kw - base_load_kw) * daily_factors) * seasonal_factors

    if noise_fraction > 0:
        rng = np.random.default_rng(seed)
        multipliers = rng.normal(loc=1.0, scale=noise_fraction, size=time_config.steps_per_year)
        load_kw = np.maximum(clean_kw * multipliers, 0.0)
    else:
        load_kw = np.maximum(clean_kw, 0.0)

    return LoadProfile(
        load_kw=load_kw,
        time_config=time_config,
        source="synthetic",
        metadata={
            "base_load_kw": float(base_load_kw),
            "peak_load_kw": float(peak_load_kw),
            "seed": int(seed),
            "noise_fraction": float(noise_fraction),
        },
    )
