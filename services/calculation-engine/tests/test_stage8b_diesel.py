"""Tes unit, integrasi, keuangan, sapuan, ekspor Excel, dan API Tahap 8B (Diesel Generator)."""

import copy
from io import BytesIO
from unittest.mock import patch

from fastapi.testclient import TestClient
import numpy as np
from openpyxl import load_workbook
import pytest

from app.errors import EngineError
from app.hybrid.bess import BESSConfig
from app.hybrid.biomass import build_sample_biomass_config
from app.hybrid.components import PVWattsConfig
from app.hybrid.diesel import DieselComponent, DieselConfig, resolve_diesel_config
from app.hybrid.dispatch import (
    DispatchConfig,
    DispatchContext,
    CycleChargingStrategy,
    LoadFollowingStrategy,
)
from app.hybrid.excel_export import build_hybrid_excel_bytes
from app.hybrid.finance import FinanceConfig, run_financial_analysis
from app.hybrid.lifetime import LifetimeConfig, run_lifetime_simulation
from app.hybrid.load import generate_synthetic_load
from app.hybrid.sensitivity import run_hybrid_sensitivity
from app.hybrid.simulator import SimulationConfig, run_simulation
from app.hybrid.sweep import run_hybrid_sweep
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset, WeatherMetadata
from app.main import app
from app.version import ENGINE_VERSION

client = TestClient(app)


def _make_weather(steps: int = 8760) -> WeatherDataset:
    tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
    hrs = tc.hour_of_day()
    daytime = (hrs >= 6) & (hrs <= 17)
    ghi = np.where(daytime, 650.0 * np.sin(np.pi * np.clip((hrs - 6) / 11.0, 0.0, 1.0)), 0.0)
    dni = np.where(daytime, ghi * 0.72, 0.0)
    dhi = np.where(daytime, ghi * 0.28, 0.0)
    temp = 26.0 + 5.0 * np.sin(np.pi * np.clip((hrs - 6) / 14.0, 0.0, 1.0))
    wind = np.full(steps, 2.2, dtype=np.float64)
    return WeatherDataset(
        time_config=tc,
        ghi_w_m2=ghi,
        dni_w_m2=dni,
        dhi_w_m2=dhi,
        temp_air_c=temp,
        wind_speed_m_s=wind,
        metadata=WeatherMetadata(
            provider="pvgis",
            dataset="PVGIS-ERA5",
            dataset_version="v5_3",
            period="2005-2023",
            latitude=-6.28,
            longitude=107.15,
            elevation_m=25.0,
            timezone="Asia/Jakarta",
            timezone_offset_hours=7.0,
            retrieved_at="2026-11-26T00:00:00+00:00",
        ),
    )


def test_diesel_component_validation_and_fuel_curves():
    # Penolakan konfigurasi tidak sah
    with pytest.raises(EngineError) as exc_cap:
        DieselComponent(DieselConfig(rated_capacity_kw=0.0)).validate()
    assert exc_cap.value.code == "invalid_diesel_config"

    with pytest.raises(EngineError) as exc_ren:
        DieselComponent(DieselConfig(rated_capacity_kw=200.0, is_renewable=True)).validate()
    assert exc_ren.value.code == "invalid_diesel_config"

    with pytest.raises(EngineError) as exc_curve:
        DieselComponent(
            DieselConfig(
                rated_capacity_kw=200.0,
                min_load_fraction=0.30,
                fuel_curve_model="piecewise_sfc",
                fuel_curve_points=((0.40, 0.30), (1.00, 0.25)),
            )
        ).validate()
    assert exc_curve.value.code == "invalid_diesel_config"

    # Model willans_linear dengan no_load default 0.08 * rated_kw = 16 L/jam
    cfg_lin = resolve_diesel_config({"enabled": True, "rated_capacity_kw": 200.0})
    comp_lin = DieselComponent(cfg_lin)
    comp_lin.validate()
    assert cfg_lin.effective_no_load_fuel_lph == pytest.approx(16.0)
    # Pada 100 kW, 1 jam: 16 + 0.25 * 100 = 41.0 liter
    assert comp_lin.fuel_liters_for_power_kw(100.0, 1.0) == pytest.approx(41.0)
    assert comp_lin.fuel_liters_for_power_kw(0.0, 1.0) == 0.0

    # Model piecewise_sfc
    cfg_pw = DieselConfig(
        rated_capacity_kw=200.0,
        min_load_fraction=0.30,
        fuel_curve_model="piecewise_sfc",
        fuel_curve_points=((0.30, 0.32), (0.75, 0.26), (1.00, 0.27)),
    )
    comp_pw = DieselComponent(cfg_pw)
    comp_pw.validate()
    # Pada 150 kW (load_frac=0.75): 0.26 * 150 = 39.0 liter/jam
    assert comp_pw.fuel_liters_for_power_kw(150.0, 1.0) == pytest.approx(39.0)


