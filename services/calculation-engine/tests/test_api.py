import json
import math
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.providers.base import ResourceResult, ResourceError, ResourceErrorKind

client = TestClient(app)

# Naik 4 level dari tests/ untuk mencapai root repo (renewablex)
EXAMPLES = Path(__file__).resolve().parents[3] / "examples"
SAMPLE = json.loads((EXAMPLES / "sample-pv-project.json").read_text())


def post(mutate=None):
    body = json.loads(json.dumps(SAMPLE))
    if mutate:
        mutate(body)
    return client.post("/v1/pv/preliminary", json=body)


def detail(response):
    assert response.status_code == 422
    return response.json()["detail"]


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "engine_version" in data


def test_sample_project_calculates():
    res = post()
    assert res.status_code == 200
    data = res.json()
    assert data["year_1_energy_kwh"] == pytest.approx(1_470_000.0)
    assert data["npv_amount"] == pytest.approx(784_492_869.07, abs=0.02)
    assert data["project_irr_fraction"] == pytest.approx(0.10864527, abs=1e-8)
    assert data["simple_payback_years"] == pytest.approx(8.3478, abs=1e-4)
    assert data["energy_method"] == "manual_specific_yield"
    assert data["scope"] == "pre_tax_unlevered"


def test_warning_codes():
    payload = {
        "project": {"project_name": "Test", "technology": "solar_pv", "project_type": "ground_mounted", "country_code": "ID", "capacity_kwp": 1000, "lifetime_years": 20, "currency_code": "IDR"},
        "technical": {"energy_method": "manual_specific_yield", "specific_yield_kwh_per_kwp_year": 3000, "yield_boundary": "gross_pre_loss", "performance_loss_fraction": 0.4, "degradation_fraction_per_year": 0.03},
        "financial": {"capex_amount": 1000000, "annual_opex_amount": 10000, "revenue_method": "fixed_tariff", "tariff_per_kwh": 1000, "discount_rate_fraction": 0.1, "tax_model": "pre_tax"}
    }
    response = client.post("/v1/pv/preliminary", json=payload)
    assert response.status_code == 200
    data = response.json()
    
    assert "high_specific_yield" in data["warning_codes"]
    assert "high_degradation" in data["warning_codes"]
    assert "high_performance_loss" in data["warning_codes"]
    assert len(data["warnings"]) == 3


def test_location_mode_requires_coordinates():
    res = post(lambda b: b["technical"].update(energy_method="location_based"))
    assert res.status_code == 422
    assert res.json()["detail"][0]["code"] == "location_required"


