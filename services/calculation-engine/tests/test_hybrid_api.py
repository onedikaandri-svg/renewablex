"""Tes integrasi HTTP untuk endpoint hybrid Tahap 5 dan kompatibilitas middleware."""

import copy
import time
from unittest.mock import patch

from fastapi.testclient import TestClient
import numpy as np
import pytest

from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset, WeatherMetadata
from app.main import app
from app.middleware import HYBRID_MAX_BODY_BYTES, MAX_BODY_BYTES
from app.providers.base import ResourceError, ResourceErrorKind

client = TestClient(app)


def _make_synthetic_weather(lat: float = -6.28, lon: float = 107.15) -> WeatherDataset:
    tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
    n = tc.steps_per_year
    hours = tc.hour_of_day()
    solar_mask = np.maximum(np.sin(np.pi * (hours - 6.0) / 12.0), 0.0)
    ghi = 750.0 * solar_mask
    dni = 620.0 * solar_mask
    dhi = 180.0 * solar_mask
    temp = 26.0 + 6.0 * solar_mask
    wind = np.full(n, 2.2, dtype=np.float64)
    return WeatherDataset(
        ghi_w_m2=ghi,
        dni_w_m2=dni,
        dhi_w_m2=dhi,
        temp_air_c=temp,
        wind_speed_m_s=wind,
        time_config=tc,
        metadata=WeatherMetadata(
            provider="pvgis_tmy",
            dataset="PVGIS-ERA5",
            dataset_version="v5_3",
            period="2005-2023 TMY",
            latitude=lat,
            longitude=lon,
            elevation_m=25.0,
            timezone="Asia/Jakarta",
            timezone_offset_hours=7.0,
            retrieved_at="2026-11-26T00:00:00+00:00",
        ),
    )


def _sample_simulate_payload() -> dict:
    res = client.get("/v1/hybrid/presets")
    assert res.status_code == 200
    return copy.deepcopy(res.json()["sample_config"])


def test_presets_endpoint_returns_complete_catalog():
    res = client.get("/v1/hybrid/presets")
    assert res.status_code == 200
    data = res.json()
    assert data["contract_version"] == "0.5"
    assert set(data["fuel_presets"]) == {"efb", "wood_pellet", "pks", "woodchip", "rice_husk"}
    assert set(data["plant_samples"]) == {"sample_gasifier_250kw", "sample_steam_turbine_1000kw"}
    assert len(data["dispatch_strategies"]) == 6
    assert len(data["ems_rule_presets"]) >= 3
    assert len(data["location_presets"]) >= 5
    assert data["sample_config"]["components"]["pv"]["capacity_kwp"] == 500.0


