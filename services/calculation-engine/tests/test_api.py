import copy
import json
import math
from pathlib import Path

import numpy_financial as npf
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
SAMPLE = json.loads((Path(__file__).parents[3] / "examples" / "sample-pv-project.json").read_text())
URL = "/v1/pv/preliminary"


def post(mutate=None):
    body = copy.deepcopy(SAMPLE)
    if mutate:
        mutate(body)
    return client.post(URL, json=body)


def closed_form_npv(capex, y1, q, tariff, opex, r, n):
    """Geometric-series NPV, an independent check on the loop in the engine."""
    a = y1 * tariff / (1 + r)
    k = q / (1 + r)
    return -capex + a * (1 - k**n) / (1 - k) - opex * (1 - (1 + r) ** -n) / r


def test_health():
    body = client.get("/health").json()
    assert body["status"] == "ok" and body["engine_version"]


def test_sample_project_results():
    res = post()
    assert res.status_code == 200
    d = res.json()
    assert d["year_1_energy_kwh"] == 1_470_000
    expected = closed_form_npv(12e9, 1_470_000, 0.995, 1100, 150e6, 0.10, 25)
    assert d["npv_amount"] == pytest.approx(expected, abs=0.01)
    flows = [-12e9] + [1_470_000 * 0.995 ** (t - 1) * 1100 - 150e6 for t in range(1, 26)]
    assert d["project_irr_fraction"] == pytest.approx(float(npf.irr(flows)), abs=1e-7)
    assert d["irr_status"] == "ok"
    assert d["payback_status"] == "recovered"
    assert d["simple_payback_years"] == pytest.approx(8.3478, abs=1e-3)


def test_response_documents_scope_and_provenance():
    d = post().json()
    assert d["scope"] == "pre_tax_unlevered"
    assert d["methodology_version"] and d["engine_version"] and d["calculated_at"]
    assert d["inputs"]["project"]["capacity_kwp"] == 1000
    assert len(d["annual_results"]) == 26
    assert d["annual_results"][0]["cash_flow"] == -12e9


def test_never_recovered_returns_valid_json_not_nan():
    # Regression: numpy_financial returned nan here and the response failed to serialize.
    res = post(lambda b: b["financial"].update(annual_opex_amount=5e9))
    assert res.status_code == 200
    d = res.json()
    assert d["project_irr_fraction"] is None and d["irr_status"] == "no_sign_change"
    assert d["simple_payback_years"] is None and d["payback_status"] == "not_recovered"
    assert all(math.isfinite(r["cumulative_cash_flow"]) for r in d["annual_results"])


def test_escalation_changes_the_result():
    base = post().json()["npv_amount"]
    up = post(lambda b: b["financial"].update(annual_tariff_escalation_fraction=0.02)).json()
    assert up["npv_amount"] > base
    assert up["annual_results"][2]["revenue"] == pytest.approx(
        up["annual_results"][1]["revenue"] * 0.995 * 1.02, abs=0.01
    )


def test_gross_yield_loss_is_applied_once():
    def to_gross(b):
        b["technical"].update(yield_boundary="gross_pre_loss", performance_loss_fraction=0.10,
                              specific_yield_kwh_per_kwp_year=1600)
    d = post(to_gross).json()
    assert d["net_specific_yield_kwh_per_kwp_year"] == pytest.approx(1440)
    assert d["year_1_energy_kwh"] == pytest.approx(1_440_000)


def test_unusual_values_warn_without_changing_them():
    d = post(lambda b: b["technical"].update(specific_yield_kwh_per_kwp_year=2800)).json()
    assert d["warnings"] and d["net_specific_yield_kwh_per_kwp_year"] == 2800


@pytest.mark.parametrize("section,field,value", [
    ("project", "capacity_kwp", 0),
    ("project", "capacity_kwp", -5),
    ("project", "lifetime_years", 0),
    ("project", "lifetime_years", 41),
    ("project", "currency_code", "rupiah"),
    ("technical", "specific_yield_kwh_per_kwp_year", 0),
    ("technical", "degradation_fraction_per_year", 1),
    ("technical", "degradation_fraction_per_year", -0.01),
    ("financial", "capex_amount", -1),
    ("financial", "annual_opex_amount", -1),
    ("financial", "tariff_per_kwh", -1),
    ("financial", "discount_rate_fraction", -1),
    ("financial", "tax_model", "after_tax"),
])
def test_invalid_inputs_are_rejected(section, field, value):
    assert post(lambda b: b[section].update({field: value})).status_code == 422


def test_loss_on_a_net_yield_is_rejected_as_double_counting():
    res = post(lambda b: b["technical"].update(performance_loss_fraction=0.1))
    assert res.status_code == 422 and "twice" in res.text


def test_location_mode_without_provider_asks_for_manual_input():
    res = post(lambda b: b["technical"].update(energy_method="location_based"))
    assert res.status_code == 422 and "manual_specific_yield" in res.text


def test_unsupported_revenue_method_is_rejected():
    res = post(lambda b: b["financial"].update(revenue_method="self_consumption_savings"))
    assert res.status_code == 422


def test_unknown_fields_are_not_silently_ignored():
    assert post(lambda b: b["financial"].update(surprise=1)).status_code == 422


def test_missing_required_field_is_rejected():
    assert post(lambda b: b["financial"].pop("capex_amount")).status_code == 422


def test_extreme_discount_rate_never_returns_non_finite_numbers():
    # (1e-10) ** 40 underflows to 0, which used to raise ZeroDivisionError (HTTP 500).
    def extreme(b):
        b["project"]["lifetime_years"] = 40
        b["financial"]["discount_rate_fraction"] = -0.9999999999
    res = post(extreme)
    assert res.status_code == 422 and "finite" in res.text
