"""Antarmuka DispatchStrategy dan 5 strategi dispatch bawaan untuk simulasi hybrid."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
import math
from typing import Any, Literal

from app.errors import EngineError

StrategyName = Literal[
    "self_consumption",
    "load_following",
    "cycle_charging",
    "peak_shaving",
    "time_of_use_arbitrage",
    "custom_ems",
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
    biomass_status: str = "off"
    biomass_available_kw: float = 0.0
    biomass_current_power_kw: float = 0.0
    biomass_min_load_kw: float = 0.0
    biomass_can_start: bool = False
    biomass_can_stop: bool = True
    biomass_fuel_remaining_tons: float | None = None
    diesel_status: str = "off"
    diesel_available_kw: float = 0.0
    diesel_current_power_kw: float = 0.0
    diesel_min_load_kw: float = 0.0
    diesel_can_start: bool = False
    diesel_can_stop: bool = True

    @property
    def pv_surplus_kw(self) -> float:
        """Kelebihan daya PV setelah memenuhi beban listrik dan beban parasitik."""
        return max(self.pv_available_kw - (self.load_kw + self.parasitic_load_kw), 0.0)

    @property
    def net_load_kw(self) -> float:
        """Selisih beban total terhadap daya PV yang tersedia."""
        return (self.load_kw + self.parasitic_load_kw) - self.pv_available_kw


@dataclass(frozen=True)
class DispatchDecision:
    """Keputusan aliran daya per langkah waktu hasil strategi dispatch."""

    bess_command_kw: float  # Positif = charge, negatif = discharge, 0 = diam.
    grid_import_kw: float
    grid_export_kw: float
    curtailment_kw: float
    trace_reason: str
    biomass_command_kw: float = 0.0
    biomass_start_request: bool = False
    biomass_stop_request: bool = False
    diesel_command_kw: float = 0.0


@dataclass(frozen=True)
class DispatchConfig:
    """Konfigurasi strategi dispatch bawaan Tahap 2 dan kustom Tahap 3B."""

    strategy: StrategyName = "self_consumption"
    allow_grid_import: bool = False
    allow_grid_export: bool = False
    target_soc_fraction: float = 0.80  # Untuk cycle_charging.
    peak_limit_kw: float | None = None  # Untuk peak_shaving.
    peak_hours: tuple[int, ...] = (17, 18, 19, 20, 21)
    off_peak_hours: tuple[int, ...] = (0, 1, 2, 3, 4, 5)
    tou_charge_soc_target: float = 0.90
    tou_discharge_soc_floor: float = 0.25
    ems_rules: dict[str, Any] | None = None


def _validate_hours(hours: tuple[int, ...], name: str) -> None:
    for h in hours:
        if isinstance(h, bool) or not isinstance(h, int) or not (0 <= h <= 23):
            raise EngineError("invalid_dispatch_config", f"Jam pada {name} harus bilangan bulat 0..23.")


class DispatchStrategy(ABC):
    """Kontrak dasar strategi dispatch agar mudah diganti interpreter aturan EMS."""

    @abstractmethod
    def decide(self, ctx: DispatchContext) -> DispatchDecision:
        """Menghasilkan keputusan dispatch pada satu langkah waktu."""


def _has_biomass(ctx: DispatchContext) -> bool:
    return (
        ctx.biomass_status != "off"
        or ctx.biomass_available_kw > 0.0
        or ctx.biomass_can_start
        or ctx.biomass_current_power_kw > 0.0
    )


def _has_diesel(ctx: DispatchContext) -> bool:
    return (
        ctx.diesel_status != "off"
        or ctx.diesel_available_kw > 0.0
        or ctx.diesel_can_start
        or ctx.diesel_current_power_kw > 0.0
    )


def _has_dispatchable_gen(ctx: DispatchContext) -> bool:
    return _has_biomass(ctx) or _has_diesel(ctx)


def _plan_biomass_for_deficit(ctx: DispatchContext, needed_kw: float) -> tuple[float, bool, bool]:
    """Menentukan perintah daya, start, dan stop Biomass untuk menutup kekurangan daya."""
    if not _has_biomass(ctx):
        return 0.0, False, False
    if needed_kw > 1e-12:
        if ctx.biomass_available_kw > 0.0:
            cmd = min(max(needed_kw, ctx.biomass_min_load_kw), ctx.biomass_available_kw)
            start_req = ctx.biomass_status == "off" and ctx.biomass_can_start
            return cmd, start_req, False
        if ctx.biomass_status == "off" and ctx.biomass_can_start:
            return 0.0, True, False
        if ctx.biomass_status == "starting":
            return 0.0, False, False
    if ctx.biomass_status in ("running", "starting") and ctx.biomass_can_stop:
        return 0.0, False, True
    if ctx.biomass_status == "running":
        return min(ctx.biomass_min_load_kw, ctx.biomass_available_kw), False, False
    return 0.0, False, False


def _plan_diesel_for_deficit(ctx: DispatchContext, needed_kw: float) -> float:
    """Menentukan perintah daya Diesel Generator untuk menutup sisa defisit setelah Biomass."""
    if not _has_diesel(ctx):
        return 0.0
    if needed_kw > 1e-12:
        if ctx.diesel_available_kw > 0.0:
            return min(max(needed_kw, ctx.diesel_min_load_kw), ctx.diesel_available_kw)
        return 0.0
    if ctx.diesel_status == "running":
        if ctx.diesel_can_stop:
            return 0.0
        return min(ctx.diesel_min_load_kw, ctx.diesel_available_kw)
    return 0.0


def _plan_generators_for_deficit(
    ctx: DispatchContext,
    needed_kw: float,
) -> tuple[float, bool, bool, float]:
    """Merencanakan dispatch berurutan: Biomass lebih dulu, lalu Diesel untuk sisa defisit."""
    bio_cmd, bio_start, bio_stop = _plan_biomass_for_deficit(ctx, needed_kw)
    rem_after_bio = max(needed_kw - bio_cmd, 0.0)
    diesel_cmd = _plan_diesel_for_deficit(ctx, rem_after_bio)
    return bio_cmd, bio_start, bio_stop, diesel_cmd


def _balance_after_bess(
    ctx: DispatchContext,
    bess_cmd_kw: float,
    reason: str,
    biomass_cmd_kw: float = 0.0,
    biomass_start: bool = False,
    biomass_stop: bool = False,
    diesel_cmd_kw: float = 0.0,
) -> DispatchDecision:
    """Menurunkan impor, ekspor, dan curtailment AC bus yang konsisten dengan perintah BESS dan pembangkit."""
    total_demand = ctx.load_kw + ctx.parasitic_load_kw
    total_gen = ctx.pv_available_kw + max(biomass_cmd_kw, 0.0) + max(diesel_cmd_kw, 0.0)
    net_ac = total_gen - total_demand

    if bess_cmd_kw > 0.0:
        # Pengisian baterai membutuhkan pasokan AC dari surplus pembangkit atau grid (jika diizinkan).
        max_supply_for_chg = max(total_gen - total_demand, 0.0)
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
            biomass_command_kw=biomass_cmd_kw,
            biomass_start_request=biomass_start,
            biomass_stop_request=biomass_stop,
            diesel_command_kw=diesel_cmd_kw,
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
            biomass_command_kw=biomass_cmd_kw,
            biomass_start_request=biomass_start,
            biomass_stop_request=biomass_stop,
            diesel_command_kw=diesel_cmd_kw,
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
        biomass_command_kw=biomass_cmd_kw,
        biomass_start_request=biomass_start,
        biomass_stop_request=biomass_stop,
        diesel_command_kw=diesel_cmd_kw,
    )


class SelfConsumptionStrategy(DispatchStrategy):
    """Memprioritaskan surplus PV untuk mengisi BESS dan discharge atau Biomass/Diesel untuk defisit beban."""

    def decide(self, ctx: DispatchContext) -> DispatchDecision:
        total_demand = ctx.load_kw + ctx.parasitic_load_kw
        surplus = ctx.pv_available_kw - total_demand
        if not _has_dispatchable_gen(ctx):
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

        if surplus > 1e-12:
            bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, 0.0)
            chg = min(surplus + bio_cmd + diesel_cmd, ctx.bess_max_charge_kw)
            reason = "self_consumption: surplus PV mengisi BESS, pembangkit dihentikan bila diizinkan"
            return _balance_after_bess(ctx, chg, reason, bio_cmd, bio_start, bio_stop, diesel_cmd)

        deficit = max(-surplus, 0.0)
        dis = min(deficit, ctx.bess_max_discharge_kw)
        rem_def = max(deficit - dis, 0.0)
        bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, rem_def)
        if diesel_cmd > 0.0 and bio_cmd > 0.0:
            reason = "self_consumption: PV, BESS, Biomass, dan Diesel menutup defisit beban"
        elif diesel_cmd > 0.0:
            reason = "self_consumption: Diesel menutup sisa defisit setelah PV/BESS"
        elif bio_cmd > 0.0:
            reason = "self_consumption: BESS dan Biomass menutup defisit beban"
        elif bio_start:
            reason = "self_consumption: BESS menutup defisit sambil menyalakan Biomass"
        elif dis > 0.0:
            reason = "self_consumption: BESS discharge menutup defisit beban"
        else:
            reason = "self_consumption: pasokan seimbang atau pembangkit menunggu transisi"
        return _balance_after_bess(ctx, -dis, reason, bio_cmd, bio_start, bio_stop, diesel_cmd)


class LoadFollowingStrategy(DispatchStrategy):
    """Menjaga pertukaran daya netto titik sambung nol dengan menyerap surplus dan menambal defisit."""

    def decide(self, ctx: DispatchContext) -> DispatchDecision:
        total_demand = ctx.load_kw + ctx.parasitic_load_kw
        net = ctx.pv_available_kw - total_demand
        if not _has_dispatchable_gen(ctx):
            if net > 1e-12:
                chg = min(net, ctx.bess_max_charge_kw)
                return _balance_after_bess(ctx, chg, "load_following: serap surplus PV ke BESS")
            if net < -1e-12:
                dis = min(-net, ctx.bess_max_discharge_kw)
                return _balance_after_bess(ctx, -dis, "load_following: discharge BESS mengikuti defisit beban")
            return _balance_after_bess(ctx, 0.0, "load_following: beban seimbang, BESS diam")

        if net > 1e-12:
            bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, 0.0)
            chg = min(net + bio_cmd + diesel_cmd, ctx.bess_max_charge_kw)
            return _balance_after_bess(
                ctx,
                chg,
                "load_following: serap surplus PV ke BESS",
                bio_cmd,
                bio_start,
                bio_stop,
                diesel_cmd,
            )

        deficit = max(-net, 0.0)
        dis = min(deficit, ctx.bess_max_discharge_kw)
        rem_def = max(deficit - dis, 0.0)
        bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, rem_def)
        total_gen_cmd = bio_cmd + diesel_cmd
        bess_cmd = -dis
        if total_gen_cmd > rem_def + 1e-12 and ctx.bess_max_charge_kw > 0.0 and dis == 0.0:
            bess_cmd = min(total_gen_cmd - rem_def, ctx.bess_max_charge_kw)
        if diesel_cmd > 0.0:
            reason = "load_following: PV, BESS, Biomass, dan Diesel mengikuti defisit beban bersih"
        elif bio_cmd > 0.0 or bio_start:
            reason = "load_following: Biomass dan BESS mengikuti defisit beban bersih"
        else:
            reason = "load_following: discharge BESS mengikuti defisit beban"
        return _balance_after_bess(ctx, bess_cmd, reason, bio_cmd, bio_start, bio_stop, diesel_cmd)


class CycleChargingStrategy(DispatchStrategy):
    """Mengisi BESS menuju target SOC saat surplus atau ketika Biomass/Diesel/grid aktif."""

    def __init__(self, target_soc_fraction: float = 0.80):
        self.target_soc_fraction = target_soc_fraction

    def decide(self, ctx: DispatchContext) -> DispatchDecision:
        total_demand = ctx.load_kw + ctx.parasitic_load_kw
        net = ctx.pv_available_kw - total_demand

        if not _has_dispatchable_gen(ctx):
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

        if net > 1e-12:
            bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, 0.0)
            chg = min(net + bio_cmd + diesel_cmd, ctx.bess_max_charge_kw)
            return _balance_after_bess(
                ctx,
                chg,
                "cycle_charging: surplus PV mengisi BESS",
                bio_cmd,
                bio_start,
                bio_stop,
                diesel_cmd,
            )

        deficit = max(-net, 0.0)
        needs_charge = ctx.bess_soc < self.target_soc_fraction - 1e-9 and ctx.bess_max_charge_kw > 0.0
        if needs_charge:
            desired_total = deficit + ctx.bess_max_charge_kw
            bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, desired_total)
            total_gen_cmd = bio_cmd + diesel_cmd
            if total_gen_cmd > deficit + 1e-12:
                chg = min(total_gen_cmd - deficit, ctx.bess_max_charge_kw)
                source_lbl = "Biomass & Diesel" if (bio_cmd > 0.0 and diesel_cmd > 0.0) else ("Diesel" if diesel_cmd > 0.0 else "Biomass")
                return _balance_after_bess(
                    ctx,
                    chg,
                    f"cycle_charging: {source_lbl} menyuplai beban dan mengisi BESS menuju target SOC {self.target_soc_fraction:.2f}",
                    bio_cmd,
                    bio_start,
                    bio_stop,
                    diesel_cmd,
                )
            if ctx.allow_grid_import:
                return _balance_after_bess(
                    ctx,
                    ctx.bess_max_charge_kw,
                    f"cycle_charging: impor pengisi mengisi BESS menuju target SOC {self.target_soc_fraction:.2f}",
                    bio_cmd,
                    bio_start,
                    bio_stop,
                    diesel_cmd,
                )
            dis = min(max(deficit - total_gen_cmd, 0.0), ctx.bess_max_discharge_kw)
            return _balance_after_bess(
                ctx,
                -dis,
                "cycle_charging: BESS dan pembangkit menutup defisit saat pengisi terbatas",
                bio_cmd,
                bio_start,
                bio_stop,
                diesel_cmd,
            )

        dis = min(deficit, ctx.bess_max_discharge_kw)
        rem_def = max(deficit - dis, 0.0)
        bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, rem_def)
        return _balance_after_bess(
            ctx,
            -dis,
            "cycle_charging: target SOC tercapai, BESS dan pembangkit menutup defisit",
            bio_cmd,
            bio_start,
            bio_stop,
            diesel_cmd,
        )


class PeakShavingStrategy(DispatchStrategy):
    """Memangkas defisit beban puncak di atas ambang peak_limit_kw dan mengisi di luar puncak."""

    def __init__(self, peak_limit_kw: float):
        self.peak_limit_kw = peak_limit_kw

    def decide(self, ctx: DispatchContext) -> DispatchDecision:
        total_demand = ctx.load_kw + ctx.parasitic_load_kw
        net_deficit = total_demand - ctx.pv_available_kw

        if not _has_dispatchable_gen(ctx):
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

        if net_deficit > self.peak_limit_kw + 1e-12:
            shave_needed = net_deficit - self.peak_limit_kw
            dis = min(shave_needed, ctx.bess_max_discharge_kw)
            rem_shave = max(shave_needed - dis, 0.0)
            bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, rem_shave)
            return _balance_after_bess(
                ctx,
                -dis,
                f"peak_shaving: BESS dan pembangkit memangkas beban di atas {self.peak_limit_kw:.2f} kW",
                bio_cmd,
                bio_start,
                bio_stop,
                diesel_cmd,
            )

        bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, 0.0)
        extra_gen = bio_cmd + diesel_cmd
        if net_deficit < -1e-12:
            surplus = -net_deficit + extra_gen
            chg = min(surplus, ctx.bess_max_charge_kw)
            return _balance_after_bess(
                ctx,
                chg,
                "peak_shaving: surplus PV mengisi BESS",
                bio_cmd,
                bio_start,
                bio_stop,
                diesel_cmd,
            )

        if ctx.allow_grid_import and ctx.bess_max_charge_kw > 0.0:
            headroom = max(self.peak_limit_kw - max(net_deficit - extra_gen, 0.0), 0.0)
            if headroom > 1e-12:
                chg = min(headroom, ctx.bess_max_charge_kw)
                return _balance_after_bess(
                    ctx,
                    chg,
                    "peak_shaving: isi BESS memakai ruang di bawah batas puncak",
                    bio_cmd,
                    bio_start,
                    bio_stop,
                    diesel_cmd,
                )

        return _balance_after_bess(
            ctx,
            0.0,
            "peak_shaving: beban di bawah batas puncak",
            bio_cmd,
            bio_start,
            bio_stop,
            diesel_cmd,
        )


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

        if not _has_dispatchable_gen(ctx):
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

        if ctx.hour_of_day in self.peak_hours:
            dis = 0.0
            if ctx.bess_soc > self.tou_discharge_soc_floor + 1e-9 and ctx.bess_max_discharge_kw > 0.0:
                if ctx.allow_grid_export:
                    dis = ctx.bess_max_discharge_kw
                else:
                    dis = min(max(-surplus, 0.0), ctx.bess_max_discharge_kw)
            if dis > 1e-12:
                rem_def = max(-surplus - dis, 0.0)
                bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, rem_def)
                return _balance_after_bess(
                    ctx,
                    -dis,
                    "tou_arbitrage: jam puncak, BESS dan pembangkit menutup beban",
                    bio_cmd,
                    bio_start,
                    bio_stop,
                    diesel_cmd,
                )
            if surplus > 1e-12:
                bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, 0.0)
                chg = min(surplus + bio_cmd + diesel_cmd, ctx.bess_max_charge_kw)
                return _balance_after_bess(
                    ctx,
                    chg,
                    "tou_arbitrage: jam puncak dengan surplus PV mengisi BESS",
                    bio_cmd,
                    bio_start,
                    bio_stop,
                    diesel_cmd,
                )
            rem_def = max(-surplus, 0.0)
            bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, rem_def)
            return _balance_after_bess(
                ctx,
                0.0,
                "tou_arbitrage: jam puncak, BESS pada lantai SOC dan pembangkit membantu sisa defisit",
                bio_cmd,
                bio_start,
                bio_stop,
                diesel_cmd,
            )

        if ctx.hour_of_day in self.off_peak_hours:
            if ctx.bess_soc < self.tou_charge_soc_target - 1e-9 and ctx.bess_max_charge_kw > 0.0:
                if ctx.allow_grid_import:
                    bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, 0.0)
                    return _balance_after_bess(
                        ctx,
                        ctx.bess_max_charge_kw,
                        "tou_arbitrage: jam luar puncak, charge BESS dari surplus/grid",
                        bio_cmd,
                        bio_start,
                        bio_stop,
                        diesel_cmd,
                    )
                if surplus > 1e-12:
                    bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, 0.0)
                    chg = min(surplus + bio_cmd + diesel_cmd, ctx.bess_max_charge_kw)
                    return _balance_after_bess(
                        ctx,
                        chg,
                        "tou_arbitrage: jam luar puncak, charge BESS dari surplus PV",
                        bio_cmd,
                        bio_start,
                        bio_stop,
                        diesel_cmd,
                    )
            rem_def = max(-surplus, 0.0) if not ctx.allow_grid_import else 0.0
            bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, rem_def)
            return _balance_after_bess(
                ctx,
                0.0,
                "tou_arbitrage: jam luar puncak, pembangkit menutup sisa defisit tanpa impor grid"
                if rem_def > 1e-12
                else "tou_arbitrage: jam luar puncak, BESS diam",
                bio_cmd,
                bio_start,
                bio_stop,
                diesel_cmd,
            )

        if surplus > 1e-12:
            bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, 0.0)
            chg = min(surplus + bio_cmd + diesel_cmd, ctx.bess_max_charge_kw)
            return _balance_after_bess(
                ctx,
                chg,
                "tou_arbitrage: jam menengah, serap surplus PV",
                bio_cmd,
                bio_start,
                bio_stop,
                diesel_cmd,
            )
        if surplus < -1e-12:
            deficit = -surplus
            dis = min(deficit, ctx.bess_max_discharge_kw)
            rem_def = max(deficit - dis, 0.0)
            bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, rem_def)
            return _balance_after_bess(
                ctx,
                -dis,
                "tou_arbitrage: jam menengah, BESS dan pembangkit tutup defisit beban",
                bio_cmd,
                bio_start,
                bio_stop,
                diesel_cmd,
            )
        bio_cmd, bio_start, bio_stop, diesel_cmd = _plan_generators_for_deficit(ctx, 0.0)
        return _balance_after_bess(ctx, 0.0, "tou_arbitrage: BESS diam", bio_cmd, bio_start, bio_stop, diesel_cmd)


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
    if config.strategy == "custom_ems":
        from app.hybrid.ems import CustomEMSStrategy

        return CustomEMSStrategy(config)

    raise EngineError("invalid_dispatch_config", f"Strategi dispatch tidak dikenal: {config.strategy}.")
