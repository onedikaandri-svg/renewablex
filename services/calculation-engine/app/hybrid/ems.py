"""Tahap 3B: Integrasi Supervisory Controller dan interpreter aturan JSON EMS v0.1."""

from __future__ import annotations

import copy
from typing import Any

from app.errors import EngineError
from app.hybrid.dispatch import (
    DispatchConfig,
    DispatchContext,
    DispatchDecision,
    DispatchStrategy,
    _plan_diesel_for_deficit,
)
from renewablex_controller.core.ems_rules import EMSRuleSet, EMSRuleValidationError
from renewablex_controller.core.plant_model import (
    BESSOperationalConfig,
    BiomassOperationalConfig,
    ControlPolicyConfig,
    GridOperationalConfig,
    PVOperationalConfig,
    PlantMetadataConfig,
    PlantOperationalConfig,
)
from renewablex_controller.integration.renewablex_adapter import RenewableXEMSAdapter

_EMS_RULE_PRESETS: dict[str, dict[str, Any]] = {
    "peak_cut_daytime": {
        "id": "peak_cut_daytime",
        "name_id": "Pemangkasan Puncak & Penyangga Siang (Peak-Cut)",
        "name_en": "Peak-Cut & Daytime Solar Buffering",
        "description_id": (
            "Menyimpan kelebihan energi surya siang hari ke baterai, membatasi daya puncak "
            "jaringan, dan menjaga cadangan baterai minimum."
        ),
        "description_en": (
            "Buffers daytime PV surplus into BESS, caps peak grid power, and protects "
            "reserve battery state of charge."
        ),
        "rule_set": {
            "ems_schema_version": "0.1",
            "name": "peak_cut_daytime",
            "description": "Aturan supervisory peak-cut dengan proteksi cadangan SOC baterai.",
            "params": {
                "reserve_soc_fraction": 0.30,
                "soc_max_fraction": 0.95,
                "grid_export_limit_kw": 2000.0,
            },
            "priority": ["pv", "bess", "biomass"],
            "fallback_mode_dispatcher": True,
            "rules": [
                {
                    "id": "r_enforce_peak_cut_limit",
                    "enabled": True,
                    "priority": 5,
                    "mode_scope": ["peak_cut", "grid_connected_normal"],
                    "when": {
                        "var": "grid_connected",
                        "op": "==",
                        "value": True,
                    },
                    "then": [
                        {
                            "action": "enforce_export_limit",
                            "limit": "$params.grid_export_limit_kw",
                        }
                    ],
                },
                {
                    "id": "r_peak_cut_charge_surplus",
                    "enabled": True,
                    "priority": 10,
                    "mode_scope": ["*"],
                    "when": {
                        "all": [
                            {"var": "pv_surplus_kw", "op": ">", "value": 0.0},
                            {
                                "var": "bess_soc_fraction",
                                "op": "<",
                                "value": "$params.soc_max_fraction",
                            },
                        ]
                    },
                    "then": [
                        {"action": "charge_bess", "limit": "pv_surplus_kw"},
                    ],
                },
                {
                    "id": "r_peak_cut_discharge_support",
                    "enabled": True,
                    "priority": 20,
                    "mode_scope": ["*"],
                    "when": {
                        "all": [
                            {"var": "net_load_kw", "op": ">", "value": 0.0},
                            {
                                "var": "bess_soc_fraction",
                                "op": ">",
                                "value": "$params.reserve_soc_fraction",
                            },
                        ]
                    },
                    "then": [
                        {"action": "discharge_bess", "limit": "net_load_kw"},
                    ],
                },
            ],
        },
    },
    "islanded_reserve_protection": {
        "id": "islanded_reserve_protection",
        "name_id": "Proteksi Cadangan Off-Grid (Islanded Reserve)",
        "name_en": "Islanded Microgrid Reserve Protection",
        "description_id": (
            "Mengutamakan kestabilan jaringan mandiri (off-grid/islanded): mengisi baterai "
            "dari surplus surya, menjaga batas bawah SOC, dan menyalakan biomass saat beban tinggi."
        ),
        "description_en": (
            "Prioritizes standalone microgrid stability: charges BESS from PV surplus, "
            "protects minimum SOC, and dispatches biomass during high net load."
        ),
        "rule_set": {
            "ems_schema_version": "0.1",
            "name": "islanded_reserve_protection",
            "description": "Aturan supervisory sistem mandiri (islanded) dengan dukungan biomass.",
            "params": {
                "soc_min_fraction": 0.20,
                "soc_max_fraction": 0.95,
            },
            "priority": ["pv", "bess", "biomass"],
            "fallback_mode_dispatcher": True,
            "rules": [
                {
                    "id": "r_islanded_charge_excess_pv",
                    "enabled": True,
                    "priority": 10,
                    "mode_scope": ["*"],
                    "when": {
                        "all": [
                            {"var": "pv_surplus_kw", "op": ">", "value": 0.0},
                            {
                                "var": "bess_soc_fraction",
                                "op": "<",
                                "value": "$params.soc_max_fraction",
                            },
                        ]
                    },
                    "then": [
                        {"action": "charge_bess", "limit": "pv_surplus_kw"},
                    ],
                },
                {
                    "id": "r_islanded_discharge_to_min_soc",
                    "enabled": True,
                    "priority": 20,
                    "mode_scope": ["*"],
                    "when": {
                        "all": [
                            {"var": "net_load_kw", "op": ">", "value": 0.0},
                            {
                                "var": "bess_soc_fraction",
                                "op": ">",
                                "value": "$params.soc_min_fraction",
                            },
                        ]
                    },
                    "then": [
                        {"action": "discharge_bess", "limit": "net_load_kw"},
                    ],
                },
                {
                    "id": "r_islanded_start_biomass_on_deficit",
                    "enabled": True,
                    "priority": 30,
                    "mode_scope": ["*"],
                    "when": {
                        "all": [
                            {"var": "net_load_kw", "op": ">", "value": 0.0},
                            {"var": "biomass_can_start", "op": "==", "value": True},
                        ]
                    },
                    "then": [
                        {"action": "start_biomass"},
                        {"action": "set_biomass_target", "target": "net_load_kw"},
                    ],
                },
            ],
        },
    },
    "tou_industrial_hybrid": {
        "id": "tou_industrial_hybrid",
        "name_id": "Optimalisasi Jam Sibuk Industri (Evening Peak Support)",
        "name_en": "Industrial Evening Peak & Night Support",
        "description_id": (
            "Menahan baterai di siang hari agar penuh dari surya, lalu menguras baterai dan "
            "menyalakan biomass pada jam beban puncak sore-malam (17:00 sampai 22:00)."
        ),
        "description_en": (
            "Charges BESS from daytime solar and prioritizes BESS discharge plus biomass "
            "support during evening peak hours (17:00 to 22:00)."
        ),
        "rule_set": {
            "ems_schema_version": "0.1",
            "name": "tou_industrial_hybrid",
            "description": "Aturan supervisory industri untuk pengisian siang dan pelepasan jam puncak.",
            "params": {
                "peak_reserve_soc": 0.25,
                "daytime_hold_soc": 0.55,
                "soc_max_fraction": 0.95,
            },
            "priority": ["pv", "bess", "biomass"],
            "fallback_mode_dispatcher": True,
            "rules": [
                {
                    "id": "r_daytime_charge_pv",
                    "enabled": True,
                    "priority": 10,
                    "mode_scope": ["*"],
                    "when": {
                        "all": [
                            {"var": "pv_surplus_kw", "op": ">", "value": 0.0},
                            {
                                "var": "bess_soc_fraction",
                                "op": "<",
                                "value": "$params.soc_max_fraction",
                            },
                        ]
                    },
                    "then": [
                        {"action": "charge_bess", "limit": "pv_surplus_kw"},
                    ],
                },
                {
                    "id": "r_evening_peak_discharge",
                    "enabled": True,
                    "priority": 15,
                    "mode_scope": ["*"],
                    "when": {
                        "all": [
                            {"var": "hour_of_day", "op": "in", "value": [17, 18, 19, 20, 21, 22]},
                            {"var": "net_load_kw", "op": ">", "value": 0.0},
                            {
                                "var": "bess_soc_fraction",
                                "op": ">",
                                "value": "$params.peak_reserve_soc",
                            },
                        ]
                    },
                    "then": [
                        {"action": "discharge_bess", "limit": "net_load_kw"},
                    ],
                },
                {
                    "id": "r_off_peak_preserve_battery",
                    "enabled": True,
                    "priority": 25,
                    "mode_scope": ["*"],
                    "when": {
                        "all": [
                            {
                                "var": "hour_of_day",
                                "op": "not_in",
                                "value": [17, 18, 19, 20, 21, 22],
                            },
                            {"var": "net_load_kw", "op": ">", "value": 0.0},
                            {
                                "var": "bess_soc_fraction",
                                "op": ">",
                                "value": "$params.daytime_hold_soc",
                            },
                        ]
                    },
                    "then": [
                        {"action": "discharge_bess", "limit": "net_load_kw"},
                    ],
                },
            ],
        },
    },
}


