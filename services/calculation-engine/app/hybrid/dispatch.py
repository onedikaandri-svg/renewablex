"""Antarmuka DispatchStrategy dan 5 strategi dispatch bawaan untuk simulasi hybrid."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
import math
from typing import Literal

from app.errors import EngineError

StrategyName = Literal[
    "self_consumption",
    "load_following",
    "cycle_charging",
    "peak_shaving",
    "time_of_use_arbitrage",
]


@dataclass(frozen=True)
class DispatchContext:
    """Masukan kondisi sistem pada satu langkah waktu untuk pengambil keputusan dispatch."""

    step_idx: int
    hour_of_day: int
    month: int
    load_kw: float
    pv_available_kw: float
    bess_soc: float
    bess_max_charge_kw: float
    bess_max_discharge_kw: float
    allow_grid_import: bool = False
    allow_grid_export: bool = False
    tariff_per_kwh: float = 0.0
    parasitic_load_kw: float = 0.0


@dataclass(frozen=True)
class DispatchDecision:
    """Keputusan aliran daya per langkah waktu hasil strategi dispatch."""

    bess_command_kw: float  # Positif = charge, negatif = discharge, 0 = diam.
    grid_import_kw: float
    grid_export_kw: float
    curtailment_kw: float
    trace_reason: str


@dataclass(frozen=True)
class DispatchConfig:
    """Konfigurasi strategi dispatch bawaan Tahap 2."""

    strategy: StrategyName = "self_consumption"
    allow_grid_import: bool = False
    allow_grid_export: bool = False
    target_soc_fraction: float = 0.80  # Untuk cycle_charging.
    peak_limit_kw: float | None = None  # Untuk peak_shaving.
    peak_hours: tuple[int, ...] = (17, 18, 19, 20, 21)
    off_peak_hours: tuple[int, ...] = (0, 1, 2, 3, 4, 5)
    tou_charge_soc_target: float = 0.90
    tou_discharge_soc_floor: float = 0.25


def _validate_hours(hours: tuple[int, ...], name: str) -> None:
    for h in hours:
        if isinstance(h, bool) or not isinstance(h, int) or not (0 <= h <= 23):
            raise EngineError("invalid_dispatch_config", f"Jam pada {name} harus bilangan bulat 0..23.")


class DispatchStrategy(ABC):
    """Kontrak dasar strategi dispatch agar mudah diganti interpreter aturan EMS."""

    @abstractmethod
    def decide(self, ctx: DispatchContext) -> DispatchDecision:
        """Menghasilkan keputusan dispatch pada satu langkah waktu."""


def _balance_after_bess(
    ctx: DispatchContext,
    bess_cmd_kw: float,
    reason: str,
) -> DispatchDecision:
    """Menurunkan impor, ekspor, dan curtailment AC bus yang konsisten dengan perintah BESS."""
    total_demand = ctx.load_kw + ctx.parasitic_load_kw
    net_ac = ctx.pv_available_kw - total_demand

    if bess_cmd_kw > 0.0:
        # Pengisian baterai membutuhkan pasokan AC dari surplus PV atau grid (jika diizinkan).
        max_supply_for_chg = max(ctx.pv_available_kw - total_demand, 0.0)
        if ctx.allow_grid_import:
            chg = min(bess_cmd_kw, ctx.bess_max_charge_kw)
        else:
            chg = min(bess_cmd_kw, ctx.bess_max_charge_kw, max_supply_for_chg)
        residual = net_ac - chg
        grid_import = max(-residual, 0.0) if ctx.allow_grid_import else 0.0
        surplus_after = max(residual, 0.0)
        grid_export = surplus_after if ctx.allow_grid_export else 0.0
        curtailment = 0.0 if ctx.allow_grid_export else surplus_after
        return DispatchDecision(
            bess_command_kw=chg,
            grid_import_kw=grid_import,
            grid_export_kw=grid_export,
            curtailment_kw=curtailment,
            trace_reason=reason,
        )

    if bess_cmd_kw < 0.0:
        dis = min(-bess_cmd_kw, ctx.bess_max_discharge_kw)
        residual = net_ac + dis
        grid_import = max(-residual, 0.0) if ctx.allow_grid_import else 0.0
        surplus_after = max(residual, 0.0)
        grid_export = surplus_after if ctx.allow_grid_export else 0.0
        curtailment = 0.0 if ctx.allow_grid_export else surplus_after
        return DispatchDecision(
            bess_command_kw=-dis,
            grid_import_kw=grid_import,
            grid_export_kw=grid_export,
            curtailment_kw=curtailment,
            trace_reason=reason,
        )

    grid_import = max(-net_ac, 0.0) if ctx.allow_grid_import else 0.0
    surplus_after = max(net_ac, 0.0)
    grid_export = surplus_after if ctx.allow_grid_export else 0.0
    curtailment = 0.0 if ctx.allow_grid_export else surplus_after
    return DispatchDecision(
        bess_command_kw=0.0,
        grid_import_kw=grid_import,
        grid_export_kw=grid_export,
        curtailment_kw=curtailment,
        trace_reason=reason,
    )


class SelfConsumptionStrategy(DispatchStrategy):
    """Memprioritaskan surplus PV untuk mengisi BESS dan discharge untuk menutup defisit beban."""

    def decide(self, ctx: DispatchContext) -> DispatchDecision:
        total_demand = ctx.load_kw + ctx.parasitic_load_kw
        surplus = ctx.pv_available_kw - total_demand
        if surplus > 1e-12:
            chg = min(surplus, ctx.bess_max_charge_kw)
            reason = "self_consumption: surplus PV mengisi BESS" if chg > 0 else "self_consumption: BESS penuh, surplus dialihkan"
            return _balance_after_bess(ctx, chg, reason)
        if surplus < -1e-12:
            deficit = -surplus
            dis = min(deficit, ctx.bess_max_discharge_kw)
            reason = "self_consumption: BESS discharge menutup defisit beban" if dis > 0 else "self_consumption: BESS pada SOC minimum"
            return _balance_after_bess(ctx, -dis, reason)
        return _balance_after_bess(ctx, 0.0, "self_consumption: pasokan PV seimbang dengan beban")


class LoadFollowingStrategy(DispatchStrategy):
    """Menjaga pertukaran daya netto titik sambung nol dengan menyerap surplus dan menambal defisit."""

    def decide(self, ctx: DispatchContext) -> DispatchDecision:
        total_demand = ctx.load_kw + ctx.parasitic_load_kw
        net = ctx.pv_available_kw - total_demand
        if net > 1e-12:
            chg = min(net, ctx.bess_max_charge_kw)
            return _balance_after_bess(ctx, chg, "load_following: serap surplus PV ke BESS")
        if net < -1e-12:
            dis = min(-net, ctx.bess_max_discharge_kw)
            return _balance_after_bess(ctx, -dis, "load_following: discharge BESS mengikuti defisit beban")
        return _balance_after_bess(ctx, 0.0, "load_following: beban seimbang, BESS diam")


class CycleChargingStrategy(DispatchStrategy):
    """Mengisi BESS menuju target SOC saat surplus atau ketika sumber pengisi grid aktif."""

    def __init__(self, target_soc_fraction: float = 0.80):
        self.target_soc_fraction = target_soc_fraction

    def decide(self, ctx: DispatchContext) -> DispatchDecision:
        total_demand = ctx.load_kw + ctx.parasitic_load_kw
        net = ctx.pv_available_kw - total_demand

        if net > 1e-12:
            chg = min(net, ctx.bess_max_charge_kw)
            return _balance_after_bess(ctx, chg, "cycle_charging: surplus PV mengisi BESS")

        if ctx.allow_grid_import and ctx.bess_soc < self.target_soc_fraction - 1e-9 and ctx.bess_max_charge_kw > 0.0:
            return _balance_after_bess(
                ctx,
                ctx.bess_max_charge_kw,
                f"cycle_charging: impor pengisi mengisi BESS menuju target SOC {self.target_soc_fraction:.2f}",
            )

        if net < -1e-12:
            dis = min(-net, ctx.bess_max_discharge_kw)
            return _balance_after_bess(ctx, -dis, "cycle_charging: target tercapai atau tanpa pengisi, BESS menutup defisit")

        return _balance_after_bess(ctx, 0.0, "cycle_charging: BESS diam")


class PeakShavingStrategy(DispatchStrategy):
    """Memangkas defisit beban puncak di atas ambang peak_limit_kw dan mengisi di luar puncak."""

    def __init__(self, peak_limit_kw: float):
        self.peak_limit_kw = peak_limit_kw

    def decide(self, ctx: DispatchContext) -> DispatchDecision:
        total_demand = ctx.load_kw + ctx.parasitic_load_kw
        net_deficit = total_demand - ctx.pv_available_kw

        if net_deficit > self.peak_limit_kw + 1e-12:
            shave_needed = net_deficit - self.peak_limit_kw
            dis = min(shave_needed, ctx.bess_max_discharge_kw)
            return _balance_after_bess(
                ctx,
                -dis,
                f"peak_shaving: pangkas beban di atas batas {self.peak_limit_kw:.2f} kW",
            )

        if net_deficit < -1e-12:
            surplus = -net_deficit
            chg = min(surplus, ctx.bess_max_charge_kw)
            return _balance_after_bess(ctx, chg, "peak_shaving: surplus PV mengisi BESS")

        if ctx.allow_grid_import and ctx.bess_max_charge_kw > 0.0:
            headroom = max(self.peak_limit_kw - max(net_deficit, 0.0), 0.0)
            if headroom > 1e-12:
                chg = min(headroom, ctx.bess_max_charge_kw)
                return _balance_after_bess(ctx, chg, "peak_shaving: isi BESS memakai ruang di bawah batas puncak")

        return _balance_after_bess(ctx, 0.0, "peak_shaving: beban di bawah batas puncak, BESS diam")


class TimeOfUseArbitrageStrategy(DispatchStrategy):
    """Arbitrase tarif waktu: isi saat jam luar puncak/surplus, lepas saat jam puncak."""

    def __init__(
        self,
        peak_hours: tuple[int, ...],
        off_peak_hours: tuple[int, ...],
        tou_charge_soc_target: float = 0.90,
        tou_discharge_soc_floor: float = 0.25,
    ):
        self.peak_hours = set(peak_hours)
        self.off_peak_hours = set(off_peak_hours)
        self.tou_charge_soc_target = tou_charge_soc_target
        self.tou_discharge_soc_floor = tou_discharge_soc_floor

    def decide(self, ctx: DispatchContext) -> DispatchDecision:
        total_demand = ctx.load_kw + ctx.parasitic_load_kw
        surplus = ctx.pv_available_kw - total_demand

        if ctx.hour_of_day in self.peak_hours:
            if ctx.bess_soc > self.tou_discharge_soc_floor + 1e-9 and ctx.bess_max_discharge_kw > 0.0:
                if ctx.allow_grid_export:
                    dis = ctx.bess_max_discharge_kw
                else:
                    dis = min(max(-surplus, 0.0), ctx.bess_max_discharge_kw)
                if dis > 1e-12:
                    return _balance_after_bess(ctx, -dis, "tou_arbitrage: jam puncak, discharge BESS")
            if surplus > 1e-12:
                chg = min(surplus, ctx.bess_max_charge_kw)
                return _balance_after_bess(ctx, chg, "tou_arbitrage: jam puncak dengan surplus PV mengisi BESS")
            return _balance_after_bess(ctx, 0.0, "tou_arbitrage: jam puncak, BESS pada lantai SOC")

        if ctx.hour_of_day in self.off_peak_hours:
            if ctx.bess_soc < self.tou_charge_soc_target - 1e-9 and ctx.bess_max_charge_kw > 0.0:
                if ctx.allow_grid_import:
                    chg = ctx.bess_max_charge_kw
                else:
                    chg = min(max(surplus, 0.0), ctx.bess_max_charge_kw)
                if chg > 1e-12:
                    return _balance_after_bess(ctx, chg, "tou_arbitrage: jam luar puncak, charge BESS")

        if surplus > 1e-12:
            chg = min(surplus, ctx.bess_max_charge_kw)
            return _balance_after_bess(ctx, chg, "tou_arbitrage: jam menengah, serap surplus PV")
        if surplus < -1e-12:
            dis = min(-surplus, ctx.bess_max_discharge_kw)
            return _balance_after_bess(ctx, -dis, "tou_arbitrage: jam menengah, tutup defisit beban")
        return _balance_after_bess(ctx, 0.0, "tou_arbitrage: BESS diam")


def create_dispatch_strategy(config: DispatchConfig) -> DispatchStrategy:
    """Memvalidasi DispatchConfig dan membangun strategi dispatch yang sesuai."""
    if not (0.0 <= config.target_soc_fraction <= 1.0):
        raise EngineError("invalid_dispatch_config", "target_soc_fraction harus antara 0 dan 1.")
    if not (0.0 <= config.tou_charge_soc_target <= 1.0) or not (0.0 <= config.tou_discharge_soc_floor <= 1.0):
        raise EngineError("invalid_dispatch_config", "Batas SOC TOU harus antara 0 dan 1.")
    if config.tou_discharge_soc_floor > config.tou_charge_soc_target:
        raise EngineError(
            "invalid_dispatch_config",
            "tou_discharge_soc_floor tidak boleh melebihi tou_charge_soc_target.",
        )
    _validate_hours(config.peak_hours, "peak_hours")
    _validate_hours(config.off_peak_hours, "off_peak_hours")
    if set(config.peak_hours) & set(config.off_peak_hours):
        raise EngineError("invalid_dispatch_config", "peak_hours dan off_peak_hours tidak boleh bertumpang tindih.")

    if config.strategy == "self_consumption":
        return SelfConsumptionStrategy()
    if config.strategy == "load_following":
        return LoadFollowingStrategy()
    if config.strategy == "cycle_charging":
        return CycleChargingStrategy(target_soc_fraction=config.target_soc_fraction)
    if config.strategy == "peak_shaving":
        if config.peak_limit_kw is None or not math.isfinite(config.peak_limit_kw) or config.peak_limit_kw < 0.0:
            raise EngineError(
                "invalid_dispatch_config",
                "peak_limit_kw wajib diisi (>= 0) untuk strategi peak_shaving.",
            )
        return PeakShavingStrategy(peak_limit_kw=float(config.peak_limit_kw))
    if config.strategy == "time_of_use_arbitrage":
        return TimeOfUseArbitrageStrategy(
            peak_hours=config.peak_hours,
            off_peak_hours=config.off_peak_hours,
            tou_charge_soc_target=config.tou_charge_soc_target,
            tou_discharge_soc_floor=config.tou_discharge_soc_floor,
        )

    raise EngineError("invalid_dispatch_config", f"Strategi dispatch tidak dikenal: {config.strategy}.")
