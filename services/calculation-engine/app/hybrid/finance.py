"""Mesin analisis keuangan proyek hybrid, arus kas tahunan, LCOE, nilai sisa, dan emisi."""

from dataclasses import asdict, dataclass
import math
from typing import Any, Literal

from app.errors import EngineError
from app.hybrid.components import PVWattsConfig
from app.hybrid.lifetime import (
    LifetimeConfig,
    LifetimeSimulationResult,
    YearlyTechnicalResult,
    validate_lifetime_config,
)

TaxModel = Literal["pre_tax", "after_tax"]
RevenueMode = Literal["avoided_cost", "ppa_generation"]
IRRStatus = Literal["ok", "no_sign_change", "ambiguous", "not_found"]
PaybackStatus = Literal["recovered", "not_recovered"]
ViabilityStatus = Literal["viable", "marginal", "unviable"]


def compute_npv(discount_rate: float, cash_flows: list[float] | tuple[float, ...]) -> float:
    """Menghitung Net Present Value (NPV) dari vektor arus kas Tahun 0..N."""
    return float(sum(cf / ((1.0 + discount_rate) ** t) for t, cf in enumerate(cash_flows)))


def _sign_changes(flows: list[float] | tuple[float, ...]) -> int:
    signs = [cf > 0.0 for cf in flows if abs(cf) > 0.0]
    return sum(1 for a, b in zip(signs, signs[1:]) if a != b)


def compute_irr(cash_flows: list[float] | tuple[float, ...]) -> tuple[float | None, IRRStatus]:
    """Menghitung IRR dengan bisection terkurung [-0.99, 100.0] tanpa mengembalikan NaN."""
    changes = _sign_changes(cash_flows)
    if changes == 0:
        return None, "no_sign_change"
    if changes > 1:
        return None, "ambiguous"

    lo, hi = -0.99, 100.0
    f_lo = compute_npv(lo, cash_flows)
    f_hi = compute_npv(hi, cash_flows)
    if f_lo * f_hi > 0.0:
        return None, "not_found"

    for _ in range(300):
        mid = 0.5 * (lo + hi)
        f_mid = compute_npv(mid, cash_flows)
        if f_lo * f_mid <= 0.0:
            hi = mid
        else:
            lo = mid
            f_lo = f_mid
        if hi - lo < 1e-13:
            break
    return 0.5 * (lo + hi), "ok"


def compute_simple_payback(cash_flows: list[float] | tuple[float, ...]) -> tuple[float | None, PaybackStatus]:
    """Tahun pertama arus kas kumulatif tak terdiskonto >= 0 dengan interpolasi linear."""
    if not cash_flows:
        return None, "not_recovered"
    cum = float(cash_flows[0])
    if cum >= 0.0:
        return 0.0, "recovered"
    for t in range(1, len(cash_flows)):
        cf = float(cash_flows[t])
        if cum + cf >= 0.0 and cf > 0.0:
            return (t - 1) + (-cum / cf), "recovered"
        cum += cf
    return None, "not_recovered"


def compute_discounted_payback(
    discounted_cash_flows: list[float] | tuple[float, ...],
) -> tuple[float | None, PaybackStatus]:
    """Tahun pertama arus kas kumulatif terdiskonto >= 0 dengan interpolasi linear."""
    return compute_simple_payback(discounted_cash_flows)