def get_ems_rule_presets() -> dict[str, dict[str, Any]]:
    """Mengembalikan salinan katalog preset aturan EMS v0.1 siap pakai."""
    return copy.deepcopy(_EMS_RULE_PRESETS)


def get_default_ems_rule_set_dict() -> dict[str, Any]:
    """Mengembalikan dokumen aturan JSON EMS default (peak_cut_daytime)."""
    return copy.deepcopy(_EMS_RULE_PRESETS["peak_cut_daytime"]["rule_set"])


def parse_and_validate_ems_rule_set(raw_rules: dict[str, Any] | None) -> EMSRuleSet:
    """Memvalidasi dict aturan EMS memakai validator murni renewablex_controller."""
    doc = get_default_ems_rule_set_dict() if raw_rules is None else raw_rules
    if not isinstance(doc, dict):
        raise EngineError(
            "invalid_ems_rules",
            "Dokumen aturan EMS kustom harus berupa objek JSON yang valid.",
        )
    try:
        return EMSRuleSet.from_dict(doc)
    except EMSRuleValidationError as exc:
        raise EngineError(
            "invalid_ems_rules",
            f"Aturan EMS kustom tidak valid ({exc.code} pada '{exc.path or 'root'}'): {exc.message}",
        ) from exc


def validate_custom_ems_rules(raw_rules: dict[str, Any] | None) -> dict[str, Any]:
    """Memvalidasi aturan EMS kustom dan mengembalikan ringkasan struktur aturan."""
    rule_set = parse_and_validate_ems_rule_set(raw_rules)
    return {
        "valid": True,
        "schema_version": rule_set.ems_schema_version,
        "name": rule_set.name,
        "description": rule_set.description,
        "rule_count": len(rule_set.rules),
        "enabled_rule_count": sum(1 for r in rule_set.rules if r.enabled),
        "priority_order": list(rule_set.priority),
        "fallback_mode_dispatcher": rule_set.fallback_mode_dispatcher,
        "rules_summary": [
            {
                "id": r.id,
                "enabled": r.enabled,
                "priority": r.priority,
                "mode_scope": list(r.mode_scope),
                "actions": [a.action for a in r.then],
            }
            for r in sorted(rule_set.rules, key=lambda item: (item.priority, item.declaration_index))
        ],
    }


