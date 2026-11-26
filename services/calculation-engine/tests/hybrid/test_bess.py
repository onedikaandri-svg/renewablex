"""Tes unit dan tes properti untuk model baterai BESS (BESSComponent)."""

import numpy as np
import pytest

from app.errors import EngineError
from app.hybrid.bess import BESSComponent, BESSConfig
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset, WeatherMetadata


def _dummy_weather(tc: TimeConfig) -> WeatherDataset:
    n = tc.steps_per_year
    meta = WeatherMetadata("test", "bess", "1.0", "test", -6.2, 106.8, 16.0, tc.timezone, tc.utc_offset_hours, "now")
    return WeatherDataset(
        ghi_w_m2=np.zeros(n),
        dni_w_m2=np.zeros(n),
        dhi_w_m2=np.zeros(n),
        temp_air_c=np.full(n, 25.0),
        wind_speed_m_s=np.full(n, 1.0),
        time_config=tc,
        metadata=meta,
    )


class TestBESSValidationAndConfiguration:
    def test_c_rate_derives_rated_power_when_kw_omitted(self):
        cfg = BESSConfig(nominal_capacity_kwh=500.0, c_rate_charge=0.5, c_rate_discharge=1.0)
        BESSComponent(cfg).validate()
        assert cfg.rated_max_charge_kw == pytest.approx(250.0)
        assert cfg.rated_max_discharge_kw == pytest.approx(500.0)

    def test_rejects_invalid_bess_parameters(self):
        bad_configs = [
            BESSConfig(nominal_capacity_kwh=0.0, max_charge_kw=100.0, max_discharge_kw=100.0),
            BESSConfig(nominal_capacity_kwh=100.0, max_discharge_kw=50.0),
            BESSConfig(nominal_capacity_kwh=100.0, max_charge_kw=50.0, max_discharge_kw=50.0, soc_min_fraction=0.6, soc_max_fraction=0.5),
            BESSConfig(nominal_capacity_kwh=100.0, max_charge_kw=50.0, max_discharge_kw=50.0, initial_soc_fraction=0.98),
            BESSConfig(nominal_capacity_kwh=100.0, max_charge_kw=50.0, max_discharge_kw=50.0, charge_efficiency=1.1),
            BESSConfig(nominal_capacity_kwh=100.0, max_charge_kw=50.0, max_discharge_kw=50.0, eol_capacity_fraction=1.0),
        ]
        for cfg in bad_configs:
            with pytest.raises(EngineError) as exc_info:
                BESSComponent(cfg).validate()
            assert exc_info.value.code == "invalid_bess_config"


class TestBESSPropertiesAndLifecycle:
    @pytest.mark.parametrize("step_minutes", [60, 30, 15])
    @pytest.mark.parametrize("seed", [1, 7, 42])
    def test_physical_invariants_across_random_commands_and_timesteps(self, step_minutes, seed):
        tc = TimeConfig(step_minutes=step_minutes, timezone="Asia/Jakarta")
        weather = _dummy_weather(tc)
        cfg = BESSConfig(
            nominal_capacity_kwh=400.0,
            max_charge_kw=200.0,
            max_discharge_kw=250.0,
            soc_min_fraction=0.15,
            soc_max_fraction=0.92,
            initial_soc_fraction=0.50,
            charge_efficiency=0.95,
            discharge_efficiency=0.93,
            pcs_loss_fraction=0.02,
        )
        bess = BESSComponent(cfg)
        state = bess.initial_state(year=1)

        rng = np.random.default_rng(seed)
        commands = rng.uniform(-350.0, 350.0, size=min(tc.steps_per_year, 1000))

        for idx, cmd in enumerate(commands):
            cap_before = state["effective_capacity_kwh"]
            soc_before = state["soc_fraction"]
            res = bess.step(idx, float(cmd), weather, state)
            state = res.state_out

            # 1. Tidak boleh charge dan discharge bersamaan.
            assert res.charge_kw * res.discharge_kw == 0.0
            assert res.charge_kw >= 0.0
            assert res.discharge_kw >= 0.0

            # 2. SOC selalu berada dalam batas aman.
            assert cfg.soc_min_fraction - 1e-12 <= state["soc_fraction"] <= cfg.soc_max_fraction + 1e-12

            # 3. Neraca energi internal tertutup.
            expected_delta = state["last_step_internal_in_kwh"] - state["last_step_internal_out_kwh"]
            assert state["last_step_delta_energy_kwh"] == pytest.approx(expected_delta, abs=1e-9)
            assert (state["soc_fraction"] * cap_before) - (soc_before * cap_before) == pytest.approx(
                expected_delta, abs=1e-7
            )

    def test_deterministic_for_identical_inputs(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _dummy_weather(tc)
        cfg = BESSConfig(nominal_capacity_kwh=200.0, max_charge_kw=100.0, max_discharge_kw=100.0)

        def run_seq():
            bess = BESSComponent(cfg)
            st = bess.initial_state()
            socs = []
            for t in range(48):
                cmd = 80.0 if t % 2 == 0 else -60.0
                res = bess.step(t, cmd, weather, st)
                st = res.state_out
                socs.append(st["soc_fraction"])
            return socs

        assert run_seq() == run_seq()

    def test_degradation_triggers_eol_replacement_event_and_resets_capacity(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _dummy_weather(tc)
        cfg = BESSConfig(
            nominal_capacity_kwh=100.0,
            max_charge_kw=100.0,
            max_discharge_kw=100.0,
            soc_min_fraction=0.10,
            soc_max_fraction=0.95,
            initial_soc_fraction=0.50,
            calendar_fade_per_year=0.05,
            cycle_fade_per_efc=0.002,  # Dipercepat untuk memicu EOL dalam uji unit.
            eol_capacity_fraction=0.80,
            replacement_cost=250_000_000.0,
        )
        bess = BESSComponent(cfg)
        state = bess.initial_state(year=3)

        saw_replacement = False
        for t in range(500):
            cmd = -80.0 if t % 2 == 0 else 80.0
            res = bess.step(t, cmd, weather, state)
            state = res.state_out
            if state["replacement_count"] > 0 and not saw_replacement:
                saw_replacement = True
                assert state["effective_capacity_kwh"] == pytest.approx(cfg.nominal_capacity_kwh, rel=1e-9)
                events = bess.lifecycle_events(year=3)
                assert len(events) == 1
                assert events[0].event_type == "bess_replacement"
                assert events[0].cost_amount == pytest.approx(250_000_000.0)

        assert saw_replacement
