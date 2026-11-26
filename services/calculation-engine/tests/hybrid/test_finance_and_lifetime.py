"""Tes simulasi multi-tahun, keuangan, LCOE, nilai sisa, emisi, dan kasus pembanding kiyo.html."""

import csv
import json
from pathlib import Path

import numpy as np
import numpy_financial as npf
import pytest

from app.errors import EngineError
from app.hybrid.bess import BESSConfig
from app.hybrid.biomass import build_sample_biomass_config
from app.hybrid.cli import main
from app.hybrid.components import LifecycleEvent, PVWattsConfig
from app.hybrid.dispatch import DispatchConfig
from app.hybrid.finance import (
    FinanceConfig,
    compute_discounted_payback,
    compute_irr,
    compute_npv,
    compute_simple_payback,
    run_financial_analysis,
    run_financial_analysis_from_yearly,
    validate_finance_config,
)
from app.hybrid.lifetime import (
    LifetimeConfig,
    YearlyTechnicalResult,
    run_lifetime_simulation,
    validate_lifetime_config,
)
from app.hybrid.load import generate_synthetic_load
from app.hybrid.pv_detailed import PVDetailedConfig
from app.hybrid.simulator import SimulationConfig
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import WeatherDataset, WeatherMetadata

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _make_weather(tc: TimeConfig) -> WeatherDataset:
    n = tc.steps_per_year
    hours = tc.hour_of_day()
    daytime = (hours >= 6.0) & (hours <= 18.0)
    angle = np.where(daytime, np.sin(np.pi * (hours - 6.0) / 12.0), 0.0)
    meta = WeatherMetadata("test", "clear", "1.0", "test", -6.2, 106.8, 16.0, tc.timezone, tc.utc_offset_hours, "now")
    return WeatherDataset(
        ghi_w_m2=880.0 * angle,
        dni_w_m2=750.0 * angle,
        dhi_w_m2=170.0 * angle,
        temp_air_c=np.full(n, 29.0),
        wind_speed_m_s=np.full(n, 2.0),
        time_config=tc,
        metadata=meta,
    )


def _dummy_yearly_rows(n_years: int, kwh_per_year: float = 100000.0) -> tuple[YearlyTechnicalResult, ...]:
    return tuple(
        YearlyTechnicalResult(
            year=y,
            pv_degradation_factor=1.0,
            total_load_kwh=kwh_per_year,
            pv_generation_kwh=kwh_per_year,
            biomass_generation_kwh=0.0,
            served_load_kwh=kwh_per_year,
            unmet_load_kwh=0.0,
            curtailment_kwh=0.0,
            grid_import_kwh=0.0,
            grid_export_kwh=0.0,
            renewable_fraction=1.0,
            max_balance_error_kw=0.0,
        )
        for y in range(1, n_years + 1)
    )


class TestValidationStage4:
    def test_invalid_lifetime_and_finance_configs_raise_engine_error(self):
        for bad_lc in (
            LifetimeConfig(project_lifetime_years=0),
            LifetimeConfig(project_lifetime_years=41),
            LifetimeConfig(multi_year_mode="magic"),  # type: ignore[arg-type]
            LifetimeConfig(pv_annual_degradation_fraction=1.0),
            LifetimeConfig(project_lifetime_years=5, inverter_replacement_year=6),
            LifetimeConfig(inverter_replacement_cost=-1.0),
        ):
            with pytest.raises(EngineError) as exc_info:
                validate_lifetime_config(bad_lc)
            assert exc_info.value.code == "invalid_lifetime_config"

        for bad_fc in (
            FinanceConfig(currency_code=""),
            FinanceConfig(tax_model="flat"),  # type: ignore[arg-type]
            FinanceConfig(revenue_mode="unknown"),  # type: ignore[arg-type]
            FinanceConfig(discount_rate=-1.0),
            FinanceConfig(tariff_escalation_rate=-1.0),
            FinanceConfig(pv_capex=-100.0),
            FinanceConfig(capital_grant_fraction=1.0),
            FinanceConfig(corporate_tax_rate=1.0),
            FinanceConfig(bess_design_life_years=0.0),
            FinanceConfig(depreciation_years=0),
        ):
            with pytest.raises(EngineError) as exc_info:
                validate_finance_config(bad_fc)
            assert exc_info.value.code == "invalid_finance_config"


