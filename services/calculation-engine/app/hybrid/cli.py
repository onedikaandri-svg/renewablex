"""Antarmuka baris perintah (CLI) untuk menjalankan simulasi hybrid tanpa web."""

import argparse
import csv
import json
from pathlib import Path
import sys
from typing import Any

from app.errors import EngineError
from app.hybrid.bess import BESSConfig
from app.hybrid.biomass import BiomassConfig, resolve_biomass_config
from app.hybrid.components import PVWattsConfig
from app.hybrid.diesel import DieselConfig, resolve_diesel_config
from app.hybrid.dispatch import DispatchConfig
from app.hybrid.finance import (
    FinanceResult,
    resolve_finance_config,
    resolve_lifetime_config,
    run_financial_analysis,
)
from app.hybrid.lifetime import LifetimeSimulationResult, run_lifetime_simulation
from app.hybrid.load import generate_synthetic_load, load_profile_from_csv
from app.hybrid.pv_detailed import PVDetailedConfig
from app.hybrid.simulator import SimulationConfig, SimulationResult, run_simulation
from app.hybrid.time_grid import TimeConfig
from app.hybrid.weather import PVGISTMYWeatherProvider, load_weather_from_json
from app.providers.base import ResourceError


def _resolve_path(raw_path: str, base_dir: Path) -> Path:
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate
    return (base_dir / candidate).resolve()


def _load_weather_from_config(cfg: dict[str, Any], base_dir: Path, time_config: TimeConfig):
    sim_raw = cfg.get("simulation") or {}
    project_raw = cfg.get("project") or {}

    if "weather_file" in sim_raw and sim_raw["weather_file"]:
        weather_path = _resolve_path(str(sim_raw["weather_file"]), base_dir)
        return load_weather_from_json(weather_path, time_config)

    source = sim_raw.get("weather_source", "pvgis_tmy")
    if source == "pvgis_tmy":
        lat = float(project_raw["latitude"])
        lon = float(project_raw["longitude"])
        provider = PVGISTMYWeatherProvider()
        return provider.get_weather(lat, lon, time_config)

    raise EngineError("unsupported_weather_source", f"Sumber cuaca tidak dikenal: {source}.")


def _load_profile_from_config(cfg: dict[str, Any], base_dir: Path, time_config: TimeConfig):
    lp = cfg.get("load_profile") or {}
    mode = lp.get("mode", "synthetic")
    if mode == "csv":
        if not lp.get("csv_path"):
            raise EngineError("load_csv_required", "Field load_profile.csv_path wajib diisi untuk mode csv.")
        csv_path = _resolve_path(str(lp["csv_path"]), base_dir)
        return load_profile_from_csv(csv_path, time_config)

    if mode == "synthetic":
        return generate_synthetic_load(
            base_load_kw=float(lp["base_load_kw"]),
            peak_load_kw=float(lp["peak_load_kw"]),
            time_config=time_config,
            seed=int(lp.get("seed", 42)),
            daily_profile=lp.get("daily_profile"),
            monthly_factors=lp.get("monthly_factors"),
            noise_fraction=float(lp.get("noise_fraction", 0.05)),
        )

    raise EngineError("unsupported_load_mode", f"Mode profil beban tidak dikenal: {mode}.")


