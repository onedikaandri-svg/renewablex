"""Tes unit dan tes properti untuk komponen pembangkit biomassa Tahap 3A."""

import numpy as np
import pytest

from app.errors import EngineError
from app.hybrid.biomass import (
    BIOMASS_FUEL_PRESETS,
    BIOMASS_PLANT_SAMPLES,
    WATER_LATENT_HEAT_MJ_PER_KG,
    BiomassComponent,
    BiomassConfig,
    ScheduledOutageWindow,
    build_sample_biomass_config,
    resolve_biomass_config,
)
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset, WeatherMetadata


def _make_dummy_weather(tc: TimeConfig) -> WeatherDataset:
    n = tc.steps_per_year
    meta = WeatherMetadata("test", "clear", "1.0", "test", -6.2, 106.8, 16.0, tc.timezone, tc.utc_offset_hours, "now")
    return WeatherDataset(
        ghi_w_m2=np.zeros(n),
        dni_w_m2=np.zeros(n),
        dhi_w_m2=np.zeros(n),
        temp_air_c=np.full(n, 28.0),
        wind_speed_m_s=np.full(n, 2.0),
        time_config=tc,
        metadata=meta,
    )


class TestBiomassValidationAndPresets:
    def test_invalid_configs_raise_structured_engine_error(self):
        invalid_cases = [
            {"rated_capacity_kw": 0.0, "ramp_up_kw_per_hour": 50.0, "ramp_down_kw_per_hour": 50.0, "min_load_fraction": 0.4, "fuel_curve_points": ((0.4, 15000.0), (1.0, 13000.0)), "fuel_preset": "efb"},
            {"rated_capacity_kw": 200.0, "ramp_up_kw_per_hour": 50.0, "ramp_down_kw_per_hour": 50.0, "fuel_curve_points": ((0.4, 15000.0), (1.0, 13000.0)), "fuel_preset": "efb"},
            {"rated_capacity_kw": 200.0, "ramp_up_kw_per_hour": 50.0, "ramp_down_kw_per_hour": 50.0, "min_load_fraction": 0.4, "min_load_kw": 120.0, "fuel_curve_points": ((0.4, 15000.0), (1.0, 13000.0)), "fuel_preset": "efb"},
            {"rated_capacity_kw": 200.0, "ramp_up_kw_per_hour": 50.0, "ramp_down_kw_per_hour": 50.0, "min_load_fraction": 0.4, "fuel_curve_points": ((0.5, 15000.0), (1.0, 13000.0)), "fuel_preset": "efb"},
            {"rated_capacity_kw": 200.0, "ramp_up_kw_per_hour": 50.0, "ramp_down_kw_per_hour": 50.0, "min_load_fraction": 0.4, "fuel_curve_model": "willans_linear", "fuel_preset": "efb"},
            {"rated_capacity_kw": 200.0, "ramp_up_kw_per_hour": 50.0, "ramp_down_kw_per_hour": 50.0, "min_load_fraction": 0.4, "fuel_curve_points": ((0.4, 15000.0), (1.0, 13000.0)), "fuel_preset": "batubara_ilegal"},
            {"rated_capacity_kw": 200.0, "ramp_up_kw_per_hour": 50.0, "ramp_down_kw_per_hour": 50.0, "min_load_fraction": 0.4, "fuel_curve_points": ((0.4, 15000.0), (1.0, 13000.0)), "fuel_name": "Sampel", "lhv_mj_per_kg": 1.0, "lhv_basis": "dry", "moisture_fraction": 0.80},
            {"rated_capacity_kw": 200.0, "ramp_up_kw_per_hour": 50.0, "ramp_down_kw_per_hour": 50.0, "min_load_fraction": 0.4, "fuel_curve_points": ((0.4, 15000.0), (1.0, 13000.0)), "fuel_preset": "pks", "supply_period": "monthly"},
            {"rated_capacity_kw": 200.0, "ramp_up_kw_per_hour": 50.0, "ramp_down_kw_per_hour": 50.0, "min_load_fraction": 0.4, "fuel_curve_points": ((0.4, 15000.0), (1.0, 13000.0)), "fuel_preset": "pks", "unplanned_outage_rate": 0.05, "mean_time_to_repair_hours": 0.0},
            {"rated_capacity_kw": 200.0, "ramp_up_kw_per_hour": 50.0, "ramp_down_kw_per_hour": 50.0, "min_load_fraction": 0.4, "fuel_curve_points": ((0.4, 15000.0), (1.0, 13000.0)), "fuel_preset": "pks", "scheduled_outage_windows": (ScheduledOutageWindow(start_day=10, end_day=5),)},
            {"rated_capacity_kw": 200.0, "ramp_up_kw_per_hour": 50.0, "ramp_down_kw_per_hour": 50.0, "min_load_fraction": 0.4, "fuel_curve_points": ((0.4, 15000.0), (1.0, 13000.0)), "fuel_preset": "pks", "chp_enabled": True},
        ]
        for kwargs in invalid_cases:
            with pytest.raises(EngineError) as exc_info:
                BiomassComponent(BiomassConfig(**kwargs)).validate()
            assert exc_info.value.code == "invalid_biomass_config"

    def test_all_five_fuel_presets_and_field_overrides(self):
        assert set(BIOMASS_FUEL_PRESETS.keys()) == {"efb", "wood_pellet", "pks", "woodchip", "rice_husk"}
        for preset_name, expected in BIOMASS_FUEL_PRESETS.items():
            cfg = build_sample_biomass_config("sample_gasifier_250kw", fuel_preset=preset_name)
            BiomassComponent(cfg).validate()
            fp = cfg.effective_fuel_params
            assert fp.fuel_name == expected["fuel_name"]
            assert fp.lhv_effective_mj_per_kg == pytest.approx(expected["lhv_mj_per_kg"])
            assert fp.fuel_price_per_ton == pytest.approx(expected["fuel_price_per_ton"])

        overridden = build_sample_biomass_config(
            "sample_gasifier_250kw",
            fuel_preset="wood_pellet",
            fuel_price_per_ton=2050000.0,
            moisture_fraction=0.09,
        )
        fp_ov = overridden.effective_fuel_params
        assert fp_ov.fuel_price_per_ton == pytest.approx(2050000.0)
        assert fp_ov.moisture_fraction == pytest.approx(0.09)
        assert fp_ov.lhv_effective_mj_per_kg == pytest.approx(17.5)

    def test_both_plant_samples_validate_via_resolve_biomass_config(self):
        for sample_name in BIOMASS_PLANT_SAMPLES:
            cfg = resolve_biomass_config({"plant_sample": sample_name, "fuel_preset": "pks"})
            BiomassComponent(cfg).validate()
            assert cfg.rated_capacity_kw > 0.0