def test_diesel_runtime_constraints_and_overhaul_lifecycle():
    weather = _make_weather()
    cfg = DieselConfig(
        rated_capacity_kw=100.0,
        min_load_fraction=0.30,
        min_run_time_hours=3.0,
        min_down_time_hours=2.0,
        startup_cost=50_000.0,
        overhaul_interval_operating_hours=4.0,
        overhaul_cost=10_000_000.0,
    )
    comp = DieselComponent(cfg)
    st = comp.initial_state(year=1)

    # Langkah 0: command 10 kW < min_load 30 kW -> menyala pada 30 kW, startup_count = 1
    r0 = comp.step(0, 10.0, weather, st)
    st = r0.state_out
    assert r0.generation_kw == pytest.approx(30.0)
    assert st["startup_count"] == 1
    assert st["last_step_startup_cost"] == pytest.approx(50_000.0)

    # Langkah 1: command 0 kW, tetapi min_run_time_hours=3 -> tetap menyala 30 kW
    r1 = comp.step(1, 0.0, weather, st)
    st = r1.state_out
    assert r1.generation_kw == pytest.approx(30.0)
    assert st["status"] == "running"

    # Langkah 2: masih jam ke-3 -> tetap menyala; Langkah 3: boleh mati
    r2 = comp.step(2, 0.0, weather, st)
    st = r2.state_out
    assert r2.generation_kw == pytest.approx(30.0)

    r3 = comp.step(3, 0.0, weather, st)
    st = r3.state_out
    assert r3.generation_kw == 0.0
    assert st["status"] == "off"

    # Langkah 4: baru 1 jam mati < min_down_time_hours=2 -> tidak bisa start meski command 80 kW
    r4 = comp.step(4, 80.0, weather, st)
    st = r4.state_out
    assert r4.generation_kw == 0.0
    assert st["status"] == "off"

    # Langkah 5: sudah 2 jam mati -> bisa start lagi, mencapai total 4 jam operasi -> picu diesel_overhaul
    r5 = comp.step(5, 80.0, weather, st)
    st = r5.state_out
    assert r5.generation_kw == pytest.approx(80.0)
    assert st["startup_count"] == 2
    assert st["overhaul_count"] == 1
    assert len(comp.lifecycle_events(1)) == 1
    assert comp.lifecycle_events(1)[0].event_type == "diesel_overhaul"


