"""Tes unit, simulator 8.760 jam, CLI, dan API untuk Tahap 3B: Custom Supervisory EMS."""

from __future__ import annotations

import copy
import json
from unittest.mock import patch

from fastapi.testclient import TestClient
import numpy as np
import pytest

from app.errors import EngineError
from app.hybrid.bess import BESSConfig
from app.hybrid.biomass import build_sample_biomass_config
from app.hybrid.cli import main as cli_main
from app.hybrid.components import PVWattsConfig
from app.hybrid.diesel import DieselConfig
from app.hybrid.dispatch import DispatchConfig, DispatchContext, create_dispatch_strategy
from app.hybrid.ems import (
    CustomEMSStrategy,
    get_ems_rule_presets,
    validate_custom_ems_rules,
)
from app.hybrid.excel_export import build_hybrid_excel_bytes
from app.hybrid.load import generate_synthetic_load
from app.hybrid.simulator import SimulationConfig, run_simulation
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset, WeatherMetadata
from app.main import app

client = TestClient(app)


def _make_weather(tc: TimeConfig) -> WeatherDataset:
    n = tc.steps_per_year
    hours = tc.hour_of_day()
    daytime = (hours >= 6.0) & (hours <= 18.0)
    angle = np.where(daytime, np.sin(np.pi * (hours - 6.0) / 12.0), 0.0)
    meta = WeatherMetadata(
        "test",
        "clear",
        "1.0",
        "test",
        -6.28,
        107.15,
        25.0,
        tc.timezone,
        tc.utc_offset_hours,
        "2026-11-27T00:00:00+00:00",
    )
    return WeatherDataset(
        ghi_w_m2=850.0 * angle,
        dni_w_m2=700.0 * angle,
        dhi_w_m2=170.0 * angle,
        temp_air_c=np.full(n, 28.0),
        wind_speed_m_s=np.full(n, 2.2),
        time_config=tc,
        metadata=meta,
    )


def test_ems_rule_presets_catalog_and_validation():
    presets = get_ems_rule_presets()
    assert set(presets.keys()) >= {"peak_cut_daytime", "islanded_reserve_protection", "tou_industrial_hybrid"}
    for preset_id, meta in presets.items():
        assert meta["id"] == preset_id
        assert meta["name_id"] != ""
        assert meta["name_en"] != ""
        rule_doc = meta["rule_set"]
        report = validate_custom_ems_rules(rule_doc)
        assert report["valid"] is True
        assert report["schema_version"] == "0.1"
        assert report["rule_count"] >= 2


def test_validate_custom_ems_rules_rejects_invalid_schema():
    # Versi skema tidak didukung
    with pytest.raises(EngineError) as exc_ver:
        validate_custom_ems_rules({"ems_schema_version": "9.9", "name": "bad", "rules": []})
    assert exc_ver.value.code == "invalid_ems_rules"
    assert "EMS_ERR_UNSUPPORTED_VERSION" in str(exc_ver.value)

    # Variabel tidak dikenal (whitelist protection)
    with pytest.raises(EngineError) as exc_var:
        validate_custom_ems_rules({
            "ems_schema_version": "0.1",
            "name": "bad_var",
            "rules": [
                {
                    "id": "r1",
                    "priority": 10,
                    "mode_scope": ["*"],
                    "when": {"var": "__import__", "op": "==", "value": 1},
                    "then": [{"action": "hold_bess"}],
                }
            ],
        })
    assert exc_var.value.code == "invalid_ems_rules"
    assert "EMS_ERR_UNKNOWN_VARIABLE" in str(exc_var.value)


def test_custom_ems_strategy_executes_supervisory_rules_and_diesel_fallback():
    presets = get_ems_rule_presets()
    peak_cut_doc = presets["peak_cut_daytime"]["rule_set"]
    strat = create_dispatch_strategy(
        DispatchConfig(
            strategy="custom_ems",
            allow_grid_import=False,
            allow_grid_export=False,
            ems_rules=peak_cut_doc,
        )
    )
    assert isinstance(strat, CustomEMSStrategy)

    # 1. Siang hari surplus PV -> charge BESS
    ctx_surplus = DispatchContext(
        step_idx=12,
        hour_of_day=12,
        month=6,
        load_kw=120.0,
        pv_available_kw=320.0,
        bess_soc=0.50,
        bess_max_charge_kw=150.0,
        bess_max_discharge_kw=150.0,
    )
    dec_surplus = strat.decide(ctx_surplus)
    assert dec_surplus.bess_command_kw == pytest.approx(150.0)
    assert "r_peak_cut_charge_surplus" in dec_surplus.trace_reason

    # 2. Malam hari defisit besar -> BESS + Biomass + Diesel menutup sisa beban
    ctx_deficit = DispatchContext(
        step_idx=20,
        hour_of_day=20,
        month=6,
        load_kw=350.0,
        pv_available_kw=0.0,
        bess_soc=0.60,
        bess_max_charge_kw=150.0,
        bess_max_discharge_kw=100.0,
        biomass_status="running",
        biomass_available_kw=150.0,
        biomass_current_power_kw=150.0,
        biomass_min_load_kw=60.0,
        biomass_can_start=True,
        biomass_can_stop=True,
        diesel_status="off",
        diesel_available_kw=120.0,
        diesel_min_load_kw=36.0,
        diesel_can_start=True,
    )
    dec_deficit = strat.decide(ctx_deficit)
    assert dec_deficit.bess_command_kw == pytest.approx(-100.0)
    assert dec_deficit.biomass_command_kw == pytest.approx(150.0)
    assert dec_deficit.diesel_command_kw == pytest.approx(100.0)
    assert "diesel=" in dec_deficit.trace_reason