class TestBiomassFuelCurvesAndLHV:
    def test_dry_lhv_conversion_matches_hand_calculation(self):
        # lhv_dry = 18.0 MJ/kg, moisture = 0.40 => 18.0 * 0.60 - 2.443 * 0.40 = 10.8 - 0.9772 = 9.8228 MJ/kg
        cfg = build_sample_biomass_config(
            "sample_gasifier_250kw",
            fuel_preset="custom",
            fuel_name="EFB Kering [REAL DATA]",
            lhv_mj_per_kg=18.0,
            lhv_basis="dry",
            moisture_fraction=0.40,
        )
        expected_lhv = 18.0 * (1.0 - 0.40) - WATER_LATENT_HEAT_MJ_PER_KG * 0.40
        assert cfg.effective_fuel_params.lhv_effective_mj_per_kg == pytest.approx(expected_lhv, rel=1e-12)

    def test_three_fuel_curve_models_match_hand_calculation(self):
        # 1. piecewise_heat_rate pada beban 57.5% (tengah 0.40 -> 16500 dan 0.75 -> 14200 => hr = 15350 kJ/kWh)
        cfg_hr = build_sample_biomass_config("sample_gasifier_250kw", fuel_preset="pks")
        comp_hr = BiomassComponent(cfg_hr)
        p_kw = 0.575 * 250.0  # 143.75 kW
        expected_mj = (15350.0 * p_kw * 1.0) / 1000.0
        expected_tons = (expected_mj / 16.5) / 1000.0
        assert comp_hr.fuel_tons_for_power_kw(p_kw, 1.0) == pytest.approx(expected_tons, rel=1e-12)

        # 2. piecewise_efficiency pada efisiensi 0.25 => hr = 3600 / 0.25 = 14400 kJ/kWh
        cfg_eff = BiomassConfig(
            rated_capacity_kw=200.0,
            min_load_fraction=0.50,
            ramp_up_kw_per_hour=100.0,
            ramp_down_kw_per_hour=100.0,
            fuel_curve_model="piecewise_efficiency",
            fuel_curve_points=((0.50, 0.25), (1.00, 0.25)),
            fuel_preset="pks",
        )
        comp_eff = BiomassComponent(cfg_eff)
        expected_mj_eff = (14400.0 * 150.0 * 1.0) / 1000.0
        assert comp_eff.fuel_energy_mj_for_power_kw(150.0, 1.0) == pytest.approx(expected_mj_eff, rel=1e-12)

        # 3. willans_linear: thermal_kw = 40 + 3.2 * 100 = 360 kW_th => 360 * 3.6 * 1.0 = 1296 MJ
        cfg_wil = BiomassConfig(
            rated_capacity_kw=200.0,
            min_load_fraction=0.40,
            ramp_up_kw_per_hour=100.0,
            ramp_down_kw_per_hour=100.0,
            fuel_curve_model="willans_linear",
            no_load_fuel_kw_th=40.0,
            slope_kw_th_per_kw_el=3.2,
            fuel_preset="pks",
        )
        comp_wil = BiomassComponent(cfg_wil)
        assert comp_wil.fuel_energy_mj_for_power_kw(100.0, 1.0) == pytest.approx(1296.0, rel=1e-12)