@patch("app.api.pv.PVGISProvider.get_resource")
def test_location_based_pvgis_success(mock_get_resource):
    mock_get_resource.return_value = ResourceResult(
        specific_yield_kwh_per_kwp_year=1500.0,
        yield_boundary="net_ac_at_delivery",
        provider_name="pvgis",
        dataset="PVGIS-ERA5",
        dataset_version="v5_3",
        period="2005-2023",
        retrieval_timestamp="2026-11-25T12:00:00Z"
    )

    payload = {
        "project": {"project_name": "Test PVGIS", "technology": "solar_pv", "project_type": "ground_mounted", "country_code": "ID", "capacity_kwp": 1000, "lifetime_years": 20, "currency_code": "IDR"},
        "technical": {
            "energy_method": "location_based", 
            "resource_source": "pvgis",
            "latitude": -6.2, 
            "longitude": 106.8,
            "tilt_degrees": 10,
            "azimuth_degrees": 180,
            "degradation_fraction_per_year": 0.005
        },
        "financial": {"capex_amount": 1000000, "annual_opex_amount": 10000, "revenue_method": "fixed_tariff", "tariff_per_kwh": 1000, "discount_rate_fraction": 0.1, "tax_model": "pre_tax"}
    }
    response = client.post("/v1/pv/preliminary", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["net_specific_yield_kwh_per_kwp_year"] == 1500.0
    assert data["resource_metadata"]["dataset"] == "PVGIS-ERA5"
    assert "resource_data_fetched" in data["warning_codes"]
    mock_get_resource.assert_called_once()


@patch("app.api.pv.NASAProvider.get_resource")
def test_location_based_nasa_success(mock_get_resource):
    mock_get_resource.return_value = ResourceResult(
        specific_yield_kwh_per_kwp_year=1450.0,
        yield_boundary="net_ac_at_delivery",
        provider_name="nasa",
        dataset="NASA POWER",
        dataset_version="v2",
        period="2023",
        retrieval_timestamp="2026-11-25T12:00:00Z"
    )

    payload = {
        "project": {"project_name": "Test NASA", "technology": "solar_pv", "project_type": "ground_mounted", "country_code": "ID", "capacity_kwp": 1000, "lifetime_years": 20, "currency_code": "IDR"},
        "technical": {
            "energy_method": "location_based", 
            "resource_source": "nasa",
            "latitude": -6.2, 
            "longitude": 106.8,
            "degradation_fraction_per_year": 0.005
        },
        "financial": {"capex_amount": 1000000, "annual_opex_amount": 10000, "revenue_method": "fixed_tariff", "tariff_per_kwh": 1000, "discount_rate_fraction": 0.1, "tax_model": "pre_tax"}
    }
    response = client.post("/v1/pv/preliminary", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["net_specific_yield_kwh_per_kwp_year"] == 1450.0
    assert data["resource_metadata"]["dataset"] == "NASA POWER"
    assert "resource_data_fetched" in data["warning_codes"]


@patch("app.api.pv.PVGISProvider.get_resource")
def test_location_based_pvgis_out_of_coverage(mock_get_resource):
    mock_get_resource.side_effect = ResourceError(
        ResourceErrorKind.OUT_OF_COVERAGE, 
        "Lokasi di luar cakupan data PVGIS."
    )

    payload = {
        "project": {"project_name": "Test Sea", "technology": "solar_pv", "project_type": "ground_mounted", "country_code": "ID", "capacity_kwp": 1000, "lifetime_years": 20, "currency_code": "IDR"},
        "technical": {
            "energy_method": "location_based", 
            "resource_source": "pvgis",
            "latitude": -6.2, 
            "longitude": 106.8,
            "degradation_fraction_per_year": 0.005
        },
        "financial": {"capex_amount": 1000000, "annual_opex_amount": 10000, "revenue_method": "fixed_tariff", "tariff_per_kwh": 1000, "discount_rate_fraction": 0.1, "tax_model": "pre_tax"}
    }
    response = client.post("/v1/pv/preliminary", json=payload)
    assert response.status_code == 422
    assert response.json()["detail"][0]["code"] == "out_of_coverage"


def test_self_consumption_savings_success():
    payload = {
        "project": {"project_name": "Test Self", "technology": "solar_pv", "project_type": "rooftop", "country_code": "ID", "capacity_kwp": 1000, "lifetime_years": 20, "currency_code": "IDR"},
        "technical": {"energy_method": "manual_specific_yield", "specific_yield_kwh_per_kwp_year": 1470, "yield_boundary": "net_ac_at_delivery", "degradation_fraction_per_year": 0.005},
        "financial": {
            "capex_amount": 12000000000, 
            "annual_opex_amount": 150000000, 
            "revenue_method": "self_consumption_savings",
            "annual_consumption_kwh": 800000,
            "self_consumption_tariff": 1500,
            "feed_in_tariff": 800,
            "discount_rate_fraction": 0.1, 
            "tax_model": "pre_tax"
        }
    }
    response = client.post("/v1/pv/preliminary", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["year_1_energy_kwh"] == pytest.approx(1470000.0)
    assert data["npv_amount"] > 0


@pytest.mark.parametrize("mutate,code", [
    (lambda b: b["technical"].update(performance_loss_fraction=0.1), "double_counted_loss"),
    (lambda b: b["technical"].update(energy_method="location_based"), "location_required"),
    (lambda b: b["technical"].update(specific_yield_kwh_per_kwp_year=None), "yield_required"),
    (lambda b: b["financial"].update(revenue_method="self_consumption_savings", annual_consumption_kwh=None), "consumption_required"),
])
def test_custom_errors_carry_a_stable_code(mutate, code):
    items = detail(post(mutate))
    assert [i["code"] for i in items] == [code]


def test_unknown_field_is_rejected():
    items = detail(post(lambda b: b["project"].update(unexpected="x")))
    assert [i["code"] for i in items] == ["extra_forbidden"]


def test_sensitivity_returns_sorted_variables():
    body = {"base": json.loads(json.dumps(SAMPLE))}
    res = client.post("/v1/pv/sensitivity", json=body)
    assert res.status_code == 200
    data = res.json()
    assert len(data["variables"]) == 5
    deltas = [v["max_abs_npv_delta"] for v in data["variables"]]
    assert deltas == sorted(deltas, reverse=True)