def _parse_pv_config(pv_raw: dict[str, Any]) -> PVWattsConfig | PVDetailedConfig:
    model = str(pv_raw.get("model", "pvwatts_v1"))
    cap_kwp = float(pv_raw["capacity_kwp"])
    inv_ac_kw = float(pv_raw.get("inverter_ac_kw", cap_kwp))

    if model == "pvwatts_v1":
        return PVWattsConfig(
            capacity_kwp=cap_kwp,
            inverter_ac_kw=inv_ac_kw,
            tilt_degrees=float(pv_raw.get("tilt_degrees", 10.0)),
            azimuth_degrees=float(pv_raw.get("azimuth_degrees", 0.0)),
            system_loss_fraction=float(pv_raw.get("system_loss_fraction", 0.14)),
            temp_coeff_per_c=float(pv_raw.get("temp_coeff_per_c", -0.004)),
            noct_c=float(pv_raw.get("noct_c", 45.0)),
            inverter_efficiency=float(pv_raw.get("inverter_efficiency", 0.96)),
            albedo=float(pv_raw.get("albedo", 0.2)),
        )

    if model == "detailed_v1":
        soiling = tuple(float(v) for v in pv_raw["soiling_monthly"]) if "soiling_monthly" in pv_raw else (0.02,) * 12
        snow = tuple(float(v) for v in pv_raw["snow_loss_monthly"]) if "snow_loss_monthly" in pv_raw else (0.0,) * 12
        curve_raw = pv_raw.get("efficiency_curve_points")
        curve_pts = tuple((float(pt[0]), float(pt[1])) for pt in curve_raw) if curve_raw is not None else None
        return PVDetailedConfig(
            capacity_kwp=cap_kwp,
            inverter_ac_kw=inv_ac_kw,
            decompose_ghi_if_missing=bool(pv_raw.get("decompose_ghi_if_missing", True)),
            transposition_model=pv_raw.get("transposition_model", "perez"),
            albedo=float(pv_raw.get("albedo", 0.2)),
            tracking_mode=pv_raw.get("tracking_mode", "fixed"),
            tilt_degrees=float(pv_raw.get("tilt_degrees", 10.0)),
            azimuth_degrees=float(pv_raw.get("azimuth_degrees", 0.0)),
            max_angle_deg=float(pv_raw.get("max_angle_deg", 60.0)),
            backtracking=bool(pv_raw.get("backtracking", True)),
            gcr=float(pv_raw.get("gcr", 0.35)),
            iam_b0=float(pv_raw.get("iam_b0", 0.05)),
            soiling_monthly=soiling,
            snow_loss_monthly=snow,
            cell_temp_model=pv_raw.get("cell_temp_model", "faiman"),
            noct_c=float(pv_raw.get("noct_c", 45.0)),
            faiman_u0=float(pv_raw.get("faiman_u0", 25.0)),
            faiman_u1=float(pv_raw.get("faiman_u1", 6.84)),
            dc_model=pv_raw.get("dc_model", "pvwatts"),
            temp_coeff_per_c=float(pv_raw.get("temp_coeff_per_c", -0.004)),
            i_sc=float(pv_raw.get("i_sc", 13.8)),
            v_oc=float(pv_raw.get("v_oc", 49.5)),
            i_mp=float(pv_raw.get("i_mp", 13.0)),
            v_mp=float(pv_raw.get("v_mp", 41.5)),
            alpha_sc=float(pv_raw.get("alpha_sc", 0.0069)),
            beta_voc=float(pv_raw.get("beta_voc", -0.1386)),
            cells_in_series=int(pv_raw.get("cells_in_series", 72)),
            n_modules_series=None if pv_raw.get("n_modules_series") is None else int(pv_raw["n_modules_series"]),
            n_strings_parallel=None if pv_raw.get("n_strings_parallel") is None else int(pv_raw["n_strings_parallel"]),
            mismatch_fraction=float(pv_raw.get("mismatch_fraction", 0.02)),
            dc_wiring_fraction=float(pv_raw.get("dc_wiring_fraction", 0.02)),
            shading_fraction=float(pv_raw.get("shading_fraction", 0.0)),
            availability_fraction=float(pv_raw.get("availability_fraction", 0.01)),
            lid_fraction=float(pv_raw.get("lid_fraction", 0.015)),
            annual_degradation_fraction=float(pv_raw.get("annual_degradation_fraction", 0.005)),
            simulation_year=int(pv_raw.get("simulation_year", 1)),
            inverter_model=pv_raw.get("inverter_model", "constant"),
            inverter_efficiency=float(pv_raw.get("inverter_efficiency", 0.96)),
            efficiency_curve_points=curve_pts,
            night_tare_kw=float(pv_raw.get("night_tare_kw", 0.0)),
        )

    raise EngineError("invalid_pv_config", f"Model PV tidak dikenal: {model}.")