class TestFinancialFormulasAndCrossValidation:
    def test_npv_irr_and_payback_match_hand_calculation_and_numpy_financial(self):
        flows = [-1000.0, 400.0, 400.0, 400.0, 400.0]
        r = 0.10
        assert compute_npv(r, flows) == pytest.approx(float(npf.npv(r, flows)), rel=1e-12)

        irr_val, irr_status = compute_irr(flows)
        assert irr_status == "ok"
        assert irr_val == pytest.approx(float(npf.irr(flows)), rel=1e-9)

        # Payback sederhana: tahun 1 -> -600, tahun 2 -> -200, tahun 3 -> +200 => 2 + 200/400 = 2.5 tahun.
        spb, spb_status = compute_simple_payback(flows)
        assert spb_status == "recovered"
        assert spb == pytest.approx(2.5, rel=1e-12)

        # Payback terdiskonto pada r = 10%.
        dcf = [cf / ((1.0 + r) ** t) for t, cf in enumerate(flows)]
        dpb, dpb_status = compute_discounted_payback(dcf)
        assert dpb_status == "recovered"
        assert dpb is not None and 3.0 < dpb < 4.0

        # Kasus status IRR khusus.
        assert compute_irr([-100.0, -50.0])[1] == "no_sign_change"
        assert compute_irr([-100.0, 230.0, -132.0])[1] == "ambiguous"
        assert compute_simple_payback([-100.0, 10.0, 10.0]) == (None, "not_recovered")

    def test_lcoe_breakdown_salvage_grant_and_after_tax(self):
        rows = list(_dummy_yearly_rows(5, kwh_per_year=100000.0))
        # Sisipkan penggantian BESS pada tahun ke-3 sebesar 100.000.000 dengan umur desain 5 tahun:
        # Sisa umur di akhir Tahun 5 = 5 - (5 - 3) = 3 tahun => nilai sisa = 100 jt * (3/5) = 60 jt.
        rows[2] = YearlyTechnicalResult(
            year=3,
            pv_degradation_factor=1.0,
            total_load_kwh=100000.0,
            pv_generation_kwh=100000.0,
            biomass_generation_kwh=0.0,
            served_load_kwh=100000.0,
            unmet_load_kwh=0.0,
            curtailment_kwh=0.0,
            grid_import_kwh=0.0,
            grid_export_kwh=20000.0,
            renewable_fraction=1.0,
            max_balance_error_kw=0.0,
            lifecycle_events=(LifecycleEvent(3, "bess_replacement", "Ganti BESS", 100_000_000.0),),
        )

        fc_pre = FinanceConfig(
            tax_model="pre_tax",
            discount_rate=0.10,
            pv_capex=400_000_000.0,
            bess_capex=100_000_000.0,
            capital_grant_fraction=0.10,  # Hibah 50 jt => net capex 450 jt.
            pv_fixed_om_per_kwp_year=50_000.0,
            electricity_tariff_per_kwh=1500.0,
            grid_export_tariff_per_kwh=500.0,
            bess_design_life_years=5.0,
            grid_emission_factor_kg_co2e_per_kwh=0.78,
        )
        res_pre = run_financial_analysis_from_yearly(rows, fc_pre, pv_capacity_kwp=100.0, bess_capacity_kwh=50.0)
        assert res_pre.summary.gross_capex == pytest.approx(500_000_000.0)
        assert res_pre.summary.capital_grant == pytest.approx(50_000_000.0)
        assert res_pre.summary.net_capex == pytest.approx(450_000_000.0)
        assert res_pre.summary.total_salvage_value == pytest.approx(60_000_000.0)
        assert res_pre.lcoe_breakdown.total == pytest.approx(res_pre.summary.lcoe, rel=1e-12)
        assert res_pre.emissions.avoided_emissions_tons_co2e == pytest.approx((5 * 100000.0 * 0.78) / 1000.0)

        fc_after = FinanceConfig(
            tax_model="after_tax",
            discount_rate=0.10,
            pv_capex=400_000_000.0,
            bess_capex=100_000_000.0,
            capital_grant_fraction=0.10,
            tax_credit_fraction=0.05,
            pv_fixed_om_per_kwp_year=50_000.0,
            electricity_tariff_per_kwh=1500.0,
            grid_export_tariff_per_kwh=500.0,
            bess_design_life_years=5.0,
            corporate_tax_rate=0.22,
            depreciation_years=5,
        )
        res_after = run_financial_analysis_from_yearly(rows, fc_after, pv_capacity_kwp=100.0, bess_capacity_kwh=50.0)
        assert res_after.lcoe_breakdown.total == pytest.approx(res_after.summary.lcoe, rel=1e-12)
        assert res_after.schedule[2].tax_outflow > 0.0
        assert res_after.summary.npv != res_pre.summary.npv


