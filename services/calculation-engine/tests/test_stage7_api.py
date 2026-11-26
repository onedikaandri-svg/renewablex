"""Tes integrasi dan unit untuk fitur Tahap 7: Sapuan Kombinasi, Sensitivitas Hybrid, dan Ekspor Excel."""

import copy
from io import BytesIO
import time
from unittest.mock import patch

from fastapi.testclient import TestClient
from openpyxl import load_workbook
import pytest

from app.hybrid.cli import _parse_bess_config, _parse_biomass_config, _parse_dispatch_config, _parse_pv_config
from app.hybrid.finance import resolve_finance_config, resolve_lifetime_config
from app.hybrid.load import generate_synthetic_load
from app.hybrid.sensitivity import run_hybrid_sensitivity
from app.hybrid.simulator import SimulationConfig
from app.hybrid.sweep import run_hybrid_sweep
from app.hybrid.time_grid import TimeConfig
from app.main import app
from tests.test_hybrid_api import _make_synthetic_weather, _sample_simulate_payload

client = TestClient(app)


def _core_objects_from_payload(payload: dict):
    tc = TimeConfig(step_minutes=60, timezone=payload["project"]["timezone"])
    weather = _make_synthetic_weather()
    lp = generate_synthetic_load(
        base_load_kw=payload["load_profile"]["base_load_kw"],
        peak_load_kw=payload["load_profile"]["peak_load_kw"],
        time_config=tc,
        seed=payload["load_profile"]["seed"],
        noise_fraction=payload["load_profile"]["noise_fraction"],
    )
    pv = _parse_pv_config(payload["components"]["pv"])
    bess = _parse_bess_config(payload["components"]["bess"])
    biomass = _parse_biomass_config(payload["components"]["biomass"])
    dispatch = _parse_dispatch_config(payload["simulation"])
    sim_cfg = SimulationConfig(
        project_name=payload["project"]["project_name"],
        time_config=tc,
        pv=pv,
        contract_version="0.6",
        bess=bess,
        dispatch=dispatch,
        biomass=biomass,
    )
    lc = resolve_lifetime_config(payload["simulation"], payload["finance"])
    fc = resolve_finance_config(payload["finance"], currency_code=payload["project"]["currency_code"])
    return sim_cfg, weather, lp, lc, fc


def test_sweep_pv_cache_produces_identical_results():
    payload = _sample_simulate_payload()
    payload["simulation"]["project_lifetime_years"] = 5
    payload["finance"]["inverter_replacement_year"] = None
    sim_cfg, weather, lp, lc, fc = _core_objects_from_payload(payload)

    res_cached = run_hybrid_sweep(
        base_sim_config=sim_cfg,
        weather=weather,
        load_profile=lp,
        base_lifetime_config=lc,
        base_finance_config=fc,
        pv_values=[300.0, 500.0],
        bess_values=[0.0, 400.0],
        biomass_values=[0.0, 250.0],
        use_pv_cache=True,
    )
    res_uncached = run_hybrid_sweep(
        base_sim_config=sim_cfg,
        weather=weather,
        load_profile=lp,
        base_lifetime_config=lc,
        base_finance_config=fc,
        pv_values=[300.0, 500.0],
        bess_values=[0.0, 400.0],
        biomass_values=[0.0, 250.0],
        use_pv_cache=False,
    )

    assert res_cached["total_combinations"] == 8
    assert res_cached["best_combination_id"] == res_uncached["best_combination_id"]
    for c_cached, c_uncached in zip(res_cached["combinations"], res_uncached["combinations"]):
        assert c_cached["combination_id"] == c_uncached["combination_id"]
        assert c_cached["sizing"] == c_uncached["sizing"]
        for k, val in c_cached["technical"].items():
            assert val == pytest.approx(c_uncached["technical"][k], abs=0.0)
        for k, val in c_cached["finance"].items():
            if isinstance(val, (int, float)):
                assert val == pytest.approx(c_uncached["finance"][k], abs=0.0)
            else:
                assert val == c_uncached["finance"][k]