class TestBiomassStateMachineAndInvariants:
    def test_startup_min_up_min_down_ramp_and_shutdown_sequence(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_dummy_weather(tc)
        cfg = BiomassConfig(
            rated_capacity_kw=250.0,
            min_load_fraction=0.40,
            ramp_up_kw_per_hour=75.0,
            ramp_down_kw_per_hour=75.0,
            startup_time_hours=1.0,
            shutdown_time_hours=2.0,
            min_up_time_hours=3.0,
            min_down_time_hours=2.0,
            startup_fuel_tons=0.25,
            startup_cost=100000.0,
            fuel_curve_model="piecewise_heat_rate",
            fuel_curve_points=((0.40, 16000.0), (1.00, 13000.0)),
            fuel_preset="pks",
        )
        comp = BiomassComponent(cfg)
        state = comp.initial_state()

        # t=0: Start => status starting, daya listrik = 0, startup_fuel & startup_cost tercatat.
        r0 = comp.step(0, 200.0, weather, state, start_request=True)
        state = r0.state_out
        assert state["status"] == "starting"
        assert r0.generation_kw == 0.0
        assert state["last_step_fuel_tons"] == pytest.approx(0.25)
        assert state["last_step_startup_cost"] == pytest.approx(100000.0)

        # t=1: Mulai running; min_load = 100 kW (> ramp_up 75), masuk di 100 kW.
        r1 = comp.step(1, 220.0, weather, state)
        state = r1.state_out
        assert state["status"] == "running"
        assert r1.generation_kw == pytest.approx(100.0)

        # t=2: Ramp up maks +75 -> 175 kW. Minta stop pada t=2 ditolak karena baru 1 jam < min_up 3 jam.
        r2 = comp.step(2, 0.0, weather, state, stop_request=True)
        state = r2.state_out
        assert state["status"] == "running"
        assert r2.generation_kw == pytest.approx(100.0)  # ramp down dari 100 dibatasi min_load 100

        # t=3: Jam ke-3 running, ramp up ke 175 kW.
        r3 = comp.step(3, 250.0, weather, state)
        state = r3.state_out
        assert r3.generation_kw == pytest.approx(175.0)

        # t=4: Sekarang hours_running_continuous = 3.0 >= min_up 3.0, stop_request diizinkan -> stopping (2 jam).
        r4 = comp.step(4, 0.0, weather, state, stop_request=True)
        state = r4.state_out
        assert state["status"] == "stopping"
        assert r4.generation_kw == 0.0

        # t=5: Jam ke-2 stopping => selesai menjadi off di akhir t=5.
        r5 = comp.step(5, 0.0, weather, state)
        state = r5.state_out
        assert state["status"] == "off"
        assert r5.generation_kw == 0.0

        # t=6: Cek min_down_time_hours=2.0 -> hours_stopped_continuous sudah 2.0 (t=4 dan t=5), boleh start lagi.
        limits = comp.inspect_step_limits(6, weather, state)
        assert limits["can_start"] is True

    def test_scheduled_and_unplanned_outages_are_deterministic(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        cfg1 = build_sample_biomass_config(
            "sample_gasifier_250kw",
            fuel_preset="efb",
            scheduled_outage_windows=(
                ScheduledOutageWindow(start_day=10, end_day=11),
                ScheduledOutageWindow(start_hour_of_year=2400.0, end_hour_of_year=2412.0),
            ),
            unplanned_outage_rate=0.05,
            mean_time_to_repair_hours=6.0,
            outage_seed=123,
        )
        cfg2 = build_sample_biomass_config(
            "sample_gasifier_250kw",
            fuel_preset="efb",
            scheduled_outage_windows=(
                ScheduledOutageWindow(start_day=10, end_day=11),
                ScheduledOutageWindow(start_hour_of_year=2400.0, end_hour_of_year=2412.0),
            ),
            unplanned_outage_rate=0.05,
            mean_time_to_repair_hours=6.0,
            outage_seed=123,
        )
        s1, u1 = BiomassComponent(cfg1).prepare_outage_masks(tc)
        s2, u2 = BiomassComponent(cfg2).prepare_outage_masks(tc)
        assert np.array_equal(s1, s2)
        assert np.array_equal(u1, u2)
        assert int(np.sum(s1)) == 48 + 12
        assert int(np.sum(u1)) > 0

    def test_supply_quota_resets_and_triggers_forced_stop_without_exceeding_limit(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_dummy_weather(tc)
        cfg = build_sample_biomass_config(
            "sample_gasifier_250kw",
            fuel_preset="pks",
            startup_time_hours=0.0,
            shutdown_time_hours=0.0,
            min_up_time_hours=10.0,
            min_down_time_hours=0.0,
            supply_period="daily",
            supply_limit_tons=0.35,  # Cukup sekitar ~3 jam di 100-150 kW, tidak cukup 24 jam.
            unplanned_outage_rate=0.0,
        )
        comp = BiomassComponent(cfg)
        state = comp.initial_state()

        daily_tons = [0.0, 0.0]
        forced_stops = 0
        for t in range(48):
            res = comp.step(t, 200.0, weather, state, start_request=(state["status"] == "off"))
            state = res.state_out
            day_idx = t // 24
            daily_tons[day_idx] += float(state["last_step_fuel_tons"])
            if state["last_step_forced_stop"]:
                forced_stops += 1

        assert forced_stops >= 1
        assert daily_tons[0] <= 0.35 + 1e-12
        assert daily_tons[1] <= 0.35 + 1e-12
        assert daily_tons[1] > 0.0  # Kuota hari ke-2 di-reset sehingga unit menyala kembali.

    def test_overhaul_lifecycle_event_emissions_and_chp(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_dummy_weather(tc)
        cfg = BiomassConfig(
            rated_capacity_kw=200.0,
            min_load_fraction=0.50,
            ramp_up_kw_per_hour=200.0,
            ramp_down_kw_per_hour=200.0,
            fuel_curve_model="piecewise_heat_rate",
            fuel_curve_points=((0.50, 14400.0), (1.00, 14400.0)),
            fuel_preset="pks",
            overhaul_interval_operating_hours=3.0,
            overhaul_cost=50000000.0,
            emission_factor_kg_co2e_per_kwh=0.80,
            biogenic_co2_accounting="gross",
            chp_enabled=True,
            heat_to_power_ratio=1.5,
        )
        comp = BiomassComponent(cfg)
        state = comp.initial_state(year=2)
        for t in range(4):
            res = comp.step(t, 100.0, weather, state, start_request=(t == 0))
            state = res.state_out
        assert state["overhaul_count"] == 1
        events = comp.lifecycle_events(year=2)
        assert len(events) == 1
        assert events[0].event_type == "biomass_overhaul"
        assert events[0].cost_amount == pytest.approx(50000000.0)
        assert state["thermal_output_kw_th"] == pytest.approx(150.0)
        # Mode gross mencakup emisi pembakaran (0.80 * 400 kWh = 320 kg) + rantai pasok (> 0).
        assert state["co2e_emitted_kg"] > 320.0

    @pytest.mark.parametrize("step_minutes", [60, 30])
    def test_property_all_six_physical_invariants_across_full_year(self, step_minutes):
        tc = TimeConfig(step_minutes=step_minutes, timezone="Asia/Jakarta")
        weather = _make_dummy_weather(tc)
        dt = tc.step_hours

        cfg = build_sample_biomass_config(
            "sample_gasifier_250kw",
            fuel_preset="efb",
            supply_period="monthly",
            supply_limit_tons=140.0,
            scheduled_outage_windows=(ScheduledOutageWindow(start_day=180, end_day=182),),
            unplanned_outage_rate=0.04,
            mean_time_to_repair_hours=4.0,
            outage_seed=99,
        )
        comp = BiomassComponent(cfg)
        scheduled, unplanned = comp.prepare_outage_masks(tc)
        state = comp.initial_state()
        min_kw = cfg.effective_min_load_kw

        rng = np.random.default_rng(7)
        monthly_tons: dict[int, float] = {}
        months = tc.month_indices()

        prev_status = state["status"]
        prev_power = float(state["current_power_kw"])
        prev_run_hrs = float(state["hours_running_continuous"])
        prev_stop_hrs = float(state["hours_stopped_continuous"])

        for t in range(tc.steps_per_year):
            cmd = float(rng.choice([0.0, 80.0, 140.0, 220.0, 280.0]))
            want_start = cmd > 0.0 and prev_status == "off"
            want_stop = cmd == 0.0 and prev_status == "running"
            res = comp.step(t, cmd, weather, state, start_request=want_start, stop_request=want_stop)
            state = res.state_out
            new_status = str(state["status"])
            out_kw = float(res.generation_kw)
            forced_stop = bool(state["last_step_forced_stop"])

            # Invarian 4: status non-running selalu menghasilkan 0.0 kW.
            if new_status in ("off", "starting", "stopping", "outage"):
                assert out_kw == 0.0

            # Invarian 1: status running selalu dalam [min_load_kw, rated_capacity_kw].
            if new_status == "running":
                assert min_kw - 1e-9 <= out_kw <= cfg.rated_capacity_kw + 1e-9

            # Invarian 2: batas ramp rate saat transisi running -> running.
            if prev_status == "running" and new_status == "running":
                delta = out_kw - prev_power
                assert -cfg.ramp_down_kw_per_hour * dt - 1e-9 <= delta <= cfg.ramp_up_kw_per_hour * dt + 1e-9

            # Invarian 3: min_up_time dan min_down_time dipatuhi pada transisi normal.
            if prev_status == "off" and new_status in ("starting", "running"):
                assert prev_stop_hrs + 1e-9 >= cfg.min_down_time_hours
            if prev_status == "running" and new_status in ("stopping", "off") and not forced_stop:
                assert prev_run_hrs + 1e-9 >= cfg.min_up_time_hours

            # Konsistensi outage mask.
            if scheduled[t] or unplanned[t]:
                assert new_status == "outage"
                assert out_kw == 0.0

            m = int(months[t])
            monthly_tons[m] = monthly_tons.get(m, 0.0) + float(state["last_step_fuel_tons"])

            prev_status = new_status
            prev_power = out_kw
            prev_run_hrs = float(state["hours_running_continuous"])
            prev_stop_hrs = float(state["hours_stopped_continuous"])

        # Invarian 5: kuota pasokan tiap bulan tidak pernah terlampaui.
        for used in monthly_tons.values():
            assert used <= 140.0 + 1e-9
