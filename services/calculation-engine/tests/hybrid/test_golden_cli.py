"""Tes kasus acuan (golden) dan antarmuka baris perintah (CLI) Tahap 1."""

import csv
import json
from pathlib import Path
import subprocess
import sys

import pytest

from app.hybrid.cli import main

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class TestGoldenCLI:
    def test_cli_runs_golden_jakarta_case_and_matches_expected(self, tmp_path):
        config_path = FIXTURES / "golden_jakarta_config.json"
        expected = json.loads((FIXTURES / "golden_jakarta_expected.json").read_text(encoding="utf-8"))
        out_dir = tmp_path / "golden_out"

        exit_code = main(["run", str(config_path), "--output", str(out_dir)])
        assert exit_code == 0

        summary_file = out_dir / "summary.json"
        csv_file = out_dir / "hourly_balance.csv"
        assert summary_file.exists()
        assert csv_file.exists()

        actual = json.loads(summary_file.read_text(encoding="utf-8"))
        assert actual["contract_version"] == expected["contract_version"]
        assert actual["config_hash"] == expected["config_hash"]
        assert actual["weather_source"]["timezone"] == "Asia/Jakarta"

        for key, exp_val in expected["summary"].items():
            assert actual["summary"][key] == pytest.approx(exp_val, rel=1e-9, abs=1e-9)

        for key, exp_val in expected["pv_loss_breakdown_kwh"].items():
            assert actual["pv_loss_breakdown_kwh"][key] == pytest.approx(exp_val, rel=1e-9, abs=1e-9)

        assert actual["monthly"] == pytest.approx(expected["monthly"], rel=1e-9)

        with csv_file.open("r", encoding="utf-8") as f:
            rows = list(csv.reader(f))
        assert len(rows) == 8761  # 1 header + 8760 baris per jam

    def test_cli_module_invocation_via_python_m(self, tmp_path):
        engine_root = Path(__file__).resolve().parents[2]
        config_path = FIXTURES / "golden_jakarta_config.json"
        out_dir = tmp_path / "subprocess_out"

        proc = subprocess.run(
            [sys.executable, "-m", "app.hybrid.cli", "run", str(config_path), "--output", str(out_dir)],
            cwd=engine_root,
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc.returncode == 0, proc.stderr
        assert "Simulasi selesai:" in proc.stdout
        assert (out_dir / "summary.json").exists()

    def test_cli_returns_nonzero_on_invalid_load_csv(self, tmp_path):
        bad_csv = tmp_path / "bad_load.csv"
        bad_csv.write_text("load_kw\n10.0\n20.0\n", encoding="utf-8")

        cfg = json.loads((FIXTURES / "golden_jakarta_config.json").read_text(encoding="utf-8"))
        cfg["simulation"]["weather_file"] = str((FIXTURES / "golden_jakarta_weather.json").resolve())
        cfg["load_profile"] = {"mode": "csv", "csv_path": str(bad_csv)}

        cfg_file = tmp_path / "bad_cfg.json"
        cfg_file.write_text(json.dumps(cfg), encoding="utf-8")

        exit_code = main(["run", str(cfg_file), "--output", str(tmp_path / "out")])
        assert exit_code == 1
