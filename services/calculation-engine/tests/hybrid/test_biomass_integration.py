"""Tes integrasi sistem hybrid PV + BESS + Biomass dan CLI Tahap 3A."""

import csv
import json
from pathlib import Path

import numpy as np
import pytest

from app.hybrid.bess import BESSConfig
from app.hybrid.biomass import build_sample_biomass_config
from app.hybrid.cli import main
from app.hybrid.dispatch import DispatchConfig
from app.hybrid.load import generate_synthetic_load
from app.hybrid.pv_detailed import PVDetailedConfig
from app.hybrid.simulator import SimulationConfig, run_simulation
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset, WeatherMetadata

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _make_weather(tc: TimeConfig) -> WeatherDataset:
    n = tc.steps_per_year
    hours = tc.hour_of_day()
    daytime = (hours >= 6.0) & (hours <= 18.0)
    angle = np.where(daytime, np.sin(np.pi * (hours - 6.0) / 12.0), 0.0)
    meta = WeatherMetadata("test", "clear", "1.0", "test", -6.2, 106.8, 16.0, tc.timezone, tc.utc_offset_hours, "now")
    return WeatherDataset(
        ghi_w_m2=880.0 * angle,
        dni_w_m2=750.0 * angle,
        dhi_w_m2=170.0 * angle,
        temp_air_c=np.full(n, 29.0),
        wind_speed_m_s=np.full(n, 2.0),
        time_config=tc,
        metadata=meta,
    )


