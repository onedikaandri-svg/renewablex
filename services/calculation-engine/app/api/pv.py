from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException

from app.models.schemas import AnnualRow, PVRequest, PVResponse
from app.providers.base import ResourceError, ResourceErrorKind
from app.providers.pvgis import PVGISProvider
from app.providers.nasa import NASAProvider
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


def _fetch_resource(req: PVRequest) -> tuple[PVRequest, dict[str, Any] | None]:
    """Mengambil data dari provider jika location_based. Mengembalikan req yang sudah diperbarui."""
    t = req.technical
    if t.energy_method != "location_based":
        return req, None

    if t.resource_source == "pvgis":
        provider = PVGISProvider(loss_percent=t.performance_loss_fraction * 100)
    elif t.resource_source == "nasa":
        # NASA menggunakan Performance Ratio internal (bawaan 0.75)
        provider = NASAProvider()
    else:
        raise HTTPException(422, detail=[{
            "type": "value_error",
            "code": "resource_source_unavailable",
            "loc": ["body", "technical", "resource_source"],
            "msg": f"Sumber data {t.resource_source} tidak dikenal.",
        }])

    try:
        res = provider.get_resource(
            latitude=t.latitude,
            longitude=t.longitude,
            tilt_degrees=t.tilt_degrees,
            azimuth_degrees=t.azimuth_degrees,
        )
    except ResourceError as e:
        code = {
            ResourceErrorKind.OUT_OF_COVERAGE: "out_of_coverage",
            ResourceErrorKind.UNAVAILABLE: "provider_unavailable",
            ResourceErrorKind.TIMEOUT: "provider_timeout",
            ResourceErrorKind.INVALID_RESPONSE: "provider_invalid_response",
        }.get(e.kind, "provider_error")
        raise HTTPException(422, detail=[{
            "type": "value_error",
            "code": code,
            "loc": ["body", "technical"],
            "msg": str(e),
        }]) from e

    # Perbarui Technical dengan data dari provider
    t_updated = t.model_copy(update={
        "specific_yield_kwh_per_kwp_year": res.specific_yield_kwh_per_kwp_year,
        "yield_boundary": res.yield_boundary,
        "performance_loss_fraction": 0.0, # Loss sudah dihitung provider
    })
    req_updated = req.model_copy(update={"technical": t_updated})
    
    metadata = {
        "provider": res.provider_name,
        "dataset": res.dataset,
        "version": res.dataset_version,
        "period": res.period,
        "retrieved_at": res.retrieval_timestamp,
    }
    return req_updated, metadata


def _warnings(req: PVRequest, metadata: dict[str, Any] | None) -> tuple[list[str], list[str]]:
    t = req.technical
    warnings, codes = [], []
    
    if metadata:
        dataset_name = metadata.get("dataset") or metadata.get("provider")
        warnings.append(f"Data radiasi diambil dari {dataset_name} ({metadata.get('period', 'periode tidak diketahui')}).")
        codes.append("resource_data_fetched")
    
    if t.specific_yield_kwh_per_kwp_year and t.specific_yield_kwh_per_kwp_year > 2500:
        warnings.append("Specific yield above 2,500 kWh/kWp/year is unusual. Check the source and the yield boundary.")
        codes.append("high_specific_yield")
        
    if t.degradation_fraction_per_year > 0.02:
        warnings.append("Degradation above 2% per year is unusual for PV modules.")
        codes.append("high_degradation")
        
    if t.performance_loss_fraction > 0.35:
        warnings.append("Performance loss above 35% is unusual. Check that it is not counted elsewhere.")
        codes.append("high_performance_loss")
        
    return warnings, codes


@router.post("/preliminary", response_model=PVResponse)
def preliminary(req: PVRequest) -> PVResponse:
    # Ambil data lokasi jika perlu
    req, metadata = _fetch_resource(req)
    
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

    warnings, warning_codes = _warnings(req, metadata)

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
        warnings=warnings,
        warning_codes=warning_codes,
        resource_metadata=metadata,
        inputs=req,
        disclaimer=DISCLAIMER,
    )