def test_full_year_simulation_and_cli_with_custom_ems_closes_power_balance(tmp_path):
    tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
    weather = _make_weather(tc)
    lp = generate_synthetic_load(base_load_kw=110.0, peak_load_kw=290.0, time_config=tc, seed=42)
    presets = get_ems_rule_presets()

    cfg = SimulationConfig(
        project_name="Uji Custom Supervisory EMS",
        time_config=tc,
        contract_version="0.7",
        pv=PVWattsConfig(capacity_kwp=450.0, inverter_ac_kw=380.0),
        bess=BESSConfig(nominal_capacity_kwh=500.0, max_charge_kw=250.0, max_discharge_kw=250.0),
        biomass=build_sample_biomass_config(rated_capacity_kw=200.0),
        diesel=DieselConfig(rated_capacity_kw=150.0, min_load_fraction=0.30),
        dispatch=DispatchConfig(
            strategy="custom_ems",
            allow_grid_import=False,
            allow_grid_export=False,
            ems_rules=presets["islanded_reserve_protection"]["rule_set"],
        ),
    )

    res = run_simulation(cfg, weather, lp)
    assert res.dispatch_strategy == "custom_ems"
    assert res.summary.max_balance_error_kw <= 1e-6
    assert len(res.trace_reasons) == 8760
    assert any("mode=" in r for r in res.trace_reasons)


@patch("app.api.hybrid._weather_provider.get_weather")
def test_api_presets_validation_endpoint_and_simulate_with_custom_ems(mock_get_weather):
    tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
    mock_get_weather.return_value = _make_weather(tc)

    res_presets = client.get("/v1/hybrid/presets")
    assert res_presets.status_code == 200
    p_data = res_presets.json()
    strat_ids = [s["id"] for s in p_data["dispatch_strategies"]]
    assert "custom_ems" in strat_ids
    assert "ems_rule_presets" in p_data
    assert len(p_data["ems_rule_presets"]) >= 3

    # Endpoint validasi aturan EMS kustom
    sample_rules = p_data["ems_rule_presets"][0]["rule_set"]
    res_val = client.post("/v1/hybrid/ems/validate", json={"ems_rules": sample_rules})
    assert res_val.status_code == 200
    v_data = res_val.json()
    assert v_data["valid"] is True
    assert v_data["rule_count"] == len(sample_rules["rules"])

    # Endpoint validasi menolak aturan yang rusak dengan HTTP 422
    res_bad = client.post(
        "/v1/hybrid/ems/validate",
        json={"ems_rules": {"ems_schema_version": "0.1", "name": "", "rules": []}},
    )
    assert res_bad.status_code == 422
    assert res_bad.json()["detail"][0]["code"] == "invalid_ems_rules"

    # Jalankan /v1/hybrid/simulate dengan strategy = custom_ems
    payload = copy.deepcopy(p_data["sample_config"])
    payload["contract_version"] = "0.7"
    payload["simulation"]["dispatch_strategy"] = "custom_ems"
    payload["simulation"]["dispatch_params"]["ems_rules"] = sample_rules
    payload["output_options"] = {"include_hourly": True, "include_daily": False, "include_trace_reasons": True}

    res_sim = client.post("/v1/hybrid/simulate", json=payload)
    assert res_sim.status_code == 200
    s_data = res_sim.json()
    assert s_data["dispatch_strategy"] == "custom_ems"
    assert s_data["summary"]["max_balance_error_kw"] < 1e-6
    assert len(s_data["hourly_year_1"]["trace_reason"]) == 8760

    # Pastikan ekspor Excel menyertakan ringkasan aturan EMS kustom pada sheet Ringkasan
    from io import BytesIO
    from openpyxl import load_workbook

    xlsx_bytes = build_hybrid_excel_bytes(
        project_config=payload,
        simulation_result=s_data,
        language="id",
    )
    wb = load_workbook(BytesIO(xlsx_bytes), data_only=True)
    ws_sum = wb["Ringkasan"]
    sheet_texts = [
        str(ws_sum.cell(row=r, column=c).value or "")
        for r in range(1, ws_sum.max_row + 1)
        for c in range(1, 5)
    ]
    joined = " | ".join(sheet_texts)
    assert "peak_cut_daytime" in joined
    assert "r_peak_cut_charge_surplus" in joined