class TestHybridPVBESSBiomassIntegration:
    @pytest.mark.parametrize(
        ("strategy", "allow_import", "peak_limit", "preset"),
        [
            ("self_consumption", False, None, "efb"),
            ("load_following", False, None, "pks"),
            ("cycle_charging", False, None, "wood_pellet"),
            ("peak_shaving", True, 160.0, "woodchip"),
            ("time_of_use_arbitrage", True, None, "rice_husk"),
        ],
    )
    def test_full_year_pv_bess_biomass_closes_power_balance(self, strategy, allow_import, peak_limit, preset):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_weather(tc)
        load_profile = generate_synthetic_load(base_load_kw=140.0, peak_load_kw=340.0, time_config=tc, seed=21)

        cfg = SimulationConfig(
            project_name=f"Hybrid Biomass {strategy}",
            time_config=tc,
            contract_version="0.3",
            pv=PVDetailedConfig(
                capacity_kwp=400.0,
                inverter_ac_kw=350.0,
                tracking_mode="fixed",
                transposition_model="perez",
                cell_temp_model="faiman",
                dc_model="pvwatts",
                night_tare_kw=0.3,
            ),
            bess=BESSConfig(
                nominal_capacity_kwh=400.0,
                max_charge_kw=200.0,
                max_discharge_kw=200.0,
                aux_load_kw=0.5,
            ),
            biomass=build_sample_biomass_config(
                "sample_gasifier_250kw",
                fuel_preset=preset,
                supply_period="monthly",
                supply_limit_tons=250.0,
            ),
            dispatch=DispatchConfig(
                strategy=strategy,  # type: ignore[arg-type]
                allow_grid_import=allow_import,
                peak_limit_kw=peak_limit,
            ),
        )

        res = run_simulation(cfg, weather, load_profile)
        assert res.summary.max_balance_error_kw <= 1e-9
        assert np.allclose(res.balance.served_load_kw + res.balance.unmet_load_kw, res.balance.load_kw, atol=1e-9)
        assert np.allclose(
            res.balance.effective_pv_generation_kw + res.balance.effective_biomass_generation_kw,
            res.balance.generation_kw,
            atol=1e-9,
        )
        assert res.bess_soc is not None
        assert np.all((res.bess_soc >= 0.20 - 1e-12) & (res.bess_soc <= 0.95 + 1e-12))
        assert res.biomass_summary is not None
        assert res.biomass_summary.total_generation_kwh > 0.0
        assert res.biomass_summary.total_fuel_tons > 0.0
        assert len(res.biomass_status) == 8760

    def test_is_renewable_flag_affects_renewable_fraction(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_weather(tc)
        load_profile = generate_synthetic_load(base_load_kw=150.0, peak_load_kw=260.0, time_config=tc, seed=5)

        def _run(is_ren: bool):
            cfg = SimulationConfig(
                project_name="Uji Fraksi Terbarukan",
                time_config=tc,
                contract_version="0.3",
                pv=PVDetailedConfig(capacity_kwp=200.0, inverter_ac_kw=180.0),
                bess=BESSConfig(nominal_capacity_kwh=200.0, max_charge_kw=100.0, max_discharge_kw=100.0),
                biomass=build_sample_biomass_config("sample_gasifier_250kw", fuel_preset="pks", is_renewable=is_ren),
                dispatch=DispatchConfig(strategy="load_following"),
            )
            return run_simulation(cfg, weather, load_profile)

        res_ren = _run(True)
        res_non = _run(False)
        assert res_ren.biomass_summary is not None and res_ren.biomass_summary.total_generation_kwh > 0.0
        assert res_ren.summary.renewable_fraction > res_non.summary.renewable_fraction

    @pytest.mark.parametrize(
        ("biomass_block", "expected_preset"),
        [
            (
                {
                    "enabled": True,
                    "plant_sample": "sample_gasifier_250kw",
                    "fuel_preset": "efb",
                    "supply_period": "monthly",
                    "supply_limit_tons": 220.0,
                },
                "efb",
            ),
            (
                {
                    "enabled": True,
                    "plant_sample": "sample_steam_turbine_1000kw",
                    "fuel_preset": "wood_pellet",
                    "fuel_price_per_ton": 2050000.0,
                    "moisture_fraction": 0.09,
                },
                "wood_pellet",
            ),
        ],
    )
    def test_cli_runs_stage_3a_biomass_presets_and_writes_outputs(self, tmp_path, biomass_block, expected_preset):
        cfg_data = {
            "contract_version": "0.3",
            "project": {
                "project_name": "Pabrik Hybrid PV BESS Biomass",
                "latitude": -6.2,
                "longitude": 106.8,
                "timezone": "Asia/Jakarta",
            },
            "simulation": {
                "step_minutes": 60,
                "leap_day_policy": "ignore_feb_29",
                "weather_file": str((FIXTURES / "golden_jakarta_weather.json").resolve()),
                "dispatch_strategy": "load_following",
            },
            "load_profile": {
                "mode": "synthetic",
                "base_load_kw": 200.0,
                "peak_load_kw": 420.0,
                "seed": 42,
            },
            "components": {
                "pv": {
                    "model": "detailed_v1",
                    "capacity_kwp": 500.0,
                    "inverter_ac_kw": 420.0,
                },
                "bess": {
                    "enabled": True,
                    "nominal_capacity_kwh": 600.0,
                    "max_charge_kw": 300.0,
                    "max_discharge_kw": 300.0,
                },
                "biomass": biomass_block,
            },
        }
        cfg_path = tmp_path / "stage3a_cfg.json"
        cfg_path.write_text(json.dumps(cfg_data), encoding="utf-8")
        out_dir = tmp_path / "stage3a_out"

        code = main(["run", str(cfg_path), "--output", str(out_dir)])
        assert code == 0

        summary = json.loads((out_dir / "summary.json").read_text(encoding="utf-8"))
        assert summary["contract_version"] == "0.3"
        assert summary["summary"]["max_balance_error_kw"] <= 1e-9
        assert "biomass_summary" in summary
        assert summary["biomass_summary"]["fuel_preset"] == expected_preset
        assert summary["biomass_summary"]["total_generation_kwh"] > 0.0

        with (out_dir / "hourly_balance.csv").open("r", encoding="utf-8") as f:
            rows = list(csv.reader(f))
        assert len(rows) == 8761
        assert "biomass_generation_kw" in rows[0]
        assert "biomass_status" in rows[0]
        assert "biomass_fuel_tons" in rows[0]
