"""Struktur waktu dan kebijakan kalender untuk simulasi hybrid per langkah waktu."""

from dataclasses import dataclass
from datetime import datetime, timezone as dt_timezone
import re
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import numpy as np

from app.errors import EngineError

# Selalu 365 hari per tahun sesuai kebijakan mengabaikan tanggal 29 Februari.
DAYS_PER_MONTH: tuple[int, ...] = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
SUPPORTED_STEP_MINUTES: tuple[int, ...] = (60, 30, 15)

# Peta zona waktu bawaan agar selalu deterministik dan tidak gagal di Windows tanpa tzdata.
_FIXED_TIMEZONE_OFFSETS: dict[str, float] = {
    "UTC": 0.0,
    "Asia/Jakarta": 7.0,
    "Asia/Pontianak": 7.0,
    "Asia/Makassar": 8.0,
    "Asia/Jayapura": 9.0,
}

_UTC_OFFSET_PATTERN = re.compile(r"^UTC([+-])(\d{1,2})(?::?(\d{2}))?$")


def resolve_utc_offset_hours(tz_name: str) -> float:
    """Mengembalikan offset UTC (dalam jam) dari nama zona waktu lokasi proyek."""
    if not isinstance(tz_name, str) or not tz_name.strip():
        raise EngineError("invalid_timezone", "Zona waktu tidak boleh kosong.")

    cleaned = tz_name.strip()
    if cleaned in _FIXED_TIMEZONE_OFFSETS:
        return _FIXED_TIMEZONE_OFFSETS[cleaned]

    match = _UTC_OFFSET_PATTERN.match(cleaned)
    if match:
        sign = 1.0 if match.group(1) == "+" else -1.0
        hours = int(match.group(2))
        minutes = int(match.group(3) or "0")
        offset = sign * (hours + minutes / 60.0)
        if not -12.0 <= offset <= 14.0 or minutes >= 60:
            raise EngineError("invalid_timezone", f"Offset zona waktu di luar rentang wajar: {cleaned}.")
        return offset

    try:
        tz = ZoneInfo(cleaned)
    except ZoneInfoNotFoundError as exc:
        raise EngineError("invalid_timezone", f"Zona waktu tidak dikenal: {cleaned}.") from exc

    # Tahun non-kabisat standar dipakai agar offset dasar zona waktu konsisten.
    ref = datetime(2023, 1, 1, 0, 0, tzinfo=dt_timezone.utc).astimezone(tz)
    offset_td = ref.utcoffset()
    if offset_td is None:
        raise EngineError("invalid_timezone", f"Offset zona waktu tidak tersedia untuk {cleaned}.")
    return offset_td.total_seconds() / 3600.0


@dataclass(frozen=True)
class TimeConfig:
    """Konfigurasi resolusi langkah waktu, zona waktu lokal, dan kebijakan kabisat."""

    step_minutes: int = 60
    timezone: str = "Asia/Jakarta"
    leap_day_policy: Literal["ignore_feb_29"] = "ignore_feb_29"

    def __post_init__(self) -> None:
        if isinstance(self.step_minutes, bool) or not isinstance(self.step_minutes, int):
            raise EngineError("unsupported_step_minutes", "step_minutes harus berupa bilangan bulat.")
        if self.step_minutes not in SUPPORTED_STEP_MINUTES:
            raise EngineError(
                "unsupported_step_minutes",
                f"step_minutes harus salah satu dari {SUPPORTED_STEP_MINUTES}, diterima {self.step_minutes}.",
            )
        if self.leap_day_policy != "ignore_feb_29":
            raise EngineError(
                "invalid_leap_day_policy",
                "Hanya kebijakan ignore_feb_29 (365 hari per tahun) yang didukung.",
            )
        resolve_utc_offset_hours(self.timezone)

    @property
    def step_hours(self) -> float:
        return self.step_minutes / 60.0

    @property
    def steps_per_day(self) -> int:
        return (24 * 60) // self.step_minutes

    @property
    def steps_per_year(self) -> int:
        return sum(DAYS_PER_MONTH) * self.steps_per_day

    @property
    def utc_offset_hours(self) -> float:
        return resolve_utc_offset_hours(self.timezone)

    def day_indices(self) -> np.ndarray:
        """Indeks hari 0..364 untuk setiap langkah waktu dalam setahun."""
        return np.arange(self.steps_per_year, dtype=np.int64) // self.steps_per_day

    def month_indices(self) -> np.ndarray:
        """Indeks bulan 1..12 untuk setiap langkah waktu dalam setahun."""
        day_to_month = np.repeat(
            np.arange(1, 13, dtype=np.int64),
            np.array(DAYS_PER_MONTH, dtype=np.int64),
        )
        return day_to_month[self.day_indices()]

    def hour_of_day(self) -> np.ndarray:
        """Titik tengah jam lokal [0, 24) untuk setiap langkah waktu."""
        step_in_day = np.arange(self.steps_per_year, dtype=np.float64) % self.steps_per_day
        return (step_in_day + 0.5) * self.step_hours

    def timestamp_labels(self) -> list[str]:
        """Label waktu lokal awal tiap langkah dalam format MM-DD HH:MM."""
        day_of_year = self.day_indices()
        step_in_day = np.arange(self.steps_per_year, dtype=np.int64) % self.steps_per_day

        month_starts = np.cumsum((0,) + DAYS_PER_MONTH[:-1])
        labels: list[str] = []
        for idx in range(self.steps_per_year):
            doy = int(day_of_year[idx])
            month_idx = int(np.searchsorted(month_starts, doy, side="right"))
            day_in_month = doy - int(month_starts[month_idx - 1]) + 1
            total_minutes = int(step_in_day[idx]) * self.step_minutes
            hh, mm = divmod(total_minutes, 60)
            labels.append(f"{month_idx:02d}-{day_in_month:02d} {hh:02d}:{mm:02d}")
        return labels