@patch("app.api.hybrid._weather_provider.get_weather")
def test_sweep_async_job_ranking_constraints_and_limits(mock_get_weather):
    mock_get_weather.return_value = _make_synthetic_weather()
    base = _sample_simulate_payload()
    base["simulation"]["project_lifetime_years"] = 5
    base["finance"]["inverter_replacement_year"] = None
    base["output_options"] = {"include_hourly": False, "include_daily": False, "include_trace_reasons": False}

    req = {
        "contract_version": "0.6",
        "base_request": base,
        "sweep": {
            "pv_capacity_kwp_values": [300.0, 600.0],
            "bess_capacity_kwh_values": [0.0, 400.0],
            "biomass_capacity_kw_values": [0.0, 250.0],
            "pv_inverter_sizing_mode": "keep_dc_ac_ratio",
            "scale_replacement_costs": True,
        },
        "constraints": {
            "max_unmet_load_fraction": 0.05,
            "min_renewable_fraction": 0.80,
        },
        "ranking": {
            "sort_by": "lcoe_asc",
            "feasible_first": True,
        },
    }

    res_create = client.post("/v1/hybrid/sweep/jobs", json=req)
    assert res_create.status_code == 202
    created = res_create.json()
    assert created["contract_version"] == "0.6"
    assert created["total_combinations"] == 8
    job_id = created["job_id"]

    final_data = None
    for _ in range(150):
        poll = client.get(f"/v1/hybrid/sweep/jobs/{job_id}")
        assert poll.status_code == 200
        body = poll.json()
        if body["status"] == "completed":
            final_data = body
            break
        assert body["status"] in ("queued", "running"), f"Sapuan gagal: {body.get('error')}"
        time.sleep(0.05)

    assert final_data is not None
    assert final_data["progress_percent"] == 100
    assert final_data["completed_combinations"] == 8
    combos = final_data["result"]["combinations"]
    assert len(combos) == 8
    assert [c["rank"] for c in combos] == list(range(1, 9))
    assert final_data["result"]["best_combination_id"] == combos[0]["combination_id"]
    # Cek kombinasi layak berada di atas kombinasi tidak layak bila ada.
    seen_infeasible = False
    for c in combos:
        if not c["feasible"]:
            seen_infeasible = True
            assert len(c["infeasible_reasons"]) >= 1
        elif seen_infeasible:
            pytest.fail("Kombinasi layak tidak boleh muncul setelah kombinasi tidak layak saat feasible_first=True.")

    # Batas 64 kombinasi
    too_many = copy.deepcopy(req)
    too_many["sweep"]["pv_capacity_kwp_values"] = [100.0, 200.0, 300.0, 400.0, 500.0]
    too_many["sweep"]["bess_capacity_kwh_values"] = [0.0, 100.0, 200.0, 300.0, 400.0]
    too_many["sweep"]["biomass_capacity_kw_values"] = [0.0, 100.0, 200.0]  # 75 > 64
    r_over = client.post("/v1/hybrid/sweep/jobs", json=too_many)
    assert r_over.status_code == 422
    assert r_over.json()["detail"][0]["code"] == "sweep_combinations_exceeded"

    # Batas 12 kombinasi untuk full_hourly
    fh_over = copy.deepcopy(req)
    fh_over["base_request"]["simulation"]["multi_year_mode"] = "full_hourly"
    fh_over["sweep"]["pv_capacity_kwp_values"] = [200.0, 400.0, 600.0]
    fh_over["sweep"]["bess_capacity_kwh_values"] = [0.0, 200.0, 400.0]
    fh_over["sweep"]["biomass_capacity_kw_values"] = [0.0, 250.0]  # 18 > 12
    r_fh = client.post("/v1/hybrid/sweep/jobs", json=fh_over)
    assert r_fh.status_code == 422
    assert r_fh.json()["detail"][0]["code"] == "sweep_full_hourly_limit_exceeded"

    # Duplikat nilai sumbu & extra_forbidden
    dup_axis = copy.deepcopy(req)
    dup_axis["sweep"]["pv_capacity_kwp_values"] = [300.0, 300.0]
    r_dup = client.post("/v1/hybrid/sweep/jobs", json=dup_axis)
    assert r_dup.status_code == 422
    assert r_dup.json()["detail"][0]["code"] == "invalid_sweep_axis"

    extra_req = copy.deepcopy(req)
    extra_req["unexpected"] = True
    r_extra = client.post("/v1/hybrid/sweep/jobs", json=extra_req)
    assert r_extra.status_code == 422
    assert r_extra.json()["detail"][0]["code"] == "extra_forbidden"

    # 404 job tidak ditemukan & pembatalan job
    r_404 = client.get("/v1/hybrid/sweep/jobs/tidak-ada")
    assert r_404.status_code == 404
    assert r_404.json()["detail"][0]["code"] == "sweep_job_not_found"

    r_cancel = client.post(f"/v1/hybrid/sweep/jobs/{job_id}/cancel")
    assert r_cancel.status_code == 200


