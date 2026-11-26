"""Tes unit untuk TimeConfig dan resolusi langkah waktu hybrid."""

import numpy as np
import pytest

from app.errors import EngineError
from app.hybrid.time_grid import DAYS_PER_MONTH, TimeConfig


class TestTimeConfigSteps:
    def test_hourly_steps_derived_without_leap_day(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        assert tc.step_hours == 1.0
        assert tc.steps_per_day == 24
        assert tc.steps_per_year == 365 * 24
        assert tc.utc_offset_hours == 7.0

    @pytest.mark.parametrize("step_minutes,expected_per_day", [(60, 24), (30, 48), (15, 96)])
    def test_supports_60_30_and_15_minute_steps(self, step_minutes, expected_per_day):
        tc = TimeConfig(step_minutes=step_minutes)
        assert tc.steps_per_day == expected_per_day
        assert tc.steps_per_year == 365 * expected_per_day

    @pytest.mark.parametrize("bad_step", [0, -15, 20, 45, 120, True])
    def test_rejects_unsupported_step_minutes(self, bad_step):
        with pytest.raises(EngineError) as exc_info:
            TimeConfig(step_minutes=bad_step)
        assert exc_info.value.code == "unsupported_step_minutes"

    def test_rejects_unsupported_leap_day_policy(self):
        with pytest.raises(EngineError) as exc_info:
            TimeConfig(leap_day_policy="include_feb_29")  # type: ignore[arg-type]
        assert exc_info.value.code == "invalid_leap_day_policy"


class TestTimeConfigTimezonesAndIndices:
    @pytest.mark.parametrize(
        "tz,expected_offset",
        [
            ("Asia/Jakarta", 7.0),
            ("Asia/Makassar", 8.0),
            ("Asia/Jayapura", 9.0),
            ("UTC", 0.0),
            ("UTC+7", 7.0),
            ("UTC+05:30", 5.5),
            ("UTC-4", -4.0),
        ],
    )
    def test_resolves_indonesian_and_utc_offsets(self, tz, expected_offset):
        tc = TimeConfig(timezone=tz)
        assert tc.utc_offset_hours == pytest.approx(expected_offset)

    def test_rejects_unknown_timezone(self):
        with pytest.raises(EngineError) as exc_info:
            TimeConfig(timezone="Mars/Olympus")
        assert exc_info.value.code == "invalid_timezone"

    def test_month_and_day_indices_match_calendar(self):
        tc = TimeConfig(step_minutes=30)
        months = tc.month_indices()
        days = tc.day_indices()

        assert len(months) == tc.steps_per_year
        assert len(days) == tc.steps_per_year
        assert int(days[0]) == 0
        assert int(days[-1]) == 364

        for month_num, expected_days in enumerate(DAYS_PER_MONTH, start=1):
            assert int(np.sum(months == month_num)) == expected_days * tc.steps_per_day

    def test_hour_of_day_and_timestamp_labels(self):
        tc = TimeConfig(step_minutes=60)
        hours = tc.hour_of_day()
        labels = tc.timestamp_labels()

        assert hours[0] == pytest.approx(0.5)
        assert hours[23] == pytest.approx(23.5)
        assert labels[0] == "01-01 00:00"
        assert labels[24] == "01-02 00:00"
        assert labels[-1] == "12-31 23:00"
