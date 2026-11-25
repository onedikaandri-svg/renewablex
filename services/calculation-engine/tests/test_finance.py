import numpy_financial as npf
import pytest

from app.services.finance import cash_flows, irr, npv, simple_payback


def test_capex_is_negative_year_0():
    cf = cash_flows(
        capex=500,
        energy_kwh=[100],
        revenue_method="fixed_tariff",
        tariff=2,
        tariff_esc=0,
        annual_consumption_kwh=None,
        self_consumption_tariff=None,
        feed_in_tariff=None,
        opex=10,
        opex_esc=0,
    )
    assert cf.flows[0] == -500


def test_npv_at_zero_rate_is_the_sum():
    flows = [-100, 30, 40, 50]
    assert npv(0, flows) == pytest.approx(sum(flows))


def test_npv_reference_case():
    # -100 + 60/1.1 + 60/1.21, worked by hand
    assert npv(0.10, [-100, 60, 60]) == pytest.approx(4.132231405, abs=1e-8)


@pytest.mark.parametrize("flows", [
    [-1000, 300, 400, 500, 200],
    [-12e9] + [1.4e9] * 25,
    [-100, 110],
])
def test_irr_matches_numpy_financial(flows):
    value, status = irr(flows)
    assert status == "ok"
    assert value == pytest.approx(float(npf.irr(flows)), abs=1e-9)


def test_irr_exact_case():
    assert irr([-100, 110])[0] == pytest.approx(0.10, abs=1e-10)


def test_irr_can_be_negative():
    value, status = irr([-100, 10, 10, 10])
    assert status == "ok" and value == pytest.approx(-0.4244174438, abs=1e-8)


def test_irr_none_when_cash_flow_never_turns_positive():
    assert irr([-100, -10, -10]) == (None, "no_sign_change")


def test_irr_ambiguous_with_several_sign_changes():
    assert irr([-100, 300, -250, 100]) == (None, "ambiguous")


def test_payback_exact_year():
    assert simple_payback([-100, 50, 50]) == (2.0, "recovered")


def test_payback_interpolates_within_the_year():
    value, status = simple_payback([-100, 60, 60])
    assert status == "recovered" and value == pytest.approx(1 + 40 / 60)


def test_payback_not_recovered():
    assert simple_payback([-100, 10, 10]) == (None, "not_recovered")


def test_payback_zero_when_no_capex():
    assert simple_payback([0, 5, 5]) == (0.0, "recovered")


def test_escalation_compounds_from_year_2():
    cf = cash_flows(
        capex=0,
        energy_kwh=[100, 100, 100],
        revenue_method="fixed_tariff",
        tariff=2,
        tariff_esc=0.10,
        annual_consumption_kwh=None,
        self_consumption_tariff=None,
        feed_in_tariff=None,
        opex=10,
        opex_esc=0.05,
    )
    assert cf.revenues == pytest.approx([200, 220, 242])
    assert cf.opex == pytest.approx([10, 10.5, 11.025])


def test_no_escalation_by_default_values():
    cf = cash_flows(
        capex=0,
        energy_kwh=[100, 100],
        revenue_method="fixed_tariff",
        tariff=2,
        tariff_esc=0,
        annual_consumption_kwh=None,
        self_consumption_tariff=None,
        feed_in_tariff=None,
        opex=10,
        opex_esc=0,
    )
    assert cf.revenues == [200, 200] and cf.opex == [10, 10]


def test_self_consumption_cash_flows():
    energy = [1000, 1000]  # kWh per tahun
    capex = 1_000_000
    opex = 10_000
    
    cf = cash_flows(
        capex=capex,
        energy_kwh=energy,
        revenue_method="self_consumption_savings",
        tariff=None,  # Tidak dipakai di mode ini
        tariff_esc=0,
        annual_consumption_kwh=800,  # kWh
        self_consumption_tariff=1500,  # IDR per kWh
        feed_in_tariff=800,  # IDR per kWh
        opex=opex,
        opex_esc=0,
    )

    # Tahun 1: Q_self=800, Q_grid=200
    # Revenue = 800*1500 + 200*800 = 1_200_000 + 160_000 = 1_360_000
    assert cf.revenues[0] == 1_360_000
    # Cash flow tahun 1 = 1_360_000 - 10_000 = 1_350_000
    assert cf.flows[1] == 1_350_000