@dataclass(frozen=True)
class FinanceConfig:
    """Parameter masukan analisis keuangan dan emisi untuk simulasi umur proyek."""

    currency_code: str = "IDR"
    tax_model: TaxModel = "pre_tax"
    revenue_mode: RevenueMode = "avoided_cost"

    discount_rate: float = 0.10  # [REAL DATA] WACC nominal pre-tax
    general_inflation_rate: float = 0.0
    tariff_escalation_rate: float = 0.0
    om_escalation_rate: float = 0.0
    fuel_escalation_rate: float = 0.0
    replacement_escalation_rate: float = 0.0

    electricity_tariff_per_kwh: float = 0.0
    grid_import_tariff_per_kwh: float = 0.0
    grid_export_tariff_per_kwh: float = 0.0
    unmet_load_penalty_per_kwh: float = 0.0

    pv_capex: float | None = None
    pv_capex_per_kwp: float = 0.0
    bess_capex: float | None = None
    bess_capex_per_kwh: float = 0.0
    biomass_capex: float | None = None
    biomass_capex_per_kw: float = 0.0
    diesel_capex: float | None = None
    diesel_capex_per_kw: float = 0.0
    bos_and_other_capex: float = 0.0

    capital_grant_amount: float = 0.0
    capital_grant_fraction: float = 0.0
    tax_credit_fraction: float = 0.0

    pv_fixed_om_per_kwp_year: float = 0.0
    pv_om_fraction_of_capex: float | None = None
    bess_fixed_om_per_kwh_year: float = 0.0
    bess_om_fraction_of_capex: float | None = None
    biomass_fixed_om_override: float | None = None
    diesel_fixed_om_override: float | None = None

    bess_design_life_years: float | None = None
    inverter_design_life_years: float | None = None
    biomass_overhaul_life_years: float | None = None
    diesel_overhaul_life_years: float | None = None
    residual_salvage_fraction_of_capex: float = 0.0

    corporate_tax_rate: float = 0.22  # [REAL DATA] tarif umum PPh Badan Indonesia jika after_tax dipilih
    depreciation_years: int | None = None

    grid_emission_factor_kg_co2e_per_kwh: float = 0.78  # [REAL DATA] dari docs/assumptions.md
    viability_irr_margin: float = 0.02


def validate_finance_config(config: FinanceConfig) -> None:
    """Memvalidasi seluruh parameter masukan FinanceConfig."""
    if not isinstance(config.currency_code, str) or not config.currency_code.strip():
        raise EngineError("invalid_finance_config", "currency_code tidak boleh kosong.")
    if config.tax_model not in ("pre_tax", "after_tax"):
        raise EngineError("invalid_finance_config", f"tax_model tidak dikenal: {config.tax_model}.")
    if config.revenue_mode not in ("avoided_cost", "ppa_generation"):
        raise EngineError("invalid_finance_config", f"revenue_mode tidak dikenal: {config.revenue_mode}.")
    if not math.isfinite(config.discount_rate) or config.discount_rate <= -1.0:
        raise EngineError("invalid_finance_config", "discount_rate harus lebih besar dari -1.0.")

    for name, val in (
        ("general_inflation_rate", config.general_inflation_rate),
        ("tariff_escalation_rate", config.tariff_escalation_rate),
        ("om_escalation_rate", config.om_escalation_rate),
        ("fuel_escalation_rate", config.fuel_escalation_rate),
        ("replacement_escalation_rate", config.replacement_escalation_rate),
    ):
        if not math.isfinite(val) or val <= -1.0:
            raise EngineError("invalid_finance_config", f"{name} harus lebih besar dari -1.0.")

    for name, val in (
        ("electricity_tariff_per_kwh", config.electricity_tariff_per_kwh),
        ("grid_import_tariff_per_kwh", config.grid_import_tariff_per_kwh),
        ("grid_export_tariff_per_kwh", config.grid_export_tariff_per_kwh),
        ("unmet_load_penalty_per_kwh", config.unmet_load_penalty_per_kwh),
        ("pv_capex_per_kwp", config.pv_capex_per_kwp),
        ("bess_capex_per_kwh", config.bess_capex_per_kwh),
        ("biomass_capex_per_kw", config.biomass_capex_per_kw),
        ("diesel_capex_per_kw", config.diesel_capex_per_kw),
        ("bos_and_other_capex", config.bos_and_other_capex),
        ("capital_grant_amount", config.capital_grant_amount),
        ("pv_fixed_om_per_kwp_year", config.pv_fixed_om_per_kwp_year),
        ("bess_fixed_om_per_kwh_year", config.bess_fixed_om_per_kwh_year),
        ("grid_emission_factor_kg_co2e_per_kwh", config.grid_emission_factor_kg_co2e_per_kwh),
        ("viability_irr_margin", config.viability_irr_margin),
    ):
        if not math.isfinite(val) or val < 0.0:
            raise EngineError("invalid_finance_config", f"{name} harus >= 0 dan hingga.")

    for name, opt_val in (
        ("pv_capex", config.pv_capex),
        ("bess_capex", config.bess_capex),
        ("biomass_capex", config.biomass_capex),
        ("diesel_capex", config.diesel_capex),
        ("biomass_fixed_om_override", config.biomass_fixed_om_override),
        ("diesel_fixed_om_override", config.diesel_fixed_om_override),
    ):
        if opt_val is not None and (not math.isfinite(opt_val) or opt_val < 0.0):
            raise EngineError("invalid_finance_config", f"{name} tidak boleh negatif.")

    for name, frac in (
        ("capital_grant_fraction", config.capital_grant_fraction),
        ("tax_credit_fraction", config.tax_credit_fraction),
        ("residual_salvage_fraction_of_capex", config.residual_salvage_fraction_of_capex),
        ("corporate_tax_rate", config.corporate_tax_rate),
    ):
        if not math.isfinite(frac) or not (0.0 <= frac < 1.0):
            raise EngineError("invalid_finance_config", f"{name} harus di rentang [0, 1).")

    for name, opt_frac in (
        ("pv_om_fraction_of_capex", config.pv_om_fraction_of_capex),
        ("bess_om_fraction_of_capex", config.bess_om_fraction_of_capex),
    ):
        if opt_frac is not None and (not math.isfinite(opt_frac) or opt_frac < 0.0):
            raise EngineError("invalid_finance_config", f"{name} tidak boleh negatif.")

    for name, life in (
        ("bess_design_life_years", config.bess_design_life_years),
        ("inverter_design_life_years", config.inverter_design_life_years),
        ("biomass_overhaul_life_years", config.biomass_overhaul_life_years),
        ("diesel_overhaul_life_years", config.diesel_overhaul_life_years),
    ):
        if life is not None and (not math.isfinite(life) or life <= 0.0):
            raise EngineError("invalid_finance_config", f"{name} harus lebih besar dari 0.")

    if config.depreciation_years is not None and (
        isinstance(config.depreciation_years, bool)
        or not isinstance(config.depreciation_years, int)
        or config.depreciation_years <= 0
    ):
        raise EngineError("invalid_finance_config", "depreciation_years harus berupa bilangan bulat positif.")


