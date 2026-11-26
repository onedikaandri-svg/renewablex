"""Tes 5 strategi dispatch, neraca daya hybrid PV+BESS, CLI Tahap 2, dan kebijakan NumPy murni."""

import ast
import csv
import json
from pathlib import Path

import numpy as np
import pytest

from app.errors import EngineError
from app.hybrid.bess import BESSConfig
from app.hybrid.cli import main
from app.hybrid.dispatch import DispatchConfig, DispatchContext, create_dispatch_strategy
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
        ghi_w_m2=900.0 * angle,
        dni_w_m2=780.0 * angle,
        dhi_w_m2=180.0 * angle,
        temp_air_c=np.full(n, 29.0),
        wind_speed_m_s=np.full(n, 2.0),
        time_config=tc,
        metadata=meta,
    )


class TestDispatchStrategiesUnit:
    def test_invalid_dispatch_config_raises_structured_error(self):
        with pytest.raises(EngineError) as exc_info:
            create_dispatch_strategy(DispatchConfig(strategy="peak_shaving", peak_limit_kw=None))
        assert exc_info.value.code == "invalid_dispatch_config"

        with pytest.raises(EngineError):
            create_dispatch_strategy(
                DispatchConfig(strategy="time_of_use_arbitrage", peak_hours=(18, 19), off_peak_hours=(19, 20))
            )

    def test_each_of_five_strategies_exhibits_expected_behavior(self):
        # 1. Self-consumption dan Load-following mengisi saat surplus.
        for strat_name in ("self_consumption", "load_following"):
            strat = create_dispatch_strategy(DispatchConfig(strategy=strat_name))  # type: ignore[arg-type]
            dec = strat.decide(
                DispatchContext(
                    step_idx=10,
                    hour_of_day=12,
                    month=6,
                    load_kw=100.0,
                    pv_available_kw=250.0,
                    bess_soc=0.5,
                    bess_max_charge_kw=200.0,
                    bess_max_discharge_kw=200.0,
                )
            )
            assert dec.bess_command_kw == pytest.approx(150.0)
            assert dec.trace_reason != ""

        # 2. Cycle charging mengisi menuju target SOC saat grid import aktif.
        cc = create_dispatch_strategy(DispatchConfig(strategy="cycle_charging", allow_grid_import=True, target_soc_fraction=0.80))
        dec_cc = cc.decide(
            DispatchContext(
                step_idx=2,
                hour_of_day=2,
                month=1,
                load_kw=80.0,
                pv_available_kw=0.0,
                bess_soc=0.40,
                bess_max_charge_kw=150.0,
                bess_max_discharge_kw=150.0,
                allow_grid_import=True,
            )
        )
        assert dec_cc.bess_command_kw == pytest.approx(150.0)
        assert dec_cc.grid_import_kw == pytest.approx(230.0)

        # 3. Peak shaving hanya memangkas selisih di atas peak_limit_kw.
        ps = create_dispatch_strategy(DispatchConfig(strategy="peak_shaving", peak_limit_kw=120.0))
        dec_ps = ps.decide(
            DispatchContext(
                step_idx=18,
                hour_of_day=18,
                month=3,
                load_kw=200.0,
                pv_available_kw=20.0,
                bess_soc=0.70,
                bess_max_charge_kw=100.0,
                bess_max_discharge_kw=100.0,
            )
        )
        assert dec_ps.bess_command_kw == pytest.approx(-60.0)  # 200 - 20 = 180 defisit -> pangkas 60 -> sisa 120.

        # 4. TOU arbitrage: charge di jam luar puncak, discharge di jam puncak.
        tou = create_dispatch_strategy(
            DispatchConfig(
                strategy="time_of_use_arbitrage",
                allow_grid_import=True,
                peak_hours=(18, 19, 20),
                off_peak_hours=(1, 2, 3),
            )
        )
        dec_off = tou.decide(
            DispatchContext(
                step_idx=2,
                hour_of_day=2,
                month=4,
                load_kw=50.0,
                pv_available_kw=0.0,
                bess_soc=0.40,
                bess_max_charge_kw=100.0,
                bess_max_discharge_kw=100.0,
                allow_grid_import=True,
            )
        )
        dec_peak = tou.decide(
            DispatchContext(
                step_idx=19,
                hour_of_day=19,
                month=4,
                load_kw=150.0,
                pv_available_kw=0.0,
                bess_soc=0.80,
                bess_max_charge_kw=100.0,
                bess_max_discharge_kw=100.0,
                allow_grid_import=True,
            )
        )
        assert dec_off.bess_command_kw > 0.0
        assert dec_peak.bess_command_kw < 0.0


