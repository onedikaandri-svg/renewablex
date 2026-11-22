from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.api.pv import DISCLAIMER, non_finite
from app.models.schemas import (
    PVRequest, SensitivityBase, SensitivityCase, SensitivityRequest, SensitivityResponse,
    SensitivityVariableResult,
)
from app.services.calculate import Calculation, NonFiniteResult, calculate
from app.version import ENGINE_VERSION, METHODOLOGY_VERSION

router = APIRouter(prefix="/v1/pv", tags=["pv"])

FIELD = {
    "specific_yield": ("technical", "specific_yield_kwh_per_kwp_year"),
    "tariff": ("financial", "tariff_per_kwh"),
    "capex": ("financial", "capex_amount"),
    "opex": ("financial", "annual_opex_amount"),
    "discount_rate": ("financial", "discount_rate_fraction"),
}


def _summary(c: Calculation) -> dict:
    return {
        "npv_amount": round(c.npv, 2),
        "project_irr_fraction": None if c.irr is None else round(c.irr, 8),
        "irr_status": c.irr_status,
        "simple_payback_years": None if c.payback is None else round(c.payback, 4),
        "payback_status": c.payback_status,
    }


def _variant(base: PVRequest, variable: str, shift: float) -> PVRequest:
    data = base.model_dump()
    section, name = FIELD[variable]
    data[section][name] = data[section][name] * (1 + shift)
    try:
        return PVRequest.model_validate(data)
    except ValidationError:
        raise HTTPException(422, detail=[{
            "type": "value_error",
            "code": "shift_out_of_range",
            "loc": ["body", "shifts"],
            "msg": f"A shift of {shift:+.0%} moves {variable} outside its allowed range.",
        }])


@router.post("/sensitivity", response_model=SensitivityResponse)
def sensitivity(req: SensitivityRequest) -> SensitivityResponse:
    try:
        base = calculate(req.base)
        results = []
        for variable in req.variables:
            section, name = FIELD[variable]
            base_value = getattr(getattr(req.base, section), name)
            cases = []
            for shift in sorted(req.shifts):
                variant = _variant(req.base, variable, shift)
                c = calculate(variant)
                cases.append(SensitivityCase(
                    shift_fraction=shift,
                    input_value=round(getattr(getattr(variant, section), name), 8),
                    npv_delta=round(c.npv - base.npv, 2),
                    **_summary(c),
                ))
            results.append(SensitivityVariableResult(
                variable=variable, field=f"{section}.{name}", base_value=base_value,
                max_abs_npv_delta=max(abs(x.npv_delta) for x in cases), cases=cases,
            ))
    except NonFiniteResult:
        raise non_finite()
    results.sort(key=lambda r: r.max_abs_npv_delta, reverse=True)
    return SensitivityResponse(
        engine_version=ENGINE_VERSION,
        methodology_version=METHODOLOGY_VERSION,
        calculated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        scope="pre_tax_unlevered",
        currency_code=req.base.project.currency_code,
        base=SensitivityBase(**_summary(base)),
        variables=results,
        disclaimer=DISCLAIMER,
    )