@dataclass(frozen=True)
class YearlyCashFlowRow:
    """Satu baris arus kas tahunan dari Tahun 0 hingga Tahun N."""

    year: int
    served_load_kwh: float
    pv_generation_kwh: float
    biomass_generation_kwh: float
    grid_import_kwh: float
    capex_outflow: float
    gross_revenue_or_savings: float
    export_revenue: float
    om_cost: float
    fuel_and_logistics_cost: float
    grid_import_cost: float
    unmet_load_penalty: float
    replacement_and_overhaul_cost: float
    salvage_inflow: float
    tax_outflow: float
    net_cash_flow: float
    discounted_cash_flow: float
    cumulative_cash_flow: float
    cumulative_discounted_cash_flow: float
    diesel_generation_kwh: float = 0.0


@dataclass(frozen=True)
class LCOEBreakdown:
    """Rincian kontribusi biaya terhadap LCOE total (dalam mata uang/kWh)."""

    capex_pv: float
    capex_bess: float
    capex_biomass: float
    capex_bos: float
    om: float
    fuel_and_logistics: float
    replacement_and_overhaul: float
    grid_import: float
    unmet_load_penalty: float
    tax_net_credit: float
    salvage_credit: float
    export_credit: float
    capex_diesel: float = 0.0

    @property
    def total(self) -> float:
        """Jumlah seluruh pos rincian LCOE."""
        return (
            self.capex_pv
            + self.capex_bess
            + self.capex_biomass
            + self.capex_diesel
            + self.capex_bos
            + self.om
            + self.fuel_and_logistics
            + self.replacement_and_overhaul
            + self.grid_import
            + self.unmet_load_penalty
            + self.tax_net_credit
            + self.salvage_credit
            + self.export_credit
        )