def _build_supervisory_plant_config(
    config: DispatchConfig,
    rule_set: EMSRuleSet,
) -> PlantOperationalConfig:
    """Membangun amplop operasional longgar agar batas step ditentukan oleh komponen simulator."""
    soc_min = float(rule_set.params.get("soc_min_fraction", 0.05))
    soc_min = min(max(soc_min, 0.0), 0.50)
    reserve_soc = float(rule_set.params.get("reserve_soc_fraction", max(soc_min, 0.20)))
    reserve_soc = min(max(reserve_soc, soc_min), 0.90)
    soc_max = float(rule_set.params.get("soc_max_fraction", 0.98))
    soc_max = min(max(soc_max, reserve_soc), 1.0)

    return PlantOperationalConfig(
        plant_metadata=PlantMetadataConfig(
            plant_id="rx-hybrid-sim",
            plant_name="RenewableX Hybrid Supervisory Simulation",
        ),
        pv=PVOperationalConfig(
            nameplate_kwp=1_000_000.0,
            rated_ac_kw=1_000_000.0,
            curtailment_enabled=True,
            available=True,
        ),
        biomass=BiomassOperationalConfig(
            nameplate_kw=1_000_000.0,
            operating_max_kw=1_000_000.0,
            min_load_kw=0.0,
            ramp_up_kw_per_hour=1_000_000.0,
            ramp_down_kw_per_hour=1_000_000.0,
            startup_time_seconds=0.0,
            shutdown_time_seconds=0.0,
            min_up_time_seconds=0.0,
            min_down_time_seconds=0.0,
            available=True,
        ),
        bess=BESSOperationalConfig(
            nominal_capacity_kwh=10_000_000.0,
            effective_capacity_kwh=10_000_000.0,
            max_charge_kw=1_000_000.0,
            max_discharge_kw=1_000_000.0,
            soc_min_fraction=soc_min,
            reserve_soc_fraction=reserve_soc,
            soc_max_fraction=soc_max,
            charge_efficiency=1.0,
            discharge_efficiency=1.0,
            allow_reserve_drawdown_in_islanded=True,
            available=True,
        ),
        grid=GridOperationalConfig(
            interconnection_limit_kw=1_000_000.0,
            default_allow_import=config.allow_grid_import,
            default_allow_export=config.allow_grid_export,
            default_export_limit_kw=config.peak_limit_kw,
        ),
        control_policy=ControlPolicyConfig(
            default_dt_seconds=3600.0,
            power_balance_tolerance_kw=1e-6,
            hardware_commands_enabled=False,
        ),
    )


