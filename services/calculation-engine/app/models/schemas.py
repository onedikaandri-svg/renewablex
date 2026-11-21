from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    # Unknown fields are rejected so an ignored assumption never goes unnoticed.
    model_config = ConfigDict(extra="forbid")


class Project(Strict):
    project_name: str = Field(min_length=1, max_length=120)
    technology: Literal["solar_pv"]
    project_type: Literal["ground_mounted", "rooftop", "floating", "carport"]
    country_code: str = Field(pattern=r"^[A-Z]{2}$")
    location_name: str | None = Field(default=None, max_length=200)
    capacity_kwp: float = Field(gt=0, le=1e7)
    lifetime_years: int = Field(ge=1, le=40)
    currency_code: str = Field(pattern=r"^[A-Z]{3}$")


class Technical(Strict):
    energy_method: Literal["manual_specific_yield", "location_based"]
    specific_yield_kwh_per_kwp_year: float | None = Field(default=None, gt=0, le=10000)
    yield_boundary: Literal["net_ac_at_delivery", "gross_pre_loss"]
    performance_loss_fraction: float = Field(default=0, ge=0, lt=1)
    degradation_fraction_per_year: float = Field(ge=0, lt=1)

    @model_validator(mode="after")
    def check_energy_inputs(self):
        if self.energy_method == "location_based":
            raise ValueError("location_based needs a configured resource provider. Use manual_specific_yield.")
        if self.specific_yield_kwh_per_kwp_year is None:
            raise ValueError("specific_yield_kwh_per_kwp_year is required for manual_specific_yield.")
        if self.yield_boundary == "net_ac_at_delivery" and self.performance_loss_fraction != 0:
            raise ValueError("performance_loss_fraction must be 0 when the yield is already net, or losses count twice.")
        return self


class Financial(Strict):
    capex_amount: float = Field(ge=0, le=1e18)
    annual_opex_amount: float = Field(ge=0, le=1e18)
    revenue_method: Literal["fixed_tariff", "self_consumption_savings"]
    tariff_per_kwh: float = Field(ge=0, le=1e9)
    discount_rate_fraction: float = Field(gt=-1, le=1)
    annual_tariff_escalation_fraction: float = Field(default=0, gt=-1, le=1)
    annual_opex_escalation_fraction: float = Field(default=0, gt=-1, le=1)
    tax_model: Literal["pre_tax"]

    @model_validator(mode="after")
    def check_revenue_method(self):
        if self.revenue_method != "fixed_tariff":
            raise ValueError("Only fixed_tariff is supported in this version.")
        return self


class PVRequest(Strict):
    project: Project
    technical: Technical
    financial: Financial
    notes: str | None = Field(default=None, max_length=2000)


class AnnualRow(BaseModel):
    year: int
    energy_kwh: float
    revenue: float
    opex: float
    cash_flow: float
    cumulative_cash_flow: float


class PVResponse(BaseModel):
    engine_version: str
    methodology_version: str
    calculated_at: str
    scope: Literal["pre_tax_unlevered"]
    energy_method: str
    currency_code: str
    net_specific_yield_kwh_per_kwp_year: float
    year_1_energy_kwh: float
    npv_amount: float
    project_irr_fraction: float | None
    irr_status: Literal["ok", "no_sign_change", "ambiguous", "not_found"]
    simple_payback_years: float | None
    payback_status: Literal["recovered", "not_recovered"]
    annual_results: list[AnnualRow]
    warnings: list[str]
    inputs: PVRequest
    disclaimer: str