@dataclass(frozen=True)
class EmissionsSummary:
    """Ringkasan emisi CO2e sepanjang umur proyek dibandingkan jaringan listrik baseline."""

    grid_emission_factor_kg_co2e_per_kwh: float
    baseline_grid_emissions_kg_co2e: float
    project_emissions_kg_co2e: float
    avoided_emissions_kg_co2e: float
    avoided_emissions_tons_co2e: float


@dataclass(frozen=True)
class FinanceSummary:
    """Ringkasan metrik keuangan dan kelayakan proyek."""

    currency_code: str
    tax_model: TaxModel
    revenue_mode: RevenueMode
    project_lifetime_years: int
    discount_rate: float
    gross_capex: float
    capital_grant: float
    net_capex: float
    total_npc: float
    lcoe: float
    npv: float
    irr: float | None
    irr_status: IRRStatus
    simple_payback_years: float | None
    simple_payback_status: PaybackStatus
    discounted_payback_years: float | None
    discounted_payback_status: PaybackStatus
    viability_status: ViabilityStatus
    total_discounted_energy_kwh: float
    total_undiscounted_revenue: float
    total_undiscounted_opex_and_fuel: float
    total_undiscounted_replacements: float
    total_salvage_value: float


@dataclass(frozen=True)
class FinanceResult:
    """Keluaran lengkap analisis keuangan, LCOE breakdown, emisi, dan jadwal arus kas."""

    summary: FinanceSummary
    lcoe_breakdown: LCOEBreakdown
    emissions: EmissionsSummary
    schedule: tuple[YearlyCashFlowRow, ...]

    def to_summary_dict(self) -> dict[str, Any]:
        """Mengembalikan ringkasan keuangan, LCOE breakdown, dan emisi siap JSON."""
        return {
            "finance_summary": asdict(self.summary),
            "lcoe_breakdown": asdict(self.lcoe_breakdown),
            "emissions_summary": asdict(self.emissions),
            "cashflow_schedule": [asdict(row) for row in self.schedule],
        }


def _resolve_component_capex(
    finance_config: FinanceConfig,
    pv_capacity_kwp: float,
    bess_capacity_kwh: float,
    biomass_capacity_kw: float,
    diesel_capacity_kw: float,
) -> tuple[float, float, float, float, float]:
    pv_cap = (
        float(finance_config.pv_capex)
        if finance_config.pv_capex is not None
        else pv_capacity_kwp * finance_config.pv_capex_per_kwp
    )
    bess_cap = (
        float(finance_config.bess_capex)
        if finance_config.bess_capex is not None
        else bess_capacity_kwh * finance_config.bess_capex_per_kwh
    )
    bio_cap = (
        float(finance_config.biomass_capex)
        if finance_config.biomass_capex is not None
        else biomass_capacity_kw * finance_config.biomass_capex_per_kw
    )
    diesel_cap = (
        float(finance_config.diesel_capex)
        if finance_config.diesel_capex is not None
        else diesel_capacity_kw * finance_config.diesel_capex_per_kw
    )
    bos_cap = float(finance_config.bos_and_other_capex)
    return pv_cap, bess_cap, bio_cap, diesel_cap, bos_cap


def _event_design_life(event_type: str, fc: FinanceConfig) -> float | None:
    if event_type == "bess_replacement":
        return fc.bess_design_life_years
    if event_type == "inverter_replacement":
        return fc.inverter_design_life_years
    if event_type == "biomass_overhaul":
        return fc.biomass_overhaul_life_years
    if event_type == "diesel_overhaul":
        return fc.diesel_overhaul_life_years
    return None