def test_dispatch_priority_and_cycle_charging_with_diesel():
    # Urutan prioritas PV -> BESS -> Biomass -> Diesel -> Grid
    ctx = DispatchContext(
        step_idx=0,
        hour_of_day=20,
        month=1,
        load_kw=300.0,
        pv_available_kw=0.0,
        bess_soc=0.50,
        bess_max_charge_kw=100.0,
        bess_max_discharge_kw=80.0,
        allow_grid_import=True,
        biomass_status="off",
        biomass_available_kw=100.0,
        biomass_min_load_kw=40.0,
        biomass_can_start=True,
        diesel_status="off",
        diesel_available_kw=100.0,
        diesel_min_load_kw=30.0,
        diesel_can_start=True,
    )
    lf_dec = LoadFollowingStrategy().decide(ctx)
    # Defisit 300 kW: BESS 80 kW -> Biomass 100 kW -> Diesel 100 kW -> sisa 20 kW dari Grid Import
    assert lf_dec.bess_command_kw == pytest.approx(-80.0)
    assert lf_dec.biomass_command_kw == pytest.approx(100.0)
    assert lf_dec.diesel_command_kw == pytest.approx(100.0)
    assert lf_dec.grid_import_kw == pytest.approx(20.0)

    # Cycle charging: Diesel mengisi BESS menuju target SOC
    ctx_cc = DispatchContext(
        step_idx=1,
        hour_of_day=20,
        month=1,
        load_kw=100.0,
        pv_available_kw=0.0,
        bess_soc=0.40,
        bess_max_charge_kw=100.0,
        bess_max_discharge_kw=100.0,
        allow_grid_import=False,
        diesel_status="off",
        diesel_available_kw=250.0,
        diesel_min_load_kw=75.0,
        diesel_can_start=True,
    )
    cc_dec = CycleChargingStrategy(target_soc_fraction=0.80).decide(ctx_cc)
    assert cc_dec.diesel_command_kw == pytest.approx(200.0)
    assert cc_dec.bess_command_kw == pytest.approx(100.0)


@pytest.mark.parametrize(
    "strategy,extra",
    [
        ("self_consumption", {}),
        ("load_following", {}),
        ("cycle_charging", {"target_soc_fraction": 0.80}),
        ("peak_shaving", {"peak_limit_kw": 120.0, "allow_grid_import": True}),
        ("time_of_use_arbitrage", {"allow_grid_import": True}),
    ],
)
def test_simulator_closed_energy_balance_all_strategies_with_diesel(strategy: str, extra: dict):
    weather = _make_weather()
    tc = weather.time_config
    lp = generate_synthetic_load(base_load_kw=120.0, peak_load_kw=320.0, time_config=tc, seed=7)
    cfg = SimulationConfig(
        project_name="Uji Neraca Diesel",
        time_config=tc,
        pv=PVWattsConfig(capacity_kwp=200.0, inverter_ac_kw=180.0),
        contract_version="0.7",
        bess=BESSConfig(nominal_capacity_kwh=200.0, max_charge_kw=100.0, max_discharge_kw=100.0),
        biomass=build_sample_biomass_config(rated_capacity_kw=100.0),
        diesel=DieselConfig(rated_capacity_kw=200.0, min_load_fraction=0.30),
        dispatch=DispatchConfig(strategy=strategy, **extra),  # type: ignore[arg-type]
    )
    res = run_simulation(cfg, weather, lp)
    assert res.summary.max_balance_error_kw <= 1e-6
    assert res.diesel_summary is not None
    assert res.summary.diesel_generation_kwh == pytest.approx(res.diesel_summary.total_generation_kwh)


