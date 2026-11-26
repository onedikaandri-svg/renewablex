"""Tes unit untuk pemuatan beban CSV dan pembangkit beban sintetis deterministik."""

import numpy as np
import pytest

from app.errors import EngineError
from app.hybrid.load import generate_synthetic_load, load_profile_from_csv
from app.hybrid.time_grid import TimeConfig


class TestLoadProfileFromCSV:
    def test_loads_single_column_and_two_column_with_header(self, tmp_path):
        tc = TimeConfig(step_minutes=60)
        n = tc.steps_per_year

        one_col = tmp_path / "one.csv"
        one_col.write_text("load_kw\n" + "\n".join("100.5" for _ in range(n)), encoding="utf-8")
        p1 = load_profile_from_csv(one_col, tc)
        assert len(p1.load_kw) == n
        assert p1.total_energy_kwh == pytest.approx(n * 100.5)
        assert p1.source == "csv"

        two_col = tmp_path / "two.csv"
        two_col.write_text("hour,load_kw\n" + "\n".join(f"{i},50.0" for i in range(n)), encoding="utf-8")
        p2 = load_profile_from_csv(two_col, tc)
        assert p2.total_energy_kwh == pytest.approx(n * 50.0)

    def test_rejects_wrong_length(self):
        tc = TimeConfig(step_minutes=60)
        csv_text = "load_kw\n" + "\n".join("10.0" for _ in range(100))
        with pytest.raises(EngineError) as exc_info:
            load_profile_from_csv(csv_text, tc)
        assert exc_info.value.code == "invalid_load_length"

    def test_rejects_negative_value(self):
        tc = TimeConfig(step_minutes=60)
        rows = ["10.0"] * tc.steps_per_year
        rows[50] = "-0.1"
        csv_text = "load_kw\n" + "\n".join(rows)
        with pytest.raises(EngineError) as exc_info:
            load_profile_from_csv(csv_text, tc)
        assert exc_info.value.code == "negative_load_value"

    @pytest.mark.parametrize("bad_token", ["", "NaN", "inf"])
    def test_rejects_missing_or_non_finite_value(self, bad_token):
        tc = TimeConfig(step_minutes=60)
        rows = ["10.0"] * tc.steps_per_year
        rows[12] = bad_token
        csv_text = "load_kw\n" + "\n".join(rows)
        with pytest.raises(EngineError) as exc_info:
            load_profile_from_csv(csv_text, tc)
        assert exc_info.value.code == "non_finite_load_value"

    def test_rejects_non_numeric_cell(self):
        tc = TimeConfig(step_minutes=60)
        rows = ["10.0"] * tc.steps_per_year
        rows[5] = "abc"
        csv_text = "load_kw\n" + "\n".join(rows)
        with pytest.raises(EngineError) as exc_info:
            load_profile_from_csv(csv_text, tc)
        assert exc_info.value.code == "invalid_csv_format"


class TestSyntheticLoadProfile:
    def test_deterministic_for_same_seed_and_distinct_for_different_seed(self):
        tc = TimeConfig(step_minutes=60)
        p1 = generate_synthetic_load(base_load_kw=100.0, peak_load_kw=300.0, time_config=tc, seed=123)
        p2 = generate_synthetic_load(base_load_kw=100.0, peak_load_kw=300.0, time_config=tc, seed=123)
        p3 = generate_synthetic_load(base_load_kw=100.0, peak_load_kw=300.0, time_config=tc, seed=999)

        assert np.array_equal(p1.load_kw, p2.load_kw)
        assert not np.array_equal(p1.load_kw, p3.load_kw)
        assert np.all(p1.load_kw >= 0.0)

    def test_works_for_15_minute_resolution_and_monthly_factors(self):
        tc = TimeConfig(step_minutes=15)
        factors = [1.0] * 11 + [1.5]
        p = generate_synthetic_load(
            base_load_kw=50.0,
            peak_load_kw=100.0,
            time_config=tc,
            seed=7,
            monthly_factors=factors,
            noise_fraction=0.0,
        )
        assert len(p.load_kw) == 365 * 96
        assert np.min(p.load_kw) >= 50.0
        assert np.max(p.load_kw) > 120.0