def run_financial_analysis_from_yearly(
    yearly: tuple[YearlyTechnicalResult, ...] | list[YearlyTechnicalResult],
    finance_config: FinanceConfig,
    pv_capacity_kwp: float = 0.0,
    bess_capacity_kwh: float = 0.0,
    biomass_capacity_kw: float = 0.0,
    diesel_capacity_kw: float = 0.0,
) -> FinanceResult:
    """Menjalankan analisis arus kas, NPC, LCOE, IRR, payback, dan emisi dari hasil tahunan."""
    validate_finance_config(finance_config)
    if not yearly:
        raise EngineError("invalid_finance_config", "Daftar hasil tahunan tidak boleh kosong.")

    fc = finance_config
    n_years = len(yearly)
    pv_capex, bess_capex, bio_capex, diesel_capex, bos_capex = _resolve_component_capex(
        fc,
        pv_capacity_kwp,
        bess_capacity_kwh,
        biomass_capacity_kw,
        diesel_capacity_kw,
    )
    gross_capex = pv_capex + bess_capex + bio_capex + diesel_capex + bos_capex
    grant_total = min(
        fc.capital_grant_amount + gross_capex * fc.capital_grant_fraction,
        gross_capex,
    )
    net_capex = gross_capex - grant_total
    net_capex_factor = (net_capex / gross_capex) if gross_capex > 0.0 else 1.0

    pv_base_om = (
        pv_capex * fc.pv_om_fraction_of_capex
        if fc.pv_om_fraction_of_capex is not None
        else pv_capacity_kwp * fc.pv_fixed_om_per_kwp_year
    )
    bess_base_om = (
        bess_capex * fc.bess_om_fraction_of_capex
        if fc.bess_om_fraction_of_capex is not None
        else bess_capacity_kwh * fc.bess_fixed_om_per_kwh_year
    )

    dep_years = fc.depreciation_years if fc.depreciation_years is not None else min(n_years, 10)
    annual_dep = (net_capex / dep_years) if (fc.tax_model == "after_tax" and dep_years > 0) else 0.0

    schedule: list[YearlyCashFlowRow] = []
    cash_flows: list[float] = [-net_capex]
    discounted_cfs: list[float] = [-net_capex]

    cum_cf = -net_capex
    cum_dcf = -net_capex
    schedule.append(
        YearlyCashFlowRow(
            year=0,
            served_load_kwh=0.0,
            pv_generation_kwh=0.0,
            biomass_generation_kwh=0.0,
            grid_import_kwh=0.0,
            capex_outflow=net_capex,
            gross_revenue_or_savings=0.0,
            export_revenue=0.0,
            om_cost=0.0,
            fuel_and_logistics_cost=0.0,
            grid_import_cost=0.0,
            unmet_load_penalty=0.0,
            replacement_and_overhaul_cost=0.0,
            salvage_inflow=0.0,
            tax_outflow=0.0,
            net_cash_flow=-net_capex,
            discounted_cash_flow=-net_capex,
            cumulative_cash_flow=cum_cf,
            cumulative_discounted_cash_flow=cum_dcf,
            diesel_generation_kwh=0.0,
        )
    )

    pv_om_total = 0.0
    pv_fuel_total = 0.0
    pv_repl_total = 0.0
    pv_grid_imp_total = 0.0
    pv_unmet_total = 0.0
    pv_tax_total = 0.0
    pv_export_total = 0.0
    pv_salvage_total = 0.0
    pv_energy_denom = 0.0

    undiscounted_rev = 0.0
    undiscounted_opex_fuel = 0.0
    undiscounted_repl = 0.0
    total_salvage_value = 0.0

    baseline_emissions_kg = 0.0
    project_emissions_kg = 0.0

    salvage_from_replacements = 0.0
    for row in yearly:
        y = row.year
        repl_esc = (1.0 + fc.replacement_escalation_rate) ** (y - 1)
        for ev in row.lifecycle_events:
            life = _event_design_life(ev.event_type, fc)
            if life is not None:
                remaining = life - (n_years - y)
                if remaining > 0.0:
                    salvage_from_replacements += (ev.cost_amount * repl_esc) * (remaining / life)

    residual_salvage = fc.residual_salvage_fraction_of_capex * gross_capex

    for row in yearly:
        y = row.year
        tariff_esc = (1.0 + fc.tariff_escalation_rate) ** (y - 1)
        om_esc = (1.0 + fc.om_escalation_rate) ** (y - 1)
        fuel_esc = (1.0 + fc.fuel_escalation_rate) ** (y - 1)
        repl_esc = (1.0 + fc.replacement_escalation_rate) ** (y - 1)
        disc_factor = 1.0 / ((1.0 + fc.discount_rate) ** y)

        if fc.revenue_mode == "avoided_cost":
            self_served_kwh = max(row.served_load_kwh - row.grid_import_kwh, 0.0)
            gross_rev = self_served_kwh * fc.electricity_tariff_per_kwh * tariff_esc
        else:
            gross_rev = row.served_load_kwh * fc.electricity_tariff_per_kwh * tariff_esc

        export_rev = row.grid_export_kwh * fc.grid_export_tariff_per_kwh * tariff_esc
        grid_imp_cost = row.grid_import_kwh * fc.grid_import_tariff_per_kwh * tariff_esc
        unmet_pen = row.unmet_load_kwh * fc.unmet_load_penalty_per_kwh * tariff_esc

        bio_fix = (
            fc.biomass_fixed_om_override
            if fc.biomass_fixed_om_override is not None
            else row.biomass_fixed_om_cost
        )
        diesel_fix = (
            fc.diesel_fixed_om_override
            if fc.diesel_fixed_om_override is not None
            else row.diesel_fixed_om_cost
        )
        om_cost = (
            pv_base_om
            + bess_base_om
            + bio_fix
            + row.biomass_variable_om_cost
            + row.biomass_startup_cost
            + diesel_fix
            + row.diesel_variable_om_cost
            + row.diesel_startup_cost
        ) * om_esc
        fuel_cost = (row.biomass_fuel_cost + row.biomass_logistics_cost + row.diesel_fuel_cost) * fuel_esc
        repl_cost = sum(ev.cost_amount for ev in row.lifecycle_events) * repl_esc

        salvage_inflow = (salvage_from_replacements + residual_salvage) if y == n_years else 0.0

        tax_out = 0.0
        if fc.tax_model == "after_tax":
            dep_y = annual_dep if y <= dep_years else 0.0
            ebitda_y = gross_rev + export_rev - om_cost - fuel_cost - grid_imp_cost - unmet_pen
            taxable_y = max(ebitda_y - dep_y, 0.0)
            tax_out = taxable_y * fc.corporate_tax_rate
            if y == 1 and fc.tax_credit_fraction > 0.0:
                tax_out -= net_capex * fc.tax_credit_fraction

        net_cf = (
            gross_rev
            + export_rev
            + salvage_inflow
            - om_cost
            - fuel_cost
            - grid_imp_cost
            - unmet_pen
            - repl_cost
            - tax_out
        )
        dcf = net_cf * disc_factor
        cum_cf += net_cf
        cum_dcf += dcf

        cash_flows.append(net_cf)
        discounted_cfs.append(dcf)

        pv_om_total += om_cost * disc_factor
        pv_fuel_total += fuel_cost * disc_factor
        pv_repl_total += repl_cost * disc_factor
        pv_grid_imp_total += grid_imp_cost * disc_factor
        pv_unmet_total += unmet_pen * disc_factor
        pv_tax_total += tax_out * disc_factor
        pv_export_total += export_rev * disc_factor
        pv_salvage_total += salvage_inflow * disc_factor
        pv_energy_denom += row.served_load_kwh * disc_factor

        undiscounted_rev += gross_rev + export_rev
        undiscounted_opex_fuel += om_cost + fuel_cost + grid_imp_cost
        undiscounted_repl += repl_cost
        total_salvage_value += salvage_inflow

        ef = fc.grid_emission_factor_kg_co2e_per_kwh
        baseline_emissions_kg += row.served_load_kwh * ef
        project_emissions_kg += row.grid_import_kwh * ef + row.biomass_co2e_kg + row.diesel_co2e_kg

        schedule.append(
            YearlyCashFlowRow(
                year=y,
                served_load_kwh=row.served_load_kwh,
                pv_generation_kwh=row.pv_generation_kwh,
                biomass_generation_kwh=row.biomass_generation_kwh,
                grid_import_kwh=row.grid_import_kwh,
                capex_outflow=0.0,
                gross_revenue_or_savings=gross_rev,
                export_revenue=export_rev,
                om_cost=om_cost,
                fuel_and_logistics_cost=fuel_cost,
                grid_import_cost=grid_imp_cost,
                unmet_load_penalty=unmet_pen,
                replacement_and_overhaul_cost=repl_cost,
                salvage_inflow=salvage_inflow,
                tax_outflow=tax_out,
                net_cash_flow=net_cf,
                discounted_cash_flow=dcf,
                cumulative_cash_flow=cum_cf,
                cumulative_discounted_cash_flow=cum_dcf,
                diesel_generation_kwh=row.diesel_generation_kwh,
            )
        )

    total_npc = (
        net_capex
        + pv_om_total
        + pv_fuel_total
        + pv_repl_total
        + pv_grid_imp_total
        + pv_unmet_total
        + pv_tax_total
        - pv_salvage_total
        - pv_export_total
    )

    if pv_energy_denom > 0.0:
        lcoe = total_npc / pv_energy_denom
        breakdown = LCOEBreakdown(
            capex_pv=(pv_capex * net_capex_factor) / pv_energy_denom,
            capex_bess=(bess_capex * net_capex_factor) / pv_energy_denom,
            capex_biomass=(bio_capex * net_capex_factor) / pv_energy_denom,
            capex_bos=(bos_capex * net_capex_factor) / pv_energy_denom,
            om=pv_om_total / pv_energy_denom,
            fuel_and_logistics=pv_fuel_total / pv_energy_denom,
            replacement_and_overhaul=pv_repl_total / pv_energy_denom,
            grid_import=pv_grid_imp_total / pv_energy_denom,
            unmet_load_penalty=pv_unmet_total / pv_energy_denom,
            tax_net_credit=pv_tax_total / pv_energy_denom,
            salvage_credit=-pv_salvage_total / pv_energy_denom,
            export_credit=-pv_export_total / pv_energy_denom,
            capex_diesel=(diesel_capex * net_capex_factor) / pv_energy_denom,
        )
    else:
        lcoe = 0.0
        breakdown = LCOEBreakdown(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

    npv_val = cum_dcf
    irr_val, irr_status = compute_irr(cash_flows)
    spb_val, spb_status = compute_simple_payback(cash_flows)
    dpb_val, dpb_status = compute_discounted_payback(discounted_cfs)

    if npv_val > 0.0 and irr_val is not None and irr_val >= fc.discount_rate + fc.viability_irr_margin:
        viability: ViabilityStatus = "viable"
    elif npv_val >= 0.0 and (irr_val is None or irr_val >= fc.discount_rate):
        viability = "marginal"
    else:
        viability = "unviable"

    avoided_kg = baseline_emissions_kg - project_emissions_kg
    emissions = EmissionsSummary(
        grid_emission_factor_kg_co2e_per_kwh=fc.grid_emission_factor_kg_co2e_per_kwh,
        baseline_grid_emissions_kg_co2e=baseline_emissions_kg,
        project_emissions_kg_co2e=project_emissions_kg,
        avoided_emissions_kg_co2e=avoided_kg,
        avoided_emissions_tons_co2e=avoided_kg / 1000.0,
    )

    summary = FinanceSummary(
        currency_code=fc.currency_code,
        tax_model=fc.tax_model,
        revenue_mode=fc.revenue_mode,
        project_lifetime_years=n_years,
        discount_rate=fc.discount_rate,
        gross_capex=gross_capex,
        capital_grant=grant_total,
        net_capex=net_capex,
        total_npc=total_npc,
        lcoe=lcoe,
        npv=npv_val,
        irr=irr_val,
        irr_status=irr_status,
        simple_payback_years=spb_val,
        simple_payback_status=spb_status,
        discounted_payback_years=dpb_val,
        discounted_payback_status=dpb_status,
        viability_status=viability,
        total_discounted_energy_kwh=pv_energy_denom,
        total_undiscounted_revenue=undiscounted_rev,
        total_undiscounted_opex_and_fuel=undiscounted_opex_fuel,
        total_undiscounted_replacements=undiscounted_repl,
        total_salvage_value=total_salvage_value,
    )

    return FinanceResult(
        summary=summary,
        lcoe_breakdown=breakdown,
        emissions=emissions,
        schedule=tuple(schedule),
    )


def run_financial_analysis(
    lifetime_result: LifetimeSimulationResult,
    finance_config: FinanceConfig,
) -> FinanceResult:
    """Menjalankan analisis keuangan dan emisi langsung dari hasil simulasi multi-tahun."""
    sim_cfg = lifetime_result.year_1_result.config
    pv_kwp = (
        sim_cfg.pv.capacity_kwp
        if isinstance(sim_cfg.pv, PVWattsConfig)
        else sim_cfg.pv.effective_dc_capacity_kwp
    )
    bess_kwh = sim_cfg.bess.nominal_capacity_kwh if sim_cfg.bess is not None else 0.0
    bio_kw = sim_cfg.biomass.rated_capacity_kw if sim_cfg.biomass is not None else 0.0
    diesel_kw = sim_cfg.diesel.rated_capacity_kw if sim_cfg.diesel is not None else 0.0
    return run_financial_analysis_from_yearly(
        yearly=lifetime_result.yearly,
        finance_config=finance_config,
        pv_capacity_kwp=pv_kwp,
        bess_capacity_kwh=bess_kwh,
        biomass_capacity_kw=bio_kw,
        diesel_capacity_kw=diesel_kw,
    )


def resolve_lifetime_config(
    sim_raw: dict[str, Any],
    finance_raw: dict[str, Any] | None = None,
) -> LifetimeConfig:
    """Mem-parsing konfigurasi simulasi multi-tahun dari JSON konfigurasi CLI."""
    fin = finance_raw or {}
    cfg = LifetimeConfig(
        project_lifetime_years=int(sim_raw.get("project_lifetime_years", 25)),
        multi_year_mode=str(sim_raw.get("multi_year_mode", "full_hourly")),  # type: ignore[arg-type]
        pv_annual_degradation_fraction=(
            None
            if sim_raw.get("pv_annual_degradation_fraction") is None
            else float(sim_raw["pv_annual_degradation_fraction"])
        ),
        inverter_replacement_year=(
            None if fin.get("inverter_replacement_year") is None else int(fin["inverter_replacement_year"])
        ),
        inverter_replacement_cost=float(fin.get("inverter_replacement_cost", 0.0)),
        scaled_bess_replacement_interval_years=(
            None
            if sim_raw.get("scaled_bess_replacement_interval_years") is None
            else int(sim_raw["scaled_bess_replacement_interval_years"])
        ),
        scaled_biomass_overhaul_interval_years=(
            None
            if sim_raw.get("scaled_biomass_overhaul_interval_years") is None
            else int(sim_raw["scaled_biomass_overhaul_interval_years"])
        ),
        scaled_diesel_overhaul_interval_years=(
            None
            if sim_raw.get("scaled_diesel_overhaul_interval_years") is None
            else int(sim_raw["scaled_diesel_overhaul_interval_years"])
        ),
    )
    validate_lifetime_config(cfg)
    return cfg


def resolve_finance_config(raw: dict[str, Any], currency_code: str = "IDR") -> FinanceConfig:
    """Mem-parsing blok JSON `finance` menjadi FinanceConfig yang tervalidasi."""
    data = dict(raw)
    data.pop("inverter_replacement_year", None)
    data.pop("inverter_replacement_cost", None)
    data.setdefault("currency_code", currency_code)
    try:
        cfg = FinanceConfig(**data)
    except TypeError as exc:
        raise EngineError("invalid_finance_config", f"Konfigurasi keuangan tidak valid: {exc}.") from exc
    validate_finance_config(cfg)
    return cfg
