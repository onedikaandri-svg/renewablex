"""Tes kesetaraan numerik dan keamanan cache untuk optimasi performa Tahap 8A."""

import numpy as np
import pytest

from app.hybrid.bess import BESSConfig
from app.hybrid.biomass import BiomassComponent, BiomassConfig, build_sample_biomass_config
from app.hybrid.dispatch import DispatchConfig
from app.hybrid.finance import FinanceConfig, run_financial_analysis
from app.hybrid.lifetime import LifetimeConfig, run_lifetime_simulation, run_scaled_lifetime_from_year_1
from app.hybrid.load import generate_synthetic_load
from app.hybrid.pv_detailed import PVDetailedConfig
from app.hybrid.sensitivity import run_hybrid_sensitivity
from app.hybrid.simulator import BALANCE_TOLERANCE_KW, SimulationConfig, run_simulation
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset, WeatherMetadata


def _sample_weather(tc: TimeConfig) -> WeatherDataset:
    n = tc.steps_per_year
    hrs = tc.hour_of_day()
    days = tc.day_indices()
    ghi = np.maximum(0.0, 900.0 * np.sin(np.pi * np.clip((hrs - 6.0) / 12.0, 0.0, 1.0))) * (
        0.85 + 0.15 * np.sin(2.0 * np.pi * days / 365.0)
    )
    return WeatherDataset(
        time_config=tc,
        metadata=WeatherMetadata(
            provider="test",
            dataset="synthetic",
            dataset_version="1.0",
            period="test",
            latitude=-6.28,
            longitude=107.15,
            elevation_m=25.0,
            timezone="Asia/Jakarta",
            timezone_offset_hours=7.0,
            retrieved_at="2026-11-26T00:00:00+00:00",
        ),
        ghi_w_m2=ghi,
        dni_w_m2=ghi * 0.72,
        dhi_w_m2=ghi * 0.28,
        temp_air_c=26.0 + 6.0 * np.sin(np.pi * np.clip((hrs - 6.0) / 12.0, 0.0, 1.0)),
        wind_speed_m_s=np.full(n, 2.2),
    )


def test_time_config_cached_arrays_are_readonly_and_exact() -> None:
    tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
    d1 = tc.day_indices()
    d2 = tc.day_indices()
    m1 = tc.month_indices()
    h1 = tc.hour_of_day()

    assert d1 is d2
    assert d1.flags.writeable is False
    assert m1.flags.writeable is False
    assert h1.flags.writeable is False
    assert len(d1) == 8760
    assert int(m1[0]) == 1 and int(m1[-1]) == 12
    with pytest.raises(ValueError):
        d1[0] = 99


def test_biomass_pure_python_curve_matches_numpy_interp() -> None:
    for model, pts in (
        ("piecewise_heat_rate", ((0.40, 16500.0), (0.75, 14200.0), (1.00, 13500.0))),
        ("piecewise_efficiency", ((0.40, 0.22), (0.75, 0.26), (1.00, 0.28))),
    ):
        cfg = BiomassConfig(
            rated_capacity_kw=250.0,
            min_load_fraction=0.40,
            ramp_up_kw_per_hour=125.0,
            ramp_down_kw_per_hour=125.0,
            fuel_curve_model=model,
            fuel_curve_points=pts,
            fuel_preset="efb",
        )
        comp = BiomassComponent(cfg)
        xs = np.array([pt[0] for pt in pts], dtype=np.float64)
        ys = np.array([pt[1] for pt in pts], dtype=np.float64)
        if model == "piecewise_efficiency":
            ys = 3600.0 / ys

        for frac in (0.20, 0.40, 0.55, 0.75, 0.88, 1.00, 1.15):
            got = comp._heat_rate_kj_per_kwh(frac)
            expected = float(np.interp(min(max(frac, xs[0]), xs[-1]), xs, ys))
            assert abs(got - expected) <= 1e-12


