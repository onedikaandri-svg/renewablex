"""Tes fisika PVWatts, kekekalan neraca energi, dan konsistensi agregasi simulator."""

import numpy as np
import pytest

from app.hybrid.components import PVWattsComponent, PVWattsConfig
from app.hybrid.load import generate_synthetic_load
from app.hybrid.simulator import SimulationConfig, run_simulation
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset, WeatherMetadata


def _make_clear_weather(tc: TimeConfig, temp_c: float = 28.0) -> WeatherDataset:
    n = tc.steps_per_year
    hours = tc.hour_of_day()
    daytime = (hours >= 6.0) & (hours <= 18.0)
    angle = np.where(daytime, np.sin(np.pi * (hours - 6.0) / 12.0), 0.0)
    ghi = 900.0 * angle
    dni = 800.0 * angle
    dhi = 180.0 * angle
    meta = WeatherMetadata("test", "clear", "1.0", "test", -6.2, 106.8, 16.0, tc.timezone, tc.utc_offset_hours, "now")
    return WeatherDataset(
        ghi_w_m2=ghi,
        dni_w_m2=dni,
        dhi_w_m2=dhi,
        temp_air_c=np.full(n, temp_c),
        wind_speed_m_s=np.full(n, 2.0),
        time_config=tc,
        metadata=meta,
    )


class TestPVWattsPhysics:
    def test_nighttime_output_is_zero(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_clear_weather(tc)
        pv = PVWattsComponent(PVWattsConfig(capacity_kwp=100.0, inverter_ac_kw=100.0))
        out = pv.compute_hourly(weather)

        night_mask = weather.ghi_w_m2 == 0.0
        assert np.all(out.ac_net_kw[night_mask] == 0.0)
        assert float(np.max(out.ac_net_kw)) > 0.0

    def test_higher_ambient_temperature_reduces_dc_output(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        cool_weather = _make_clear_weather(tc, temp_c=22.0)
        hot_weather = _make_clear_weather(tc, temp_c=38.0)

        pv = PVWattsComponent(PVWattsConfig(capacity_kwp=100.0, inverter_ac_kw=120.0))
        cool_out = pv.compute_hourly(cool_weather)
        hot_out = pv.compute_hourly(hot_weather)

        assert float(np.sum(hot_out.dc_after_temp_kw)) < float(np.sum(cool_out.dc_after_temp_kw))

    def test_inverter_clipping_caps_ac_power_and_records_clipping_loss(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_clear_weather(tc)
        pv = PVWattsComponent(PVWattsConfig(capacity_kwp=500.0, inverter_ac_kw=200.0))
        out = pv.compute_hourly(weather)

        assert float(np.max(out.ac_net_kw)) <= 200.0 + 1e-12
        assert out.loss_breakdown_kwh["clipping_loss_kwh"] > 0.0

        # Waterfall rugi harus menutup tepat dari DC nominal hingga AC bersih.
        losses = out.loss_breakdown_kwh
        net_from_waterfall = (
            losses["dc_nominal_kwh"]
            - losses["temperature_loss_kwh"]
            - losses["system_loss_kwh"]
            - losses["inverter_loss_kwh"]
            - losses["clipping_loss_kwh"]
        )
        assert net_from_waterfall == pytest.approx(losses["ac_net_kwh"], rel=1e-9)


class TestSimulatorBalanceAndAggregation:
    def test_closed_energy_balance_and_aggregation_consistency(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_clear_weather(tc)
        load_profile = generate_synthetic_load(base_load_kw=80.0, peak_load_kw=250.0, time_config=tc, seed=7)
        config = SimulationConfig(
            project_name="Uji Neraca",
            time_config=tc,
            pv=PVWattsConfig(capacity_kwp=300.0, inverter_ac_kw=260.0),
        )

        res = run_simulation(config, weather, load_profile)
        b = res.balance

        # Neraca tertutup di setiap jam.
        assert res.summary.max_balance_error_kw <= 1e-9
        assert np.allclose(b.served_load_kw + b.unmet_load_kw, b.load_kw, atol=1e-9)
        assert np.allclose(b.served_load_kw + b.curtailment_kw, b.generation_kw, atol=1e-9)

        # Konsistensi agregasi harian -> tahunan.
        assert len(res.daily) == 365
        assert sum(r.load_kwh for r in res.daily) == pytest.approx(res.summary.total_load_kwh, rel=1e-9)
        assert sum(r.pv_generation_kwh for r in res.daily) == pytest.approx(res.summary.pv_generation_kwh, rel=1e-9)

        # Konsistensi agregasi bulanan -> tahunan.
        assert len(res.monthly) == 12
        assert sum(r.load_kwh for r in res.monthly) == pytest.approx(res.summary.total_load_kwh, rel=1e-9)
        assert sum(r.served_load_kwh for r in res.monthly) == pytest.approx(res.summary.served_load_kwh, rel=1e-9)
        assert sum(r.unmet_load_kwh for r in res.monthly) == pytest.approx(res.summary.unmet_load_kwh, rel=1e-9)
        assert sum(r.curtailment_kwh for r in res.monthly) == pytest.approx(res.summary.curtailment_kwh, rel=1e-9)

        assert 0.0 <= res.summary.renewable_fraction <= 1.0

    def test_works_for_30_minute_step_end_to_end(self):
        tc = TimeConfig(step_minutes=30, timezone="Asia/Makassar")
        weather = _make_clear_weather(tc)
        load_profile = generate_synthetic_load(base_load_kw=50.0, peak_load_kw=120.0, time_config=tc, seed=11)
        config = SimulationConfig(
            project_name="Uji 30 Menit",
            time_config=tc,
            pv=PVWattsConfig(capacity_kwp=150.0, inverter_ac_kw=130.0),
        )

        res = run_simulation(config, weather, load_profile)
        assert res.summary.steps_count == 365 * 48
        assert res.summary.step_minutes == 30
        assert res.summary.max_balance_error_kw <= 1e-9
