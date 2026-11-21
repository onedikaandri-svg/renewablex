import pytest

from app.services.energy import annual_energy_kwh, net_specific_yield


def test_year_1_energy_matches_methodology_case():
    assert annual_energy_kwh(1000, 1500, 0, 1)[0] == 1_500_000


def test_degradation_starts_in_year_2():
    e = annual_energy_kwh(1000, 1500, 0.005, 3)
    assert e[0] == 1_500_000
    assert e[1] == pytest.approx(1_500_000 * 0.995)
    assert e[2] == pytest.approx(1_500_000 * 0.995**2)


def test_one_value_per_year_of_life():
    assert len(annual_energy_kwh(1, 1, 0, 40)) == 40


def test_loss_applies_once_to_a_gross_yield():
    assert net_specific_yield(1600, "gross_pre_loss", 0.10) == pytest.approx(1440)


def test_net_yield_is_not_reduced_again():
    assert net_specific_yield(1500, "net_ac_at_delivery", 0) == 1500