def test_biomass_precomputed_limits_step_matches_unprecomputed_step() -> None:
    tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
    weather = _sample_weather(tc)
    cfg = build_sample_biomass_config(
        sample_name="sample_gasifier_250kw",
        fuel_preset="efb",
        supply_period="monthly",
        supply_limit_tons=220.0,
    )
    comp_fast = BiomassComponent(cfg)
    comp_ref = BiomassComponent(cfg)
    s_fast = comp_fast.initial_state()
    s_ref = comp_ref.initial_state()

    for t in range(48):
        cmd = 180.0 if (t % 24) >= 10 else 0.0
        limits = comp_fast.inspect_step_limits(t, weather, s_fast)
        r_fast = comp_fast.step(t, cmd, weather, s_fast, start_request=(cmd > 0), stop_request=(cmd == 0), precomputed_limits=limits)
        r_ref = comp_ref.step(t, cmd, weather, s_ref, start_request=(cmd > 0), stop_request=(cmd == 0))
        assert abs(r_fast.generation_kw - r_ref.generation_kw) <= 1e-12
        assert r_fast.state_out == r_ref.state_out
        s_fast = r_fast.state_out
        s_ref = r_ref.state_out


def test_sensitivity_scaled_degradation_fast_path_matches_full_simulation() -> None:
    tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
    weather = _sample_weather(tc)
    lp = generate_synthetic_load(base_load_kw=120.0, peak_load_kw=350.0, time_config=tc, seed=42, noise_fraction=0.05)

    sim_cfg = SimulationConfig(
        project_name="TestFastPath",
        time_config=tc,
        pv=PVDetailedConfig(
            capacity_kwp=500.0,
            inverter_ac_kw=420.0,
            transposition_model="perez",
            tracking_mode="fixed",
            tilt_degrees=10.0,
            azimuth_degrees=0.0,
            cell_temp_model="faiman",
            dc_model="pvwatts",
            annual_degradation_fraction=0.005,
        ),
        contract_version="0.6",
        bess=BESSConfig(nominal_capacity_kwh=600.0, max_charge_kw=300.0, max_discharge_kw=300.0),
        dispatch=DispatchConfig(strategy="load_following"),
        biomass=build_sample_biomass_config(
            sample_name="sample_gasifier_250kw",
            fuel_preset="efb",
            supply_period="monthly",
            supply_limit_tons=220.0,
        ),
    )
    lt_cfg = LifetimeConfig(
        project_lifetime_years=25,
        multi_year_mode="scaled_year_1",
        inverter_replacement_year=13,
        inverter_replacement_cost=420_000_000.0,
    )
    fin_cfg = FinanceConfig(
        currency_code="IDR",
        discount_rate=0.10,
        electricity_tariff_per_kwh=1445.0,
        pv_capex_per_kwp=11_500_000.0,
        bess_capex_per_kwh=3_500_000.0,
        biomass_capex_per_kw=18_000_000.0,
    )

    sim_res = run_simulation(sim_cfg, weather, lp)
    assert sim_res.summary.max_balance_error_kw <= BALANCE_TOLERANCE_KW
    assert len(sim_res.daily) == 365
    assert len(sim_res.monthly) == 12

    lt_direct = run_lifetime_simulation(sim_cfg, weather, lp, lt_cfg)
    lt_reused = run_scaled_lifetime_from_year_1(sim_cfg, sim_res, lt_cfg)
    assert lt_direct.total_pv_generation_kwh == pytest.approx(lt_reused.total_pv_generation_kwh, abs=1e-12)
    assert lt_direct.total_served_load_kwh == pytest.approx(lt_reused.total_served_load_kwh, abs=1e-12)

    fast_sens = run_hybrid_sensitivity(
        base_sim_config=sim_cfg,
        weather=weather,
        load_profile=lp,
        base_lifetime_config=lt_cfg,
        base_finance_config=fin_cfg,
        variables=["pv_degradation_rate"],
        shifts=[-0.20, 0.20],
        force_full_simulation=False,
    )
    full_sens = run_hybrid_sensitivity(
        base_sim_config=sim_cfg,
        weather=weather,
        load_profile=lp,
        base_lifetime_config=lt_cfg,
        base_finance_config=fin_cfg,
        variables=["pv_degradation_rate"],
        shifts=[-0.20, 0.20],
        force_full_simulation=True,
    )
    assert fast_sens["variables"][0]["cases"] == full_sens["variables"][0]["cases"]