def test_sensitivity_finance_fast_path_matches_full_simulation():
    payload = _sample_simulate_payload()
    payload["simulation"]["project_lifetime_years"] = 5
    payload["finance"]["inverter_replacement_year"] = None
    sim_cfg, weather, lp, lc, fc = _core_objects_from_payload(payload)

    vars_finance = [
        "capex_total",
        "electricity_tariff",
        "discount_rate",
        "biomass_fuel_price",
        "om_total",
    ]
    fast = run_hybrid_sensitivity(
        base_sim_config=sim_cfg,
        weather=weather,
        load_profile=lp,
        base_lifetime_config=lc,
        base_finance_config=fc,
        variables=vars_finance,
        shifts=[-0.20, 0.20],
        force_full_simulation=False,
    )
    full = run_hybrid_sensitivity(
        base_sim_config=sim_cfg,
        weather=weather,
        load_profile=lp,
        base_lifetime_config=lc,
        base_finance_config=fc,
        variables=vars_finance,
        shifts=[-0.20, 0.20],
        force_full_simulation=True,
    )

    assert fast["base"] == full["base"]
    for v_fast, v_full in zip(fast["variables"], full["variables"]):
        assert v_fast["variable"] == v_full["variable"]
        assert v_fast["max_abs_npv_delta"] == pytest.approx(v_full["max_abs_npv_delta"], abs=1e-2)
        for c_fast, c_full in zip(v_fast["cases"], v_full["cases"]):
            assert c_fast["npv"] == pytest.approx(c_full["npv"], abs=1e-2)
            assert c_fast["lcoe"] == pytest.approx(c_full["lcoe"], abs=1e-4)


@patch("app.api.hybrid._weather_provider.get_weather")
def test_sensitivity_endpoint_tornado_disabled_biomass_and_matrix_5x5(mock_get_weather):
    mock_get_weather.return_value = _make_synthetic_weather()
    base = _sample_simulate_payload()
    base["simulation"]["project_lifetime_years"] = 5
    base["finance"]["inverter_replacement_year"] = None
    base["components"]["biomass"] = {"enabled": False}
    base["output_options"] = {"include_hourly": False, "include_daily": False, "include_trace_reasons": False}

    req = {
        "contract_version": "0.6",
        "base_request": base,
        "variables": [
            "capex_total",
            "electricity_tariff",
            "discount_rate",
            "biomass_fuel_price",
            "om_total",
            "pv_degradation_rate",
        ],
        "shifts": [-0.20, -0.10, 0.10, 0.20],
        "matrix": {
            "x_variable": "capex_total",
            "x_shifts": [-0.20, -0.10, 0.0, 0.10, 0.20],
            "y_variable": "electricity_tariff",
            "y_shifts": [-0.20, -0.10, 0.0, 0.10, 0.20],
        },
    }

    res = client.post("/v1/hybrid/sensitivity", json=req)
    assert res.status_code == 200
    data = res.json()
    assert data["contract_version"] == "0.6"
    variables = data["variables"]
    assert len(variables) == 6

    bio_item = next(v for v in variables if v["variable"] == "biomass_fuel_price")
    assert bio_item["skipped"] is True
    assert bio_item["skip_reason"] == "component_disabled"
    assert bio_item["cases"] == []

    active_items = [v for v in variables if not v["skipped"]]
    impacts = [v["max_abs_npv_delta"] for v in active_items]
    assert impacts == sorted(impacts, reverse=True)

    matrix_res = data["matrix_result"]
    assert matrix_res is not None
    assert len(matrix_res["cells"]) == 25
    center_cell = next(c for c in matrix_res["cells"] if c["x_shift"] == 0.0 and c["y_shift"] == 0.0)
    assert center_cell["npv"] == pytest.approx(data["base"]["npv"], abs=1e-2)
    assert center_cell["npv_delta"] == pytest.approx(0.0, abs=1e-2)

    # Validasi sumbu matriks sama ditolak
    bad_mat = copy.deepcopy(req)
    bad_mat["matrix"]["y_variable"] = "capex_total"
    r_bad_mat = client.post("/v1/hybrid/sensitivity", json=bad_mat)
    assert r_bad_mat.status_code == 422
    assert r_bad_mat.json()["detail"][0]["code"] == "invalid_matrix_axes"

    # Validasi duplikat variabel & shift 0 pada tornado
    bad_dup = copy.deepcopy(req)
    bad_dup["variables"] = ["capex_total", "capex_total"]
    r_dup = client.post("/v1/hybrid/sensitivity", json=bad_dup)
    assert r_dup.status_code == 422
    assert r_dup.json()["detail"][0]["code"] == "duplicate_sensitivity_variables"

    bad_zero = copy.deepcopy(req)
    bad_zero["shifts"] = [-0.10, 0.0, 0.10]
    r_zero = client.post("/v1/hybrid/sensitivity", json=bad_zero)
    assert r_zero.status_code == 422
    assert r_zero.json()["detail"][0]["code"] == "invalid_sensitivity_shift"