def test_diesel_is_non_renewable_in_renewable_fraction():
    weather = _make_weather()
    tc = weather.time_config
    # Matikan radiasi PV agar 100% beban dipasok Diesel (kWp sangat kecil 0.001 kWp dan radiasi 0)
    zero_weather = WeatherDataset(
        time_config=tc,
        ghi_w_m2=np.zeros(tc.steps_per_year),
        dni_w_m2=np.zeros(tc.steps_per_year),
        dhi_w_m2=np.zeros(tc.steps_per_year),
        temp_air_c=weather.temp_air_c,
        wind_speed_m_s=weather.wind_speed_m_s,
        metadata=weather.metadata,
    )
    lp = generate_synthetic_load(base_load_kw=100.0, peak_load_kw=100.0, time_config=tc, noise_fraction=0.0)
    cfg = SimulationConfig(
        project_name="Uji Non-Terbarukan Diesel",
        time_config=tc,
        pv=PVWattsConfig(capacity_kwp=1.0, inverter_ac_kw=1.0),
        contract_version="0.7",
        diesel=DieselConfig(rated_capacity_kw=200.0, min_load_fraction=0.30),
        dispatch=DispatchConfig(strategy="load_following"),
    )
    res = run_simulation(cfg, zero_weather, lp)
    assert res.summary.max_balance_error_kw <= 1e-6
    assert res.summary.pv_generation_kwh == 0.0
    assert res.summary.diesel_generation_kwh == pytest.approx(res.summary.served_load_kwh)
    assert res.summary.renewable_fraction == pytest.approx(0.0)


