import math
from datetime import datetime, timezone
from itertools import accumulate

from fastapi import APIRouter, HTTPException

from app.models.schemas import AnnualRow, PVRequest, PVResponse
from app.services import energy, finance
from app.version import ENGINE_VERSION, METHODOLOGY_VERSION

router = APIRouter(prefix="/v1/pv", tags=["pv"])

DISCLAIMER = "Preliminary, pre-tax, unlevered estimate. Validate all assumptions independently."


def _warnings(req: PVRequest) -> list[str]:
    t, out = req.technical, []
    if t.specific_yield_kwh_per_kwp_year and t.specific_yield_kwh_per_kwp_year > 2500:
        out.append("Specific yield above 2,500 kWh/kWp/year is unusual. Check the source and the yield boundary.")
    if t.degradation_fraction_per_year > 0.02:
        out.append("Degradation above 2% per year is unusual for PV modules.")
    if t.performance_loss_fraction > 0.35:
        out.append("Performance loss above 35% is unusual. Check that it is not counted elsewhere.")
    return out


@router.post("/preliminary", response_model=PVResponse)
def preliminary(req: PVRequest) -> PVResponse:
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
        raise HTTPException(422, "The result is not a finite number. Check for extreme inputs.")
    payback, payback_status = finance.simple_payback(cf.flows)

    if not all(math.isfinite(v) for v in [npv, *cf.flows, *cumulative]):
        raise HTTPException(422, "The result is not a finite number. Check for extreme inputs.")

    rows = [AnnualRow(year=0, energy_kwh=0, revenue=0, opex=0, cash_flow=round(cf.flows[0], 2),
                      cumulative_cash_flow=round(cumulative[0], 2))]
    for i in range(p.lifetime_years):
        rows.append(AnnualRow(
            year=i + 1, energy_kwh=round(kwh[i], 3), revenue=round(cf.revenues[i], 2),
            opex=round(cf.opex[i], 2), cash_flow=round(cf.flows[i + 1], 2),
            cumulative_cash_flow=round(cumulative[i + 1], 2),
        ))

    return PVResponse(
        engine_version=ENGINE_VERSION,
        methodology_version=METHODOLOGY_VERSION,
        calculated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        scope="pre_tax_unlevered",
        energy_method=t.energy_method,
        currency_code=p.currency_code,
        net_specific_yield_kwh_per_kwp_year=round(net_yield, 3),
        year_1_energy_kwh=round(kwh[0], 3),
        npv_amount=round(npv, 2),
        project_irr_fraction=None if irr is None else round(irr, 8),
        irr_status=irr_status,
        simple_payback_years=None if payback is None else round(payback, 4),
        payback_status=payback_status,
        annual_results=rows,
        warnings=_warnings(req),
        inputs=req,
        disclaimer=DISCLAIMER,
    )
