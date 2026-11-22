import copy
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
SAMPLE = json.loads((Path(__file__).parents[3] / "examples" / "sample-pv-project.json").read_text())
FIELD = {
    "specific_yield": ("technical", "specific_yield_kwh_per_kwp_year"),
    "tariff": ("financial", "tariff_per_kwh"),
    "capex": ("financial", "capex_amount"),
    "opex": ("financial", "annual_opex_amount"),
    "discount_rate": ("financial", "discount_rate_fraction"),
}


def sens(mutate=None, **extra):
    base = copy.deepcopy(SAMPLE)
    if mutate:
        mutate(base)
    return client.post("/v1/pv/sensitivity", json={"base": base, **extra})


def preliminary_npv(variable, shift):
    body = copy.deepcopy(SAMPLE)
    section, name = FIELD[variable]
    body[section][name] *= 1 + shift
    return client.post("/v1/pv/preliminary", json=body).json()["npv_amount"]


def test_defaults_cover_five_variables_and_four_shifts():
    d = sens().json()
    assert len(d["variables"]) == 5
    assert all([c["shift_fraction"] for c in v["cases"]] == [-0.2, -0.1, 0.1, 0.2] for v in d["variables"])


@pytest.mark.parametrize("variable", list(FIELD))
@pytest.mark.parametrize("shift", [-0.2, 0.1])
def test_each_case_matches_a_direct_preliminary_run(variable, shift):
    d = sens(variables=[variable], shifts=[shift]).json()
    case = d["variables"][0]["cases"][0]
    assert case["npv_amount"] == pytest.approx(preliminary_npv(variable, shift), abs=0.01)
    # The delta is rounded once from exact values; the difference of two rounded values can be 0.01 off.
    assert case["npv_delta"] == pytest.approx(case["npv_amount"] - d["base"]["npv_amount"], abs=0.02)


def test_base_matches_preliminary():
    d = sens().json()
    body = client.post("/v1/pv/preliminary", json=SAMPLE).json()
    assert d["base"]["npv_amount"] == body["npv_amount"]
    assert d["base"]["project_irr_fraction"] == body["project_irr_fraction"]


def test_variables_are_sorted_by_influence():
    d = sens().json()
    sizes = [v["max_abs_npv_delta"] for v in d["variables"]]
    assert sizes == sorted(sizes, reverse=True)
    assert sizes[0] > sizes[-1]


def test_directions_are_sensible():
    cases = {v["variable"]: v["cases"] for v in sens().json()["variables"]}
    assert cases["tariff"][-1]["npv_delta"] > 0 > cases["tariff"][0]["npv_delta"]
    assert cases["capex"][-1]["npv_delta"] < 0 < cases["capex"][0]["npv_delta"]
    assert cases["discount_rate"][-1]["npv_delta"] < 0


def test_zero_discount_rate_shifts_nothing():
    d = sens(lambda b: b["financial"].update(discount_rate_fraction=0), variables=["discount_rate"]).json()
    assert all(c["npv_delta"] == 0 for c in d["variables"][0]["cases"])


def test_unrecovered_variants_report_status_not_nan():
    d = sens(lambda b: b["financial"].update(annual_opex_amount=2e9), variables=["tariff"], shifts=[0.1]).json()
    case = d["variables"][0]["cases"][0]
    assert case["project_irr_fraction"] is None and case["irr_status"] == "no_sign_change"


@pytest.mark.parametrize("extra,code", [
    ({"variables": ["tariff", "tariff"]}, "duplicate_variables"),
    ({"shifts": [0.1, 0.1]}, "duplicate_shifts"),
    ({"shifts": [0]}, "shift_out_of_bounds"),
    ({"shifts": [-0.95]}, "shift_out_of_bounds"),
    ({"shifts": [1.5]}, "shift_out_of_bounds"),
])
def test_bad_lists_are_rejected_with_a_code(extra, code):
    res = sens(**extra)
    assert res.status_code == 422 and code in [i["code"] for i in res.json()["detail"]]


@pytest.mark.parametrize("extra", [{"variables": []}, {"shifts": []}, {"variables": ["unknown"]}])
def test_empty_or_unknown_lists_are_rejected(extra):
    assert sens(**extra).status_code == 422


def test_a_shift_that_breaks_a_limit_is_reported_clearly():
    res = sens(lambda b: b["technical"].update(specific_yield_kwh_per_kwp_year=6000), variables=["specific_yield"], shifts=[1.0])
    assert res.status_code == 422 and res.json()["detail"][0]["code"] == "shift_out_of_range"


def test_invalid_base_is_rejected_like_preliminary():
    assert sens(lambda b: b["project"].update(capacity_kwp=0)).status_code == 422