@patch("app.api.hybrid._weather_provider.get_weather")
def test_weather_preview_success_and_error_mapping(mock_get_weather):
    mock_get_weather.return_value = _make_synthetic_weather()
    res = client.post(
        "/v1/hybrid/weather/preview",
        json={"latitude": -6.28, "longitude": 107.15, "timezone": "Asia/Jakarta"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["weather_source"]["dataset"] == "PVGIS-ERA5"
    assert len(data["monthly"]) == 12
    assert data["annual_summary"]["total_ghi_kwh_m2"] > 0

    mock_get_weather.side_effect = ResourceError(ResourceErrorKind.OUT_OF_COVERAGE, "Di tengah laut")
    err = client.post(
        "/v1/hybrid/weather/preview",
        json={"latitude": -6.28, "longitude": 107.15, "timezone": "Asia/Jakarta"},
    )
    assert err.status_code == 422
    assert err.json()["detail"][0]["code"] == "out_of_coverage"

    mock_get_weather.side_effect = ResourceError(ResourceErrorKind.TIMEOUT, "Timeout")
    err_to = client.post(
        "/v1/hybrid/weather/preview",
        json={"latitude": -6.28, "longitude": 107.15, "timezone": "Asia/Jakarta"},
    )
    assert err_to.status_code == 422
    assert err_to.json()["detail"][0]["code"] == "provider_timeout"


def test_load_preview_synthetic_and_large_csv_8760():
    # Mode sintetis
    res_syn = client.post(
        "/v1/hybrid/load/preview",
        json={
            "step_minutes": 60,
            "timezone": "Asia/Jakarta",
            "load_profile": {"mode": "synthetic", "base_load_kw": 100.0, "peak_load_kw": 300.0, "seed": 42},
        },
    )
    assert res_syn.status_code == 200
    d_syn = res_syn.json()
    assert d_syn["summary"]["steps_count"] == 8760
    assert len(d_syn["daily_average_24h"]) == 24
    assert len(d_syn["monthly"]) == 12
    assert len(d_syn["hourly_load_kw"]) == 8760

    # Mode CSV 8.760 baris dengan ukuran > 64 KB (menguji kenaikan BodyLimit khusus /v1/hybrid/)
    lines = ["hour_index,load_kw"]
    for i in range(8760):
        lines.append(f"{i},{150.123456 + (i % 24) * 2.5:.6f}")
    csv_text = "\n".join(lines)
    assert len(csv_text.encode("utf-8")) > MAX_BODY_BYTES

    res_csv = client.post(
        "/v1/hybrid/load/preview",
        json={
            "step_minutes": 60,
            "timezone": "Asia/Jakarta",
            "load_profile": {"mode": "csv", "csv_text": csv_text},
        },
    )
    assert res_csv.status_code == 200
    assert res_csv.json()["source"] == "csv"
    assert res_csv.json()["summary"]["steps_count"] == 8760


def test_load_preview_validation_errors():
    # Panjang CSV salah
    bad_len = client.post(
        "/v1/hybrid/load/preview",
        json={"load_profile": {"mode": "csv", "csv_text": "load_kw\n100\n200"}},
    )
    assert bad_len.status_code == 422
    assert bad_len.json()["detail"][0]["code"] == "invalid_load_length"

    # Nilai negatif
    lines = ["load_kw"] + ["100.0"] * 8759 + ["-5.0"]
    bad_neg = client.post(
        "/v1/hybrid/load/preview",
        json={"load_profile": {"mode": "csv", "csv_text": "\n".join(lines)}},
    )
    assert bad_neg.status_code == 422
    assert bad_neg.json()["detail"][0]["code"] == "negative_load_value"

    # Field tak dikenal ditolak (extra="forbid")
    bad_extra = client.post(
        "/v1/hybrid/load/preview",
        json={"unknown_field": 1, "load_profile": {"mode": "synthetic", "base_load_kw": 100, "peak_load_kw": 200}},
    )
    assert bad_extra.status_code == 422
    assert bad_extra.json()["detail"][0]["code"] == "extra_forbidden"


def test_hybrid_body_limit_over_2mb_is_413():
    oversized = '{"load_profile":{"mode":"csv","csv_text":"' + ("a" * HYBRID_MAX_BODY_BYTES) + '"}}'
    res = client.post(
        "/v1/hybrid/load/preview",
        content=oversized.encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 413
    assert res.json()["detail"][0]["code"] == "request_too_large"


@patch("app.api.hybrid._weather_provider.get_weather")
def test_simulate_sync_scaled_and_gzip_header(mock_get_weather):
    mock_get_weather.return_value = _make_synthetic_weather()
    payload = _sample_simulate_payload()
    payload["output_options"] = {"include_hourly": True, "include_daily": False, "include_trace_reasons": True}

    res = client.post("/v1/hybrid/simulate", json=payload, headers={"Accept-Encoding": "gzip"})
    assert res.status_code == 200
    assert res.headers.get("content-encoding") == "gzip"
    data = res.json()
    assert data["contract_version"] == "0.5"
    assert data["summary"]["steps_count"] == 8760
    assert data["summary"]["max_balance_error_kw"] < 1e-6
    assert len(data["monthly"]) == 12
    assert "biomass_generation_kwh" in data["monthly"][0]
    assert len(data["pv_loss_breakdown_kwh"]) >= 6
    assert data["bess_summary"] is not None
    assert data["biomass_summary"] is not None
    assert data["finance_summary"]["project_lifetime_years"] == 25
    assert len(data["cashflow_schedule"]) == 26
    assert len(data["hourly_year_1"]["load_kw"]) == 8760
    assert len(data["hourly_year_1"]["bess_soc_fraction"]) == 8760
    assert len(data["hourly_year_1"]["biomass_status"]) == 8760


@patch("app.api.hybrid._weather_provider.get_weather")
def test_async_jobs_lifecycle_and_404(mock_get_weather):
    mock_get_weather.return_value = _make_synthetic_weather()
    payload = _sample_simulate_payload()
    payload["simulation"]["project_lifetime_years"] = 2
    payload["simulation"]["multi_year_mode"] = "full_hourly"
    payload["finance"]["inverter_replacement_year"] = None
    payload["output_options"] = {"include_hourly": True, "include_daily": False, "include_trace_reasons": False}

    res_create = client.post("/v1/hybrid/jobs", json=payload)
    assert res_create.status_code == 202
    job_id = res_create.json()["job_id"]

    final_data = None
    for _ in range(100):
        res_poll = client.get(f"/v1/hybrid/jobs/{job_id}")
        assert res_poll.status_code == 200
        body = res_poll.json()
        if body["status"] == "completed":
            final_data = body
            break
        assert body["status"] in ("queued", "running"), f"Job gagal: {body.get('error')}"
        time.sleep(0.05)

    assert final_data is not None
    assert final_data["progress_percent"] == 100
    assert final_data["result"]["lifetime_summary"]["multi_year_mode"] == "full_hourly"
    assert len(final_data["result"]["lifetime_summary"]["yearly"]) == 2

    res_404 = client.get("/v1/hybrid/jobs/tidak-ada-id")
    assert res_404.status_code == 404
    assert res_404.json()["detail"][0]["code"] == "job_not_found"