def _parse_bess_config(bess_raw: dict[str, Any] | None) -> BESSConfig | None:
    if not bess_raw or bess_raw.get("enabled") is False:
        return None
    return BESSConfig(
        nominal_capacity_kwh=float(bess_raw["nominal_capacity_kwh"]),
        max_charge_kw=None if bess_raw.get("max_charge_kw") is None else float(bess_raw["max_charge_kw"]),
        max_discharge_kw=None if bess_raw.get("max_discharge_kw") is None else float(bess_raw["max_discharge_kw"]),
        c_rate_charge=None if bess_raw.get("c_rate_charge") is None else float(bess_raw["c_rate_charge"]),
        c_rate_discharge=None if bess_raw.get("c_rate_discharge") is None else float(bess_raw["c_rate_discharge"]),
        soc_min_fraction=float(bess_raw.get("soc_min_fraction", 0.20)),
        soc_max_fraction=float(bess_raw.get("soc_max_fraction", 0.95)),
        initial_soc_fraction=float(bess_raw.get("initial_soc_fraction", 0.50)),
        charge_efficiency=float(bess_raw.get("charge_efficiency", 0.94)),
        discharge_efficiency=float(bess_raw.get("discharge_efficiency", 0.94)),
        pcs_loss_fraction=float(bess_raw.get("pcs_loss_fraction", 0.02)),
        aux_load_kw=float(bess_raw.get("aux_load_kw", 0.0)),
        calendar_fade_per_year=float(bess_raw.get("calendar_fade_per_year", 0.015)),
        cycle_fade_per_efc=float(bess_raw.get("cycle_fade_per_efc", 0.00005)),
        eol_capacity_fraction=float(bess_raw.get("eol_capacity_fraction", 0.80)),
        replacement_cost=float(bess_raw.get("replacement_cost", 0.0)),
    )


def _parse_biomass_config(biomass_raw: dict[str, Any] | None) -> BiomassConfig | None:
    if not biomass_raw or biomass_raw.get("enabled") is False:
        return None
    return resolve_biomass_config(biomass_raw)


def _parse_diesel_config(diesel_raw: dict[str, Any] | None) -> DieselConfig | None:
    if not diesel_raw or diesel_raw.get("enabled") is False:
        return None
    if diesel_raw.get("rated_capacity_kw") is None:
        raise EngineError("invalid_diesel_config", "rated_capacity_kw diesel wajib diisi saat Diesel diaktifkan.")
    return resolve_diesel_config(diesel_raw)


def _parse_dispatch_config(sim_raw: dict[str, Any]) -> DispatchConfig | None:
    if "dispatch_strategy" not in sim_raw and "dispatch_params" not in sim_raw:
        return None
    params = sim_raw.get("dispatch_params") or {}
    peak_hours_raw = params.get("peak_hours", (17, 18, 19, 20, 21))
    off_peak_raw = params.get("off_peak_hours", (0, 1, 2, 3, 4, 5))
    return DispatchConfig(
        strategy=sim_raw.get("dispatch_strategy", "self_consumption"),
        allow_grid_import=bool(params.get("allow_grid_import", False)),
        allow_grid_export=bool(params.get("allow_grid_export", False)),
        target_soc_fraction=float(params.get("target_soc_fraction", 0.80)),
        peak_limit_kw=None if params.get("peak_limit_kw") is None else float(params["peak_limit_kw"]),
        peak_hours=tuple(int(h) for h in peak_hours_raw),
        off_peak_hours=tuple(int(h) for h in off_peak_raw),
        tou_charge_soc_target=float(params.get("tou_charge_soc_target", 0.90)),
        tou_discharge_soc_floor=float(params.get("tou_discharge_soc_floor", 0.25)),
        ems_rules=params.get("ems_rules"),
    )


