from typing import NamedTuple


class CashFlows(NamedTuple):
    flows: list[float]  # index 0 is year 0
    revenues: list[float]  # index 0 is year 1
    opex: list[float]  # index 0 is year 1


def cash_flows(capex, energy_kwh, tariff, tariff_esc, opex, opex_esc) -> CashFlows:
    """Escalation compounds from year 2, so year 1 uses the base tariff and OPEX."""
    revenues = [e * tariff * (1 + tariff_esc) ** t for t, e in enumerate(energy_kwh)]
    opexes = [opex * (1 + opex_esc) ** t for t in range(len(energy_kwh))]
    return CashFlows([-capex] + [r - o for r, o in zip(revenues, opexes)], revenues, opexes)


def npv(rate: float, flows: list[float]) -> float:
    return sum(cf / (1 + rate) ** t for t, cf in enumerate(flows))


def _sign_changes(flows: list[float]) -> int:
    signs = [cf > 0 for cf in flows if cf != 0]
    return sum(1 for a, b in zip(signs, signs[1:]) if a != b)


def irr(flows: list[float]) -> tuple[float | None, str]:
    """Bisection IRR. Returns (value, status); the value is None unless status is ok."""
    changes = _sign_changes(flows)
    if changes == 0:
        return None, "no_sign_change"
    if changes > 1:
        return None, "ambiguous"
    lo, hi = -0.99, 100.0
    f_lo, f_hi = npv(lo, flows), npv(hi, flows)
    if f_lo * f_hi > 0:
        return None, "not_found"
    for _ in range(300):
        mid = (lo + hi) / 2
        f_mid = npv(mid, flows)
        if f_lo * f_mid <= 0:
            hi = mid
        else:
            lo, f_lo = mid, f_mid
        if hi - lo < 1e-13:
            break
    return (lo + hi) / 2, "ok"


def simple_payback(flows: list[float]) -> tuple[float | None, str]:
    """First year cumulative cash flow reaches zero, interpolated within that year."""
    cum = flows[0]
    if cum >= 0:
        return 0.0, "recovered"
    for t in range(1, len(flows)):
        if cum + flows[t] >= 0:
            return (t - 1) + (-cum / flows[t]), "recovered"
        cum += flows[t]
    return None, "not_recovered"