def test_lifetime_finance_sweep_sensitivity_and_excel_with_diesel():
    weather = _make_weather()
    tc = weather.time_config
    lp = generate_synthetic_load(base_load_kw=150.0, peak_load_kw=300.0, time_config=tc, seed=42)
    sim_cfg = SimulationConfig(
        project_name="Uji Keuangan Diesel",
        time_config=tc,
        pv=PVWattsConfig(capacity_kwp=300.0, inverter_ac_kw=250.0),
        contract_version="0.7",
        bess=BESSConfig(nominal_capacity_kwh=200.0, max_charge_kw=100.0, max_discharge_kw=100.0),
        diesel=DieselConfig(
            rated_capacity_kw=250.0,
            min_load_fraction=0.30,
            fuel_price_per_liter=18500.0,
            overhaul_interval_operating_hours=15000.0,
            overhaul_cost=120_000_000.0,
        ),
        dispatch=DispatchConfig(strategy="load_following"),
    )
    lt_cfg = LifetimeConfig(
        project_lifetime_years=3,
        multi_year_mode="full_hourly",
    )
    lt_res = run_lifetime_simulation(sim_cfg, weather, lp, lt_cfg)
    assert lt_res.total_diesel_generation_kwh > 0.0
    assert lt_res.max_balance_error_kw <= 1e-6

    fin_cfg = FinanceConfig(
        electricity_tariff_per_kwh=1445.0,
        pv_capex_per_kwp=11_500_000.0,
        bess_capex_per_kwh=3_500_000.0,
        diesel_capex_per_kw=4_500_000.0,
        diesel_overhaul_life_years=5.0,
    )
    fin_res = run_financial_analysis(lt_res, fin_cfg)
    assert fin_res.lcoe_breakdown.capex_diesel > 0.0
    assert fin_res.lcoe_breakdown.total == pytest.approx(fin_res.summary.lcoe, rel=1e-9)
    # Emisi proyek mencakup CO2e diesel
    assert fin_res.emissions.project_emissions_kg_co2e > 0.0

    # Sapuan dengan sumbu Diesel vs tanpa Diesel
    sw_legacy = run_hybrid_sweep(
        base_sim_config=sim_cfg,
        weather=weather,
        load_profile=lp,
        base_lifetime_config=LifetimeConfig(project_lifetime_years=2, multi_year_mode="scaled_year_1"),
        base_finance_config=fin_cfg,
        pv_values=[300.0],
        bess_values=[0.0],
        biomass_values=[0.0],
    )
    assert sw_legacy["combinations"][0]["combination_id"] == "pv300-bess0-bio0"

    sw_diesel = run_hybrid_sweep(
        base_sim_config=sim_cfg,
        weather=weather,
        load_profile=lp,
        base_lifetime_config=LifetimeConfig(project_lifetime_years=2, multi_year_mode="scaled_year_1"),
        base_finance_config=fin_cfg,
        pv_values=[300.0],
        bess_values=[200.0],
        biomass_values=[0.0],
        diesel_values=[0.0, 250.0],
    )
    assert sw_diesel["total_combinations"] == 2
    ids = {c["combination_id"] for c in sw_diesel["combinations"]}
    assert ids == {"pv300-bess200-bio0-dsl0", "pv300-bess200-bio0-dsl250"}

    # Sensitivitas harga solar diesel
    sens = run_hybrid_sensitivity(
        base_sim_config=sim_cfg,
        weather=weather,
        load_profile=lp,
        base_lifetime_config=LifetimeConfig(project_lifetime_years=2, multi_year_mode="scaled_year_1"),
        base_finance_config=fin_cfg,
        variables=["diesel_fuel_price", "capex_total"],
        shifts=[-0.2, 0.2],
    )
    diesel_var = next(v for v in sens["variables"] if v["variable"] == "diesel_fuel_price")
    assert not diesel_var["skipped"]
    assert diesel_var["max_abs_npv_delta"] > 0.0

    # Ekspor Excel
    sim_payload = {
        "engine_version": ENGINE_VERSION,
        "contract_version": "0.7",
        "project_name": "Uji Excel Diesel",
        "dispatch_strategy": "load_following",
        "weather_source": {"provider": "pvgis", "dataset": "PVGIS-ERA5", "period": "2005-2023", "latitude": -6.28, "longitude": 107.15, "timezone": "Asia/Jakarta"},
        "summary": {
            "total_load_kwh": lt_res.year_1_result.summary.total_load_kwh,
            "pv_generation_kwh": lt_res.year_1_result.summary.pv_generation_kwh,
            "biomass_generation_kwh": 0.0,
            "diesel_generation_kwh": lt_res.year_1_result.summary.diesel_generation_kwh,
            "served_load_kwh": lt_res.year_1_result.summary.served_load_kwh,
            "unmet_load_kwh": lt_res.year_1_result.summary.unmet_load_kwh,
            "curtailment_kwh": lt_res.year_1_result.summary.curtailment_kwh,
            "renewable_fraction": lt_res.year_1_result.summary.renewable_fraction,
            "pv_specific_yield_kwh_per_kwp": lt_res.year_1_result.summary.pv_specific_yield_kwh_per_kwp,
            "max_balance_error_kw": lt_res.year_1_result.summary.max_balance_error_kw,
        },
        "diesel_summary": {
            "total_fuel_liters": lt_res.year_1_result.diesel_summary.total_fuel_liters,
            "total_operating_hours": lt_res.year_1_result.diesel_summary.total_operating_hours,
            "total_co2e_kg": lt_res.year_1_result.diesel_summary.total_co2e_kg,
        },
        "monthly": [
            {
                "month": m,
                "load_kwh": 1000.0,
                "pv_generation_kwh": 600.0,
                "biomass_generation_kwh": 0.0,
                "diesel_generation_kwh": 400.0,
                "bess_charge_kwh": 0.0,
                "bess_discharge_kwh": 0.0,
                "grid_import_kwh": 0.0,
                "grid_export_kwh": 0.0,
                "served_load_kwh": 1000.0,
                "unmet_load_kwh": 0.0,
                "curtailment_kwh": 0.0,
            }
            for m in range(1, 13)
        ],
        "finance_summary": fin_res.to_summary_dict()["finance_summary"],
        "lcoe_breakdown": fin_res.to_summary_dict()["lcoe_breakdown"],
        "emissions_summary": fin_res.to_summary_dict()["emissions_summary"],
        "cashflow_schedule": fin_res.to_summary_dict()["cashflow_schedule"],
    }
    xlsx_bytes = build_hybrid_excel_bytes(
        project_config={"components": {"diesel": {"enabled": True, "emission_factor_kg_co2e_per_liter": 2.68}}, "finance": {"diesel_capex_per_kw": 4500000}},
        simulation_result=sim_payload,
        sweep_result=sw_diesel,
    )
    wb = load_workbook(BytesIO(xlsx_bytes))
    assert "Diesel (kWh)" in [wb["Energi_Bulanan"].cell(3, c).value for c in range(1, 13)]
    assert "Diesel (kW)" in [wb["Hasil_Sapuan"].cell(3, c).value for c in range(1, 13)]
    sum_labels = [wb["Ringkasan"].cell(r, 1).value for r in range(1, wb["Ringkasan"].max_row + 1)]
    assert "Produksi Diesel" in sum_labels
    assert "Konsumsi Solar Diesel" in sum_labels


