import math
from dataclasses import dataclass
from itertools import accumulate

from app.models.schemas import PVRequest
from app.services import energy, finance


class NonFiniteResult(Exception):
    """Raised when inputs are so extreme that a result is not a finite number."""


@dataclass
class Calculation:
    net_yield: float
    kwh: list[float]
    flows: list[float]
    revenues: list[float]
    opex: list[float]
    cumulative: list[float]
    npv: float
    irr: float | None
    irr_status: str
    payback: float | None
    payback_status: str


def calculate(req: PVRequest) -> Calculation:
    p, t, f = req.project, req.technical, req.financial
    net_yield = energy.net_specific_yield(
        t.specific_yield_kwh_per_kwp_year, t.yield_boundary, t.performance_loss_fraction
    )
    kwh = energy.annual_energy_kwh(p.capacity_kwp, net_yield, t.degradation_fraction_per_year, p.lifetime_years)
    cf = finance.cash_flows(
        f.capex_amount, kwh, f.tariff_per_kwh, f.annual_tariff_escalation_fraction,
        f.annual_opex_amount, f.annual_opex_escalation_fraction,
    )
    cumulative = list(accumulate(cf.flows))
    try:
        npv = finance.npv(f.discount_rate_fraction, cf.flows)
        irr, irr_status = finance.irr(cf.flows)
    except (ZeroDivisionError, OverflowError):
        raise NonFiniteResult()
    payback, payback_status = finance.simple_payback(cf.flows)
    if not all(math.isfinite(v) for v in [npv, *cf.flows, *cumulative]):
        raise NonFiniteResult()
    return Calculation(net_yield, kwh, cf.flows, cf.revenues, cf.opex, cumulative,
                       npv, irr, irr_status, payback, payback_status)
