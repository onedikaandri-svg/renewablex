"""Skrip benchmark performa berulang untuk mesin hitung hybrid RenewableX (Tahap 8A)."""

from __future__ import annotations

from pathlib import Path
import sys
import time
from typing import Callable

import numpy as np

ENGINE_ROOT = Path(__file__).resolve().parent.parent
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from app.hybrid.bess import BESSConfig
from app.hybrid.biomass import build_sample_biomass_config
from app.hybrid.dispatch import DispatchConfig
from app.hybrid.finance import FinanceConfig, run_financial_analysis
from app.hybrid.lifetime import LifetimeConfig, run_lifetime_simulation
from app.hybrid.load import generate_synthetic_load
from app.hybrid.pv_detailed import PVDetailedConfig
from app.hybrid.sensitivity import run_hybrid_sensitivity
from app.hybrid.simulator import SimulationConfig, run_simulation
from app.hybrid.sweep import run_hybrid_sweep
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset, WeatherMetadata


def _build_benchmark_inputs():
    tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
    n = tc.steps_per_year
    hrs = tc.hour_of_day()
    days = tc.day_indices()
    ghi = np.maximum(
        0.0,
        900.0 * np.sin(np.pi * np.clip((hrs - 6.0) / 12.0, 0.0, 1.0)),
    ) * (0.85 + 0.15 * np.sin(2.0 * np.pi * days / 365.0))
    weather = WeatherDataset(
        time_config=tc,
        metadata=WeatherMetadata(
            provider="benchmark",
            dataset="synthetic_clear",
            dataset_version="1.0",
            period="benchmark",
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
    lp = generate_synthetic_load(
        base_load_kw=120.0,
        peak_load_kw=350.0,
        time_config=tc,
        seed=42,
        noise_fraction=0.05,
    )
    pv_cfg = PVDetailedConfig(
        capacity_kwp=500.0,
        inverter_ac_kw=420.0,
        transposition_model="perez",
        tracking_mode="fixed",
        tilt_degrees=10.0,
        azimuth_degrees=0.0,
        cell_temp_model="faiman",
        dc_model="pvwatts",
        annual_degradation_fraction=0.005,
    )
    pv_sd = PVDetailedConfig(
        capacity_kwp=500.0,
        inverter_ac_kw=420.0,
        transposition_model="perez",
        tracking_mode="fixed",
        tilt_degrees=10.0,
        azimuth_degrees=0.0,
        cell_temp_model="faiman",
        dc_model="single_diode",
        annual_degradation_fraction=0.005,
    )
    bess_cfg = BESSConfig(
        nominal_capacity_kwh=600.0,
        max_charge_kw=300.0,
        max_discharge_kw=300.0,
        soc_min_fraction=0.20,
        soc_max_fraction=0.95,
        initial_soc_fraction=0.50,
        replacement_cost=1_800_000_000.0,
    )
    bio_cfg = build_sample_biomass_config(
        sample_name="sample_gasifier_250kw",
        fuel_preset="efb",
        supply_period="monthly",
        supply_limit_tons=220.0,
        overhaul_cost=150_000_000.0,
    )
    disp_cfg = DispatchConfig(
        strategy="load_following",
        allow_grid_import=False,
        allow_grid_export=False,
    )
    fin_cfg = FinanceConfig(
        currency_code="IDR",
        discount_rate=0.10,
        tariff_escalation_rate=0.02,
        om_escalation_rate=0.02,
        fuel_escalation_rate=0.02,
        electricity_tariff_per_kwh=1445.0,
        pv_capex_per_kwp=11_500_000.0,
        bess_capex_per_kwh=3_500_000.0,
        biomass_capex_per_kw=18_000_000.0,
        pv_om_fraction_of_capex=0.015,
        bess_fixed_om_per_kwh_year=50_000.0,
        grid_emission_factor_kg_co2e_per_kwh=0.78,
    )
    return tc, weather, lp, pv_cfg, pv_sd, bess_cfg, bio_cfg, disp_cfg, fin_cfg


def _measure_ms(fn: Callable[[], object], runs: int = 3) -> float:
    fn()
    timings: list[float] = []
    for _ in range(runs):
        t0 = time.perf_counter()
        fn()
        timings.append((time.perf_counter() - t0) * 1000.0)
    timings.sort()
    return timings[len(timings) // 2]


def main() -> None:
    tc, weather, lp, pv_cfg, pv_sd, bess_cfg, bio_cfg, disp_cfg, fin_cfg = _build_benchmark_inputs()

    sim_pv_bess = SimulationConfig(
        project_name="BenchPVB",
        time_config=tc,
        pv=pv_cfg,
        contract_version="0.6",
        bess=bess_cfg,
        dispatch=disp_cfg,
        biomass=None,
    )
    sim_full = SimulationConfig(
        project_name="BenchFull",
        time_config=tc,
        pv=pv_cfg,
        contract_version="0.6",
        bess=bess_cfg,
        dispatch=disp_cfg,
        biomass=bio_cfg,
    )
    sim_sd = SimulationConfig(
        project_name="BenchSD",
        time_config=tc,
        pv=pv_sd,
        contract_version="0.6",
        bess=bess_cfg,
        dispatch=disp_cfg,
        biomass=bio_cfg,
    )
    lt_scaled = LifetimeConfig(
        project_lifetime_years=25,
        multi_year_mode="scaled_year_1",
        inverter_replacement_year=13,
        inverter_replacement_cost=420_000_000.0,
    )
    lt_full = LifetimeConfig(
        project_lifetime_years=25,
        multi_year_mode="full_hourly",
        inverter_replacement_year=13,
        inverter_replacement_cost=420_000_000.0,
    )

    results = [
        ("1y PV + BESS (tanpa Biomass)", _measure_ms(lambda: run_simulation(sim_pv_bess, weather, lp), runs=3)),
        ("1y PV + BESS + Biomass (pvwatts DC)", _measure_ms(lambda: run_simulation(sim_full, weather, lp), runs=3)),
        ("1y PV + BESS + Biomass (single_diode DC)", _measure_ms(lambda: run_simulation(sim_sd, weather, lp), runs=3)),
        (
            "25y scaled_year_1 + Keuangan",
            _measure_ms(
                lambda: run_financial_analysis(run_lifetime_simulation(sim_full, weather, lp, lt_scaled), fin_cfg),
                runs=3,
            ),
        ),
        (
            "25y full_hourly + Keuangan",
            _measure_ms(
                lambda: run_financial_analysis(run_lifetime_simulation(sim_full, weather, lp, lt_full), fin_cfg),
                runs=1,
            ),
        ),
        (
            "Sapuan 64 kombinasi (4x4x4, scaled_year_1)",
            _measure_ms(
                lambda: run_hybrid_sweep(
                    base_sim_config=sim_full,
                    weather=weather,
                    load_profile=lp,
                    base_lifetime_config=lt_scaled,
                    base_finance_config=fin_cfg,
                    pv_values=[300.0, 500.0, 700.0, 900.0],
                    bess_values=[0.0, 400.0, 600.0, 800.0],
                    biomass_values=[0.0, 150.0, 250.0, 350.0],
                ),
                runs=1,
            ),
        ),
        (
            "Sensitivitas 6 variabel + Matriks 5x5",
            _measure_ms(
                lambda: run_hybrid_sensitivity(
                    base_sim_config=sim_full,
                    weather=weather,
                    load_profile=lp,
                    base_lifetime_config=lt_scaled,
                    base_finance_config=fin_cfg,
                    matrix={
                        "x_variable": "capex_total",
                        "x_shifts": [-0.2, -0.1, 0.0, 0.1, 0.2],
                        "y_variable": "electricity_tariff",
                        "y_shifts": [-0.2, -0.1, 0.0, 0.1, 0.2],
                    },
                ),
                runs=1,
            ),
        ),
    ]

    print("Benchmark Mesin Hybrid RenewableX (ms)")
    print("-" * 64)
    for label, ms in results:
        print(f"{label:<46} {ms:>10.1f} ms")


if __name__ == "__main__":
    main()