class CustomEMSStrategy(DispatchStrategy):
    """Strategi dispatch Tahap 3B yang mengeksekusi aturan JSON EMS v0.1 lewat RenewableXEMSAdapter."""

    def __init__(self, config: DispatchConfig) -> None:
        self.config = config
        self.rule_set = parse_and_validate_ems_rule_set(config.ems_rules)
        plant_cfg = _build_supervisory_plant_config(config, self.rule_set)
        self._adapter = RenewableXEMSAdapter(
            plant_cfg,
            rule_set=self.rule_set,
            use_fsm=False,
        )

    def decide(self, ctx: DispatchContext) -> DispatchDecision:
        export_limit = self.config.peak_limit_kw
        rx_dec, _ = self._adapter.step_from_context(
            ctx,
            dt_seconds=3600.0,
            grid_export_limit_kw=export_limit,
        )

        # Jika masih ada unmet_load_kw dari controller (yang mengelola PV+BESS+Biomass)
        # dan proyek mengaktifkan Diesel Generator, alokasikan Diesel sebagai pemikul sisa defisit
        # sebelum jatuh ke Grid Import atau Unmet Load.
        diesel_cmd = 0.0
        reason = rx_dec.trace_reason
        if rx_dec.unmet_load_kw > 1e-9:
            diesel_cmd = _plan_diesel_for_deficit(ctx, rx_dec.unmet_load_kw)
            if diesel_cmd > 0.0:
                reason = f"{reason}; diesel={diesel_cmd:.1f} kW menutup sisa defisit"
        else:
            diesel_cmd = _plan_diesel_for_deficit(ctx, 0.0)

        return DispatchDecision(
            bess_command_kw=rx_dec.bess_command_kw,
            grid_import_kw=rx_dec.grid_import_kw,
            grid_export_kw=rx_dec.grid_export_kw,
            curtailment_kw=rx_dec.curtailment_kw,
            trace_reason=reason,
            biomass_command_kw=rx_dec.biomass_command_kw,
            biomass_start_request=rx_dec.biomass_start_request,
            biomass_stop_request=rx_dec.biomass_stop_request,
            diesel_command_kw=diesel_cmd,
        )
