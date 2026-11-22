from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.models.schemas import AnnualRow, PVRequest, PVResponse
from app.services.calculate import NonFiniteResult, calculate
from app.version import ENGINE_VERSION, METHODOLOGY_VERSION

router = APIRouter(prefix="/v1/pv", tags=["pv"])

def non_finite() -> HTTPException:
    return HTTPException(422, detail=[{
        "type": "value_error",
        "code": "non_finite_result",
        "loc": ["body"],
        "msg": "The result is not a finite number. Check for extreme inputs.",
    }])


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
    p, t = req.project, req.technical
    try:
        c = calculate(req)
    except NonFiniteResult:
        raise non_finite()

    rows = [AnnualRow(year=0, energy_kwh=0, revenue=0, opex=0, cash_flow=round(c.flows[0], 2),
                      cumulative_cash_flow=round(c.cumulative[0], 2))]
    for i in range(p.lifetime_years):
        rows.append(AnnualRow(
            year=i + 1, energy_kwh=round(c.kwh[i], 3), revenue=round(c.revenues[i], 2),
            opex=round(c.opex[i], 2), cash_flow=round(c.flows[i + 1], 2),
            cumulative_cash_flow=round(c.cumulative[i + 1], 2),
        ))

    return PVResponse(
        engine_version=ENGINE_VERSION,
        methodology_version=METHODOLOGY_VERSION,
        calculated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        scope="pre_tax_unlevered",
        energy_method=t.energy_method,
        currency_code=p.currency_code,
        net_specific_yield_kwh_per_kwp_year=round(c.net_yield, 3),
        year_1_energy_kwh=round(c.kwh[0], 3),
        npv_amount=round(c.npv, 2),
        project_irr_fraction=None if c.irr is None else round(c.irr, 8),
        irr_status=c.irr_status,
        simple_payback_years=None if c.payback is None else round(c.payback, 4),
        payback_status=c.payback_status,
        annual_results=rows,
        warnings=_warnings(req),
        inputs=req,
        disclaimer=DISCLAIMER,
    )
