"""Antarmuka baris perintah (CLI) untuk menjalankan simulasi hybrid tanpa web."""

import argparse
import csv
import json
from pathlib import Path
import sys
from typing import Any

from app.errors import EngineError
from app.hybrid.components import PVWattsConfig
from app.hybrid.load import generate_synthetic_load, load_profile_from_csv
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


def run_from_config_file(config_path: Path, output_dir: Path) -> SimulationResult:
    """Membaca berkas JSON konfigurasi, menjalankan simulasi, dan menulis hasil ke folder keluaran."""
    cfg = json.loads(config_path.read_text(encoding="utf-8"))
    base_dir = config_path.resolve().parent

    project_raw = cfg.get("project") or {}
    sim_raw = cfg.get("simulation") or {}
    pv_raw = (cfg.get("components") or {}).get("pv") or {}

    time_config = TimeConfig(
        step_minutes=int(sim_raw.get("step_minutes", 60)),
        timezone=str(project_raw.get("timezone", "Asia/Jakarta")),
        leap_day_policy=str(sim_raw.get("leap_day_policy", "ignore_feb_29")),  # type: ignore[arg-type]
    )

    pv_config = PVWattsConfig(
        capacity_kwp=float(pv_raw["capacity_kwp"]),
        inverter_ac_kw=float(pv_raw.get("inverter_ac_kw", pv_raw["capacity_kwp"])),
        tilt_degrees=float(pv_raw.get("tilt_degrees", 10.0)),
        azimuth_degrees=float(pv_raw.get("azimuth_degrees", 0.0)),
        system_loss_fraction=float(pv_raw.get("system_loss_fraction", 0.14)),
        temp_coeff_per_c=float(pv_raw.get("temp_coeff_per_c", -0.004)),
        noct_c=float(pv_raw.get("noct_c", 45.0)),
        inverter_efficiency=float(pv_raw.get("inverter_efficiency", 0.96)),
        albedo=float(pv_raw.get("albedo", 0.2)),
    )

    sim_config = SimulationConfig(
        project_name=str(project_raw.get("project_name", "Proyek Hybrid")),
        time_config=time_config,
        pv=pv_config,
        contract_version=str(cfg.get("contract_version", "0.1")),
    )

    weather = _load_weather_from_config(cfg, base_dir, time_config)
    load_profile = _load_profile_from_config(cfg, base_dir, time_config)

    result = run_simulation(sim_config, weather, load_profile)

    output_dir.mkdir(parents=True, exist_ok=True)
    summary_path = output_dir / "summary.json"
    summary_path.write_text(json.dumps(result.to_summary_dict(), indent=2), encoding="utf-8")

    csv_path = output_dir / "hourly_balance.csv"
    labels = time_config.timestamp_labels()
    b = result.balance
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([
            "step",
            "local_time",
            "load_kw",
            "pv_available_kw",
            "pv_generation_kw",
            "served_load_kw",
            "unmet_load_kw",
            "curtailment_kw",
            "losses_kw",
        ])
        for i in range(time_config.steps_per_year):
            writer.writerow([
                i,
                labels[i],
                round(float(b.load_kw[i]), 6),
                round(float(b.pv_available_kw[i]), 6),
                round(float(b.generation_kw[i]), 6),
                round(float(b.served_load_kw[i]), 6),
                round(float(b.unmet_load_kw[i]), 6),
                round(float(b.curtailment_kw[i]), 6),
                round(float(b.losses_kw[i]), 6),
            ])

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
