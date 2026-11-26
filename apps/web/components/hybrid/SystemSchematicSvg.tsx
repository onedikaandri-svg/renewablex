"use client";

import type { HybridProjectConfig, HybridSimulateResponse } from "@/lib/hybrid-types";
import { formatNumber } from "@/lib/format";
import { usePreferences } from "@/lib/preferences";

export default function SystemSchematicSvg({
  config,
  result,
}: {
  config: HybridProjectConfig;
  result?: HybridSimulateResponse | null;
}) {
  const { lang } = usePreferences();
  const { pv, bess, biomass } = config.components;
  const allowGrid = config.simulation.dispatch_params.allow_grid_import || config.simulation.dispatch_params.allow_grid_export;

  const pvValue = result
    ? `${formatNumber(result.summary.pv_generation_kwh / 1000, lang, 1)} MWh/thn`
    : `${formatNumber(pv.capacity_kwp, lang, 0)} kWp`;
  const bessValue = !bess.enabled
    ? (lang === "en" ? "Disabled" : "Nonaktif")
    : result && result.bess_summary
      ? `${formatNumber(result.bess_summary.total_discharge_kwh / 1000, lang, 1)} MWh/thn`
      : `${formatNumber(bess.nominal_capacity_kwh, lang, 0)} kWh`;
  const bioValue = !biomass.enabled
    ? (lang === "en" ? "Disabled" : "Nonaktif")
    : result && result.biomass_summary
      ? `${formatNumber(result.biomass_summary.total_generation_kwh / 1000, lang, 1)} MWh/thn`
      : `${formatNumber(biomass.rated_capacity_kw, lang, 0)} kW`;
  const loadValue = result
    ? `${formatNumber(result.summary.served_load_kwh / 1000, lang, 1)} MWh/thn`
    : `${formatNumber(config.load_profile.peak_load_kw, lang, 0)} kW puncak`;

  return (
    <div className="chart-card">
      <div className="chart-head">
        <h3>{lang === "en" ? "Hybrid System Schematic" : "Skema Blok Sistem Hybrid"}</h3>
        <span className="chip">{config.simulation.dispatch_strategy}</span>
      </div>
      <svg
        viewBox="0 0 680 300"
        role="img"
        aria-label={
          lang === "en"
            ? `System schematic: PV ${pvValue}, BESS ${bessValue}, Biomass ${bioValue}, Load ${loadValue}`
            : `Skema sistem: PV ${pvValue}, BESS ${bessValue}, Biomass ${bioValue}, Beban ${loadValue}`
        }
      >
        {/* Garis penghubung ke AC Bus */}
        <line x1="170" y1="54" x2="340" y2="150" stroke="var(--series-pv)" strokeWidth={pv.enabled ? 3 : 1.5} strokeDasharray={pv.enabled ? undefined : "4 4"} />
        <line x1="170" y1="150" x2="340" y2="150" stroke="var(--series-bess)" strokeWidth={bess.enabled ? 3 : 1.5} strokeDasharray={bess.enabled ? undefined : "4 4"} />
        <line x1="170" y1="246" x2="340" y2="150" stroke="var(--series-biomass)" strokeWidth={biomass.enabled ? 3 : 1.5} strokeDasharray={biomass.enabled ? undefined : "4 4"} />
        <line x1="340" y1="150" x2="500" y2="110" stroke="var(--series-load)" strokeWidth={3} />
        <line x1="340" y1="150" x2="500" y2="215" stroke="var(--series-grid)" strokeWidth={allowGrid ? 2.5 : 1.5} strokeDasharray={allowGrid ? undefined : "4 4"} />

        {/* Blok PV */}
        <rect x="20" y="20" width="160" height="68" rx="6" fill="var(--surface-subtle)" stroke="var(--series-pv)" strokeWidth="2" />
        <text x="34" y="44" style={{ fill: "var(--navytext)", fontWeight: 600, fontSize: "13px" }}>
          Solar PV ({pv.model === "detailed_v1" ? "SAM 8-Tahap" : "PVWatts"})
        </text>
        <text x="34" y="68" style={{ fill: "var(--series-pv)", fontWeight: 600, fontSize: "13px" }}>
          {pvValue} | Inv {formatNumber(pv.inverter_ac_kw, lang, 0)} kW
        </text>

        {/* Blok BESS */}
        <rect x="20" y="116" width="160" height="68" rx="6" fill="var(--surface-subtle)" stroke={bess.enabled ? "var(--series-bess)" : "var(--border)"} strokeWidth="2" />
        <text x="34" y="140" style={{ fill: "var(--navytext)", fontWeight: 600, fontSize: "13px" }}>
          BESS (Baterai)
        </text>
        <text x="34" y="164" style={{ fill: bess.enabled ? "var(--series-bess)" : "var(--muted)", fontWeight: 600, fontSize: "13px" }}>
          {bessValue}
        </text>

        {/* Blok Biomass */}
        <rect x="20" y="212" width="160" height="68" rx="6" fill="var(--surface-subtle)" stroke={biomass.enabled ? "var(--series-biomass)" : "var(--border)"} strokeWidth="2" />
        <text x="34" y="236" style={{ fill: "var(--navytext)", fontWeight: 600, fontSize: "13px" }}>
          Biomass ({biomass.fuel_preset.toUpperCase()})
        </text>
        <text x="34" y="260" style={{ fill: biomass.enabled ? "var(--series-biomass)" : "var(--muted)", fontWeight: 600, fontSize: "13px" }}>
          {bioValue}
        </text>

        {/* AC Bus Tengah */}
        <rect x="292" y="106" width="96" height="88" rx="8" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2.5" />
        <text x="340" y="144" textAnchor="middle" style={{ fill: "var(--navytext)", fontWeight: 700, fontSize: "13px" }}>
          AC BUS
        </text>
        <text x="340" y="164" textAnchor="middle" style={{ fill: "var(--accent)", fontSize: "11px" }}>
          EMS Dispatch
        </text>

        {/* Blok Beban */}
        <rect x="500" y="72" width="160" height="72" rx="6" fill="var(--surface-subtle)" stroke="var(--series-load)" strokeWidth="2" />
        <text x="514" y="98" style={{ fill: "var(--navytext)", fontWeight: 600, fontSize: "13px" }}>
          {lang === "en" ? "Electrical Load" : "Beban Listrik"}
        </text>
        <text x="514" y="122" style={{ fill: "var(--navytext)", fontWeight: 600, fontSize: "13px" }}>
          {loadValue}
        </text>

        {/* Blok Grid */}
        <rect x="500" y="180" width="160" height="68" rx="6" fill="var(--surface-subtle)" stroke={allowGrid ? "var(--series-grid)" : "var(--border)"} strokeWidth="2" />
        <text x="514" y="206" style={{ fill: "var(--navytext)", fontWeight: 600, fontSize: "13px" }}>
          {lang === "en" ? "Utility Grid" : "Jaringan Listrik (Grid)"}
        </text>
        <text x="514" y="228" style={{ fill: allowGrid ? "var(--series-grid)" : "var(--muted)", fontSize: "12px" }}>
          {allowGrid
            ? (lang === "en" ? "Connected by EMS" : "Terhubung via EMS")
            : (lang === "en" ? "Off-grid / Islanded" : "Terisolasi (Off-grid)")}
        </text>
      </svg>
    </div>
  );
}