class TestHybridPVBESSIntegration:
    @pytest.mark.parametrize(
        ("strategy", "allow_import", "peak_limit"),
        [
            ("self_consumption", False, None),
            ("load_following", False, None),
            ("cycle_charging", True, None),
            ("peak_shaving", True, 150.0),
            ("time_of_use_arbitrage", True, None),
        ],
    )
    def test_full_year_simulation_closes_power_balance_for_all_strategies(self, strategy, allow_import, peak_limit):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_weather(tc)
        load_profile = generate_synthetic_load(base_load_kw=80.0, peak_load_kw=240.0, time_config=tc, seed=19)

        cfg = SimulationConfig(
            project_name=f"Uji {strategy}",
            time_config=tc,
            contract_version="0.2",
            pv=PVDetailedConfig(
                capacity_kwp=450.0,
                inverter_ac_kw=380.0,
                tracking_mode="single_axis",
                transposition_model="perez",
                cell_temp_model="faiman",
                dc_model="single_diode",
                night_tare_kw=0.4,
            ),
            bess=BESSConfig(
                nominal_capacity_kwh=500.0,
                max_charge_kw=250.0,
                max_discharge_kw=250.0,
                aux_load_kw=0.8,
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
        assert res.bess_summary is not None
        assert res.bess_soc is not None
        assert np.all((res.bess_soc >= 0.20 - 1e-12) & (res.bess_soc <= 0.95 + 1e-12))
        assert len(res.trace_reasons) == 8760

    def test_cli_runs_stage_2_config_with_detailed_pv_bess_and_dispatch(self, tmp_path):
        cfg_data = {
            "contract_version": "0.2",
            "project": {
                "project_name": "Pabrik Hybrid PV BESS Tahap 2",
                "latitude": -6.2,
                "longitude": 106.8,
                "timezone": "Asia/Jakarta",
            },
            "simulation": {
                "step_minutes": 60,
                "leap_day_policy": "ignore_feb_29",
                "weather_file": str((FIXTURES / "golden_jakarta_weather.json").resolve()),
                "dispatch_strategy": "self_consumption",
            },
            "load_profile": {
                "mode": "synthetic",
                "base_load_kw": 120.0,
                "peak_load_kw": 350.0,
                "seed": 42,
            },
            "components": {
                "pv": {
                    "model": "detailed_v1",
                    "capacity_kwp": 500.0,
                    "inverter_ac_kw": 420.0,
                    "tracking_mode": "fixed",
                    "transposition_model": "perez",
                    "cell_temp_model": "faiman",
                    "dc_model": "pvwatts",
                    "tilt_degrees": 10.0,
                    "azimuth_degrees": 0.0,
                },
                "bess": {
                    "enabled": True,
                    "nominal_capacity_kwh": 600.0,
                    "max_charge_kw": 300.0,
                    "max_discharge_kw": 300.0,
                },
            },
        }
        cfg_path = tmp_path / "stage2_cfg.json"
        cfg_path.write_text(json.dumps(cfg_data), encoding="utf-8")
        out_dir = tmp_path / "stage2_out"

        code = main(["run", str(cfg_path), "--output", str(out_dir)])
        assert code == 0

        summary = json.loads((out_dir / "summary.json").read_text(encoding="utf-8"))
        assert summary["contract_version"] == "0.2"
        assert summary["dispatch_strategy"] == "self_consumption"
        assert summary["summary"]["max_balance_error_kw"] <= 1e-9
        assert "bess_summary" in summary
        assert summary["bess_summary"]["total_charge_kwh"] > 0.0

        with (out_dir / "hourly_balance.csv").open("r", encoding="utf-8") as f:
            rows = list(csv.reader(f))
        assert len(rows) == 8761
        assert "bess_soc" in rows[0]
        assert "trace_reason" in rows[0]


class TestProductionDependencyIsolation:
    def test_app_package_never_imports_pvlib_scipy_or_pandas(self):
        app_root = Path(__file__).resolve().parents[2] / "app"
        forbidden = {"pvlib", "scipy", "pandas"}
        for py_file in app_root.rglob("*.py"):
            tree = ast.parse(py_file.read_text(encoding="utf-8"), filename=str(py_file))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        top = alias.name.split(".")[0]
                        assert top not in forbidden, f"{py_file} mengimpor paket dev terlarang: {top}"
                elif isinstance(node, ast.ImportFrom) and node.module:
                    top = node.module.split(".")[0]
                    assert top not in forbidden, f"{py_file} mengimpor paket dev terlarang: {top}"