@patch("app.api.hybrid._weather_provider.get_weather")
def test_api_v07_diesel_and_backward_compatibility(mock_get_weather):
    mock_get_weather.return_value = _make_weather()

    presets = client.get("/v1/hybrid/presets")
    assert presets.status_code == 200
    p_data = presets.json()
    assert p_data["engine_version"] == "0.7.0"
    assert "diesel_defaults" in p_data

    # Payload v0.7 lengkap dengan Diesel
    payload_v07 = copy.deepcopy(p_data["sample_config"])
    payload_v07["contract_version"] = "0.7"
    payload_v07["components"]["biomass"] = {"enabled": False}
    payload_v07["components"]["diesel"] = {
        "enabled": True,
        "rated_capacity_kw": 250.0,
        "min_load_fraction": 0.30,
        "fuel_price_per_liter": 18500.0,
        "overhaul_interval_operating_hours": 15000.0,
        "overhaul_cost": 120_000_000.0,
    }
    payload_v07["finance"]["diesel_capex_per_kw"] = 4_500_000.0
    payload_v07["finance"]["diesel_overhaul_life_years"] = 5.0

    res07 = client.post("/v1/hybrid/simulate", json=payload_v07)
    assert res07.status_code == 200
    d07 = res07.json()
    assert d07["engine_version"] == "0.7.0"
    assert d07["contract_version"] == "0.7"
    assert d07["summary"]["diesel_generation_kwh"] > 0.0
    assert d07["diesel_summary"] is not None
    assert d07["diesel_summary"]["is_renewable"] is False
    assert d07["lcoe_breakdown"]["capex_diesel"] > 0.0
    assert len(d07["hourly_year_1"]["diesel_generation_kw"]) == 8760
    assert len(d07["hourly_year_1"]["diesel_fuel_liters"]) == 8760

    # Kompatibilitas mundur v0.5 tanpa field diesel
    payload_v05 = copy.deepcopy(p_data["sample_config"])
    payload_v05["contract_version"] = "0.5"
    res05 = client.post("/v1/hybrid/simulate", json=payload_v05)
    assert res05.status_code == 200
    d05 = res05.json()
    assert d05["contract_version"] == "0.5"
    assert d05["summary"]["diesel_generation_kwh"] == 0.0
    assert d05["diesel_summary"] is None

    # Mode Cepat PV tetap utuh
    quick_pv = client.post(
        "/v1/pv/preliminary",
        json={
            "project": {
                "project_name": "Uji Mode Cepat",
                "technology": "solar_pv",
                "project_type": "ground_mounted",
                "country_code": "ID",
                "capacity_kwp": 500.0,
                "lifetime_years": 25,
                "currency_code": "IDR",
            },
            "technical": {
                "energy_method": "manual_specific_yield",
                "specific_yield_kwh_per_kwp_year": 1450.0,
                "yield_boundary": "net_ac_at_delivery",
                "performance_loss_fraction": 0.0,
                "degradation_fraction_per_year": 0.005,
            },
            "financial": {
                "capex_amount": 5_750_000_000.0,
                "annual_opex_amount": 86_250_000.0,
                "revenue_method": "fixed_tariff",
                "tariff_per_kwh": 1445.0,
                "discount_rate_fraction": 0.095,
                "tax_model": "pre_tax",
            },
        },
    )
    assert quick_pv.status_code == 200
    assert client.get("/health").status_code == 200