class TestKiyoPrototypeBenchmark:
    def test_matches_kiyo_html_default_case_within_tight_tolerance(self):
        # Kasus bawaan docs/reference/kiyo.html:
        # 500 kWp, 1450 kWh/kWp/thn, deg 0.55%/thn, CAPEX Rp 11.5 jt/kWp, OM 1.5% CAPEX (inflasi 2%),
        # tarif Rp 1.445/kWh (eskalasi 2%), WACC 9.5%, umur 25 tahun, emisi 0.78 kg/kWh.
        capacity_kwp = 500.0
        spec_yield = 1450.0
        deg = 0.0055
        capex_per_kwp = 11_500_000.0
        om_frac = 0.015
        om_inf = 0.02
        tariff = 1445.0
        esc = 0.02
        wacc = 0.095
        lifetime = 25

        # Hitung ulang tepat sesuai fungsi runFinancialModel di docs/reference/kiyo.html.
        total_capex = capacity_kwp * capex_per_kwp
        kiyo_cfs = [-total_capex]
        kiyo_dcfs = [-total_capex]
        disc_costs = total_capex
        disc_energy = 0.0
        tot_energy = 0.0
        yearly_rows: list[YearlyTechnicalResult] = []
        for yr in range(1, lifetime + 1):
            e_kwh = capacity_kwp * spec_yield * ((1.0 - deg) ** (yr - 1))
            yr_tariff = tariff * ((1.0 + esc) ** (yr - 1))
            savings = e_kwh * yr_tariff
            om = (total_capex * om_frac) * ((1.0 + om_inf) ** (yr - 1))
            net_cf = savings - om
            df = 1.0 / ((1.0 + wacc) ** yr)
            kiyo_cfs.append(net_cf)
            kiyo_dcfs.append(net_cf * df)
            disc_costs += om * df
            disc_energy += e_kwh * df
            tot_energy += e_kwh
            yearly_rows.append(
                YearlyTechnicalResult(
                    year=yr,
                    pv_degradation_factor=(1.0 - deg) ** (yr - 1),
                    total_load_kwh=e_kwh,
                    pv_generation_kwh=e_kwh,
                    biomass_generation_kwh=0.0,
                    served_load_kwh=e_kwh,
                    unmet_load_kwh=0.0,
                    curtailment_kwh=0.0,
                    grid_import_kwh=0.0,
                    grid_export_kwh=0.0,
                    renewable_fraction=1.0,
                    max_balance_error_kw=0.0,
                )
            )

        kiyo_npv = sum(kiyo_dcfs)
        kiyo_lcoe = disc_costs / disc_energy
        kiyo_irr = float(npf.irr(kiyo_cfs))
        kiyo_spb, _ = compute_simple_payback(kiyo_cfs)
        kiyo_dpb, _ = compute_discounted_payback(kiyo_dcfs)
        kiyo_co2_tonnes = (tot_energy * 0.78) / 1000.0

        fc = FinanceConfig(
            currency_code="IDR",
            tax_model="pre_tax",
            revenue_mode="avoided_cost",
            discount_rate=wacc,
            tariff_escalation_rate=esc,
            om_escalation_rate=om_inf,
            electricity_tariff_per_kwh=tariff,
            pv_capex_per_kwp=capex_per_kwp,
            pv_om_fraction_of_capex=om_frac,
            grid_emission_factor_kg_co2e_per_kwh=0.78,
        )
        res = run_financial_analysis_from_yearly(yearly_rows, fc, pv_capacity_kwp=capacity_kwp)

        assert res.summary.npv == pytest.approx(kiyo_npv, rel=1e-9)
        assert res.summary.lcoe == pytest.approx(kiyo_lcoe, rel=1e-9)
        assert res.summary.irr == pytest.approx(kiyo_irr, rel=1e-8)
        assert res.summary.simple_payback_years == pytest.approx(kiyo_spb, rel=1e-9)
        assert res.summary.discounted_payback_years == pytest.approx(kiyo_dpb, rel=1e-9)
        assert res.emissions.avoided_emissions_tons_co2e == pytest.approx(kiyo_co2_tonnes, rel=1e-9)
        assert res.summary.viability_status == "viable"