@patch("app.api.hybrid._weather_provider.get_weather")
def test_excel_export_endpoint_builds_valid_multi_sheet_workbook(mock_get_weather):
    mock_get_weather.return_value = _make_synthetic_weather()
    base = _sample_simulate_payload()
    base["simulation"]["project_lifetime_years"] = 5
    base["finance"]["inverter_replacement_year"] = None
    base["output_options"] = {"include_hourly": False, "include_daily": False, "include_trace_reasons": False}

    sim_res = client.post("/v1/hybrid/simulate", json=base)
    assert sim_res.status_code == 200
    sim_data = sim_res.json()

    sens_res = client.post(
        "/v1/hybrid/sensitivity",
        json={
            "contract_version": "0.6",
            "base_request": base,
            "variables": ["capex_total", "electricity_tariff"],
            "shifts": [-0.10, 0.10],
        },
    )
    assert sens_res.status_code == 200
    sens_data = sens_res.json()

    sweep_sample = {
        "sort_by": "lcoe_asc",
        "feasible_count": 1,
        "total_combinations": 1,
        "best_combination_id": "pv500-bess600-bio250",
        "combinations": [
            {
                "rank": 1,
                "combination_id": "pv500-bess600-bio250",
                "feasible": True,
                "infeasible_reasons": [],
                "sizing": {
                    "pv_capacity_kwp": 500.0,
                    "bess_nominal_capacity_kwh": 600.0,
                    "biomass_rated_capacity_kw": 250.0,
                },
                "technical": {"renewable_fraction": 0.98},
                "finance": {
                    "lcoe": sim_data["finance_summary"]["lcoe"],
                    "total_npc": sim_data["finance_summary"]["total_npc"],
                    "npv": sim_data["finance_summary"]["npv"],
                    "irr": sim_data["finance_summary"]["irr"],
                },
            }
        ],
    }

    exp_res = client.post(
        "/v1/hybrid/export/excel",
        json={
            "contract_version": "0.6",
            "language": "id",
            "project_config": base,
            "simulation_result": sim_data,
            "sweep_result": sweep_sample,
            "sensitivity_result": sens_data,
        },
    )
    assert exp_res.status_code == 200
    assert exp_res.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert ".xlsx" in exp_res.headers.get("content-disposition", "")

    wb = load_workbook(BytesIO(exp_res.content), data_only=True)
    assert wb.sheetnames == [
        "Ringkasan",
        "Energi_Bulanan",
        "Arus_Kas_Tahunan",
        "Asumsi_Konfigurasi",
        "Hasil_Sapuan",
        "Sensitivitas",
    ]
    ws_mon = wb["Energi_Bulanan"]
    assert ws_mon["A16"].value == "Total"
    assert ws_mon["B16"].value == pytest.approx(sum(m["load_kwh"] for m in sim_data["monthly"]), abs=1e-2)

    ws_cf = wb["Arus_Kas_Tahunan"]
    assert ws_cf["A4"].value == 0
    assert ws_cf["C4"].value == pytest.approx(sim_data["cashflow_schedule"][0]["capex_outflow"], abs=1e-2)

    # Payload tidak lengkap mengembalikan 422 export_payload_invalid
    bad_exp = client.post(
        "/v1/hybrid/export/excel",
        json={
            "contract_version": "0.6",
            "language": "id",
            "project_config": {},
            "simulation_result": {"project_name": "Kosong"},
        },
    )
    assert bad_exp.status_code == 422
    assert bad_exp.json()["detail"][0]["code"] == "export_payload_invalid"