def run_from_config_file(config_path: Path, output_dir: Path) -> SimulationResult:
    """Membaca berkas JSON konfigurasi, menjalankan simulasi, dan menulis hasil ke folder keluaran."""
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    base_dir = config_path.resolve().parent

    project_raw = cfg.get("project") or {}
    sim_raw = cfg.get("simulation") or {}
    components_raw = cfg.get("components") or {}
    pv_raw = components_raw.get("pv") or {}

    time_config = TimeConfig(
        step_minutes=int(sim_raw.get("step_minutes", 60)),
        timezone=str(project_raw.get("timezone", "Asia/Jakarta")),
        leap_day_policy=str(sim_raw.get("leap_day_policy", "ignore_feb_29")),  # type: ignore[arg-type]
    )

    pv_config = _parse_pv_config(pv_raw)
    bess_config = _parse_bess_config(components_raw.get("bess"))
    biomass_config = _parse_biomass_config(components_raw.get("biomass"))
    diesel_config = _parse_diesel_config(components_raw.get("diesel"))
    dispatch_config = _parse_dispatch_config(sim_raw)

    sim_config = SimulationConfig(
        project_name=str(project_raw.get("project_name", "Proyek Hybrid")),
        time_config=time_config,
        pv=pv_config,
        contract_version=str(cfg.get("contract_version", "0.1")),
        bess=bess_config,
        dispatch=dispatch_config,
        biomass=biomass_config,
        diesel=diesel_config,
    )

    weather = _load_weather_from_config(cfg, base_dir, time_config)
    load_profile = _load_profile_from_config(cfg, base_dir, time_config)

    finance_raw = cfg.get("finance")
    has_lifetime = "project_lifetime_years" in sim_raw or "multi_year_mode" in sim_raw or finance_raw is not None

    lifetime_result: LifetimeSimulationResult | None = None
    finance_result: FinanceResult | None = None
    if has_lifetime:
        lifetime_cfg = resolve_lifetime_config(sim_raw, finance_raw if isinstance(finance_raw, dict) else None)
        lifetime_result = run_lifetime_simulation(sim_config, weather, load_profile, lifetime_cfg)
        result = lifetime_result.year_1_result
        if finance_raw is not None:
            currency = str(project_raw.get("currency_code", "IDR"))
            finance_cfg = resolve_finance_config(finance_raw, currency_code=currency)
            finance_result = run_financial_analysis(lifetime_result, finance_cfg)
    else:
        result = run_simulation(sim_config, weather, load_profile)

    output_dir.mkdir(parents=True, exist_ok=True)
    summary_payload = result.to_summary_dict()
    if lifetime_result is not None:
        summary_payload["lifetime_summary"] = lifetime_result.to_summary_dict()
    if finance_result is not None:
        summary_payload.update(finance_result.to_summary_dict())

    summary_path = output_dir / "summary.json"
    summary_path.write_text(json.dumps(summary_payload, indent=2), encoding="utf-8")

    if finance_result is not None:
        cf_path = output_dir / "cashflow_schedule.csv"
        with cf_path.open("w", encoding="utf-8", newline="") as f_cf:
            cf_writer = csv.writer(f_cf)
            cf_writer.writerow([
                "year",
                "served_load_kwh",
                "pv_generation_kwh",
                "biomass_generation_kwh",
                "grid_import_kwh",
                "capex_outflow",
                "gross_revenue_or_savings",
                "export_revenue",
                "om_cost",
                "fuel_and_logistics_cost",
                "grid_import_cost",
                "unmet_load_penalty",
                "replacement_and_overhaul_cost",
                "salvage_inflow",
                "tax_outflow",
                "net_cash_flow",
                "discounted_cash_flow",
                "cumulative_cash_flow",
                "cumulative_discounted_cash_flow",
            ])
            for cf_row in finance_result.schedule:
                cf_writer.writerow([
                    cf_row.year,
                    round(cf_row.served_load_kwh, 6),
                    round(cf_row.pv_generation_kwh, 6),
                    round(cf_row.biomass_generation_kwh, 6),
                    round(cf_row.grid_import_kwh, 6),
                    round(cf_row.capex_outflow, 6),
                    round(cf_row.gross_revenue_or_savings, 6),
                    round(cf_row.export_revenue, 6),
                    round(cf_row.om_cost, 6),
                    round(cf_row.fuel_and_logistics_cost, 6),
                    round(cf_row.grid_import_cost, 6),
                    round(cf_row.unmet_load_penalty, 6),
                    round(cf_row.replacement_and_overhaul_cost, 6),
                    round(cf_row.salvage_inflow, 6),
                    round(cf_row.tax_outflow, 6),
                    round(cf_row.net_cash_flow, 6),
                    round(cf_row.discounted_cash_flow, 6),
                    round(cf_row.cumulative_cash_flow, 6),
                    round(cf_row.cumulative_discounted_cash_flow, 6),
                ])

    csv_path = output_dir / "hourly_balance.csv"
    labels = time_config.timestamp_labels()
    b = result.balance
    pv_gen_series = b.effective_pv_generation_kw
    include_stage2_cols = result.bess_soc is not None or result.dispatch_strategy is not None
    include_biomass_cols = result.biomass_summary is not None
    include_diesel_cols = result.diesel_summary is not None

    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        header = [
            "step",
            "local_time",
            "load_kw",
            "pv_available_kw",
            "pv_generation_kw",
            "served_load_kw",
            "unmet_load_kw",
            "curtailment_kw",
            "losses_kw",
        ]
        if include_stage2_cols:
            header.extend(["charge_kw", "discharge_kw", "grid_import_kw", "grid_export_kw", "bess_soc", "trace_reason"])
        if include_biomass_cols:
            header.extend(["biomass_generation_kw", "biomass_status", "biomass_fuel_tons"])
        if include_diesel_cols:
            header.extend(["diesel_generation_kw", "diesel_status", "diesel_fuel_liters"])
        writer.writerow(header)

        for i in range(time_config.steps_per_year):
            row: list[Any] = [
                i,
                labels[i],
                round(float(b.load_kw[i]), 6),
                round(float(b.pv_available_kw[i]), 6),
                round(float(pv_gen_series[i]), 6),
                round(float(b.served_load_kw[i]), 6),
                round(float(b.unmet_load_kw[i]), 6),
                round(float(b.curtailment_kw[i]), 6),
                round(float(b.losses_kw[i]), 6),
            ]
            if include_stage2_cols:
                soc_val = round(float(result.bess_soc[i]), 6) if result.bess_soc is not None else ""
                reason = result.trace_reasons[i] if i < len(result.trace_reasons) else ""
                row.extend([
                    round(float(b.charge_kw[i]), 6),
                    round(float(b.discharge_kw[i]), 6),
                    round(float(b.grid_import_kw[i]), 6),
                    round(float(b.grid_export_kw[i]), 6),
                    soc_val,
                    reason,
                ])
            if include_biomass_cols:
                bio_gen_val = round(float(result.biomass_generation_kw[i]), 6) if result.biomass_generation_kw is not None else 0.0
                bio_stat_val = result.biomass_status[i] if i < len(result.biomass_status) else "off"
                bio_fuel_val = round(float(result.biomass_fuel_tons[i]), 6) if result.biomass_fuel_tons is not None else 0.0
                row.extend([bio_gen_val, bio_stat_val, bio_fuel_val])
            if include_diesel_cols:
                dsl_gen_val = round(float(result.diesel_generation_kw[i]), 6) if result.diesel_generation_kw is not None else 0.0
                dsl_stat_val = result.diesel_status[i] if i < len(result.diesel_status) else "off"
                dsl_fuel_val = round(float(result.diesel_fuel_liters[i]), 6) if result.diesel_fuel_liters is not None else 0.0
                row.extend([dsl_gen_val, dsl_stat_val, dsl_fuel_val])
            writer.writerow(row)

    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="RenewableX Hybrid Calculation Engine CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    run_cmd = sub.add_parser("run", help="Jalankan simulasi hybrid dari berkas konfigurasi JSON")
    run_cmd.add_argument("config", type=Path, help="Path ke berkas konfigurasi JSON")
    run_cmd.add_argument("--output", "-o", type=Path, required=True, help="Folder keluaran hasil")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "run":
        try:
            result = run_from_config_file(args.config, args.output)
        except (EngineError, ResourceError, KeyError, OSError, ValueError) as exc:
            code = getattr(exc, "code", None) or getattr(getattr(exc, "kind", None), "value", "cli_error")
            print(f"[{code}] {exc}", file=sys.stderr)
            return 1

        s = result.summary
        print(
            f"Simulasi selesai: PV={s.pv_generation_kwh:.2f} kWh, "
            f"Beban={s.total_load_kwh:.2f} kWh, "
            f"Terpenuhi={s.served_load_kwh:.2f} kWh, "
            f"Selisih neraca maks={s.max_balance_error_kw:.2e} kW"
        )
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