class TestLifetimeMultiYearIntegration:
    def test_full_hourly_carries_pv_degradation_bess_replacement_biomass_overhaul_and_inverter(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_weather(tc)
        load_profile = generate_synthetic_load(base_load_kw=140.0, peak_load_kw=320.0, time_config=tc, seed=11)

        # Atur BESS agar fade tinggi (10%/tahun + siklus) sehingga EOL 80% tercapai sekitar tahun 2..3,
        # dan Biomass agar overhaul terpicu saat jam operasi melampaui 3000 jam.
        cfg = SimulationConfig(
            project_name="Uji Multi-Tahun Penuh",
            time_config=tc,
            contract_version="0.4",
            pv=PVDetailedConfig(
                capacity_kwp=400.0,
                inverter_ac_kw=350.0,
                annual_degradation_fraction=0.01,
            ),
            bess=BESSConfig(
                nominal_capacity_kwh=250.0,
                max_charge_kw=150.0,
                max_discharge_kw=150.0,
                calendar_fade_per_year=0.09,
                cycle_fade_per_efc=0.0002,
                eol_capacity_fraction=0.80,
                replacement_cost=500_000_000.0,
            ),
            biomass=build_sample_biomass_config(
                "sample_gasifier_250kw",
                fuel_preset="efb",
                overhaul_interval_operating_hours=3000.0,
                overhaul_cost=120_000_000.0,
            ),
            dispatch=DispatchConfig(strategy="load_following"),
        )
        lc = LifetimeConfig(
            project_lifetime_years=4,
            multi_year_mode="full_hourly",
            inverter_replacement_year=3,
            inverter_replacement_cost=250_000_000.0,
        )

        lt_res = run_lifetime_simulation(cfg, weather, load_profile, lc)
        assert len(lt_res.yearly) == 4
        assert lt_res.max_balance_error_kw <= 1e-9

        # Degradasi PV menurun monoton dari tahun ke tahun.
        pv_gens = [r.pv_generation_kwh for r in lt_res.yearly]
        assert pv_gens[0] > pv_gens[1] > pv_gens[2] > pv_gens[3]

        assert lt_res.total_bess_replacements >= 1
        assert lt_res.total_biomass_overhauls >= 1
        event_types = {ev.event_type for ev in lt_res.all_lifecycle_events}
        assert {"bess_replacement", "biomass_overhaul", "inverter_replacement"} <= event_types

        fc = FinanceConfig(
            discount_rate=0.10,
            electricity_tariff_per_kwh=1445.0,
            pv_capex_per_kwp=11_500_000.0,
            bess_capex_per_kwh=3_500_000.0,
            biomass_capex_per_kw=18_000_000.0,
            pv_om_fraction_of_capex=0.015,
            bess_fixed_om_per_kwh_year=50_000.0,
            bess_design_life_years=5.0,
            inverter_design_life_years=10.0,
            biomass_overhaul_life_years=5.0,
        )
        fin_res = run_financial_analysis(lt_res, fc)
        assert fin_res.summary.total_undiscounted_replacements >= 500_000_000.0 + 120_000_000.0 + 250_000_000.0
        assert fin_res.summary.total_salvage_value > 0.0
        assert fin_res.lcoe_breakdown.total == pytest.approx(fin_res.summary.lcoe, rel=1e-12)

    def test_scaled_year_1_mode_scales_pv_and_schedules_events(self):
        tc = TimeConfig(step_minutes=60, timezone="Asia/Jakarta")
        weather = _make_weather(tc)
        load_profile = generate_synthetic_load(base_load_kw=100.0, peak_load_kw=220.0, time_config=tc, seed=3)
        cfg = SimulationConfig(
            project_name="Uji Scaled Year 1",
            time_config=tc,
            contract_version="0.4",
            pv=PVWattsConfig(capacity_kwp=300.0, inverter_ac_kw=260.0),
            bess=BESSConfig(
                nominal_capacity_kwh=200.0,
                max_charge_kw=100.0,
                max_discharge_kw=100.0,
                replacement_cost=400_000_000.0,
            ),
            dispatch=DispatchConfig(strategy="self_consumption"),
        )
        lc = LifetimeConfig(
            project_lifetime_years=10,
            multi_year_mode="scaled_year_1",
            pv_annual_degradation_fraction=0.01,
            scaled_bess_replacement_interval_years=5,
            inverter_replacement_year=8,
            inverter_replacement_cost=150_000_000.0,
        )
        res = run_lifetime_simulation(cfg, weather, load_profile, lc)
        assert len(res.yearly) == 10
        assert res.yearly[1].pv_generation_kwh == pytest.approx(res.yearly[0].pv_generation_kwh * 0.99, rel=1e-12)
        assert res.total_bess_replacements == 2  # Tahun 5 dan Tahun 10.
        assert any(ev.event_type == "inverter_replacement" and ev.year == 8 for ev in res.all_lifecycle_events)

    def test_cli_runs_stage_4_lifetime_and_finance_outputs(self, tmp_path):
        cfg_data = {
            "contract_version": "0.4",
            "project": {
                "project_name": "Pabrik Hybrid Tahap 4",
                "latitude": -6.2,
                "longitude": 106.8,
                "timezone": "Asia/Jakarta",
                "currency_code": "IDR",
            },
            "simulation": {
                "step_minutes": 60,
                "leap_day_policy": "ignore_feb_29",
                "weather_file": str((FIXTURES / "golden_jakarta_weather.json").resolve()),
                "dispatch_strategy": "load_following",
                "project_lifetime_years": 5,
                "multi_year_mode": "scaled_year_1",
                "scaled_bess_replacement_interval_years": 4,
            },
            "load_profile": {
                "mode": "synthetic",
                "base_load_kw": 160.0,
                "peak_load_kw": 350.0,
                "seed": 42,
            },
            "components": {
                "pv": {
                    "model": "detailed_v1",
                    "capacity_kwp": 400.0,
                    "inverter_ac_kw": 340.0,
                },
                "bess": {
                    "enabled": True,
                    "nominal_capacity_kwh": 400.0,
                    "max_charge_kw": 200.0,
                    "max_discharge_kw": 200.0,
                    "replacement_cost": 900_000_000.0,
                },
                "biomass": {
                    "enabled": True,
                    "plant_sample": "sample_gasifier_250kw",
                    "fuel_preset": "efb",
                    "overhaul_cost": 150_000_000.0,
                },
            },
            "finance": {
                "tax_model": "pre_tax",
                "revenue_mode": "avoided_cost",
                "discount_rate": 0.10,
                "tariff_escalation_rate": 0.02,
                "om_escalation_rate": 0.02,
                "fuel_escalation_rate": 0.02,
                "electricity_tariff_per_kwh": 1445.0,
                "pv_capex_per_kwp": 11_500_000.0,
                "bess_capex_per_kwh": 3_500_000.0,
                "biomass_capex_per_kw": 18_000_000.0,
                "pv_om_fraction_of_capex": 0.015,
                "bess_fixed_om_per_kwh_year": 50_000.0,
                "inverter_replacement_year": 3,
                "inverter_replacement_cost": 300_000_000.0,
                "bess_design_life_years": 5.0,
                "inverter_design_life_years": 10.0,
                "grid_emission_factor_kg_co2e_per_kwh": 0.78,
            },
        }
        cfg_path = tmp_path / "stage4_cfg.json"
        cfg_path.write_text(json.dumps(cfg_data), encoding="utf-8")
        out_dir = tmp_path / "stage4_out"

        code = main(["run", str(cfg_path), "--output", str(out_dir)])
        assert code == 0

        summary = json.loads((out_dir / "summary.json").read_text(encoding="utf-8"))
        assert summary["contract_version"] == "0.4"
        assert "lifetime_summary" in summary
        assert "finance_summary" in summary
        assert "lcoe_breakdown" in summary
        assert "emissions_summary" in summary
        assert summary["lifetime_summary"]["project_lifetime_years"] == 5

        with (out_dir / "cashflow_schedule.csv").open("r", encoding="utf-8") as f_cf:
            cf_rows = list(csv.reader(f_cf))
        assert len(cf_rows) == 7  # Header + Tahun 0..5

        with (out_dir / "hourly_balance.csv").open("r", encoding="utf-8") as f_hr:
            hr_rows = list(csv.reader(f_hr))
        assert len(hr_rows) == 8761
