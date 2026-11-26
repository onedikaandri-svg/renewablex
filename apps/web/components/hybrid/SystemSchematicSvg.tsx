"use client";

import { useRef } from "react";
import { downloadFile, formatNumber } from "@/lib/format";
import {
  computeEdgePillLayout,
  computeSchematicBounds,
  getEdgeGeometry,
  getNodeRect,
  isKindConnectedToBus,
  resolveProjectTopology,
  serializeSchematicSvgWithLightTheme,
} from "@/lib/hybrid-topology";
import type { HybridProjectConfig, HybridSimulateResponse, TopologyNode, TopologyNodeKind } from "@/lib/hybrid-types";
import { usePreferences } from "@/lib/preferences";

const SERIES_COLOR_BY_KIND: Record<TopologyNodeKind, string> = {
  pv: "var(--series-pv)",
  bess: "var(--series-bess)",
  biomass: "var(--series-biomass)",
  ac_bus: "var(--accent)",
  load: "var(--series-load)",
  grid: "var(--series-grid)",
};

function nodeHeading(kind: TopologyNodeKind, lang: "id" | "en", config: HybridProjectConfig): string {
  switch (kind) {
    case "pv":
      return `Solar PV (${config.components.pv.model === "detailed_v1" ? "SAM 8-Tahap" : "PVWatts"})`;
    case "bess":
      return lang === "en" ? "BESS (Battery)" : "BESS (Baterai)";
    case "biomass":
      return `Biomass (${config.components.biomass.fuel_preset.toUpperCase()})`;
    case "ac_bus":
      return "AC BUS";
    case "load":
      return lang === "en" ? "Electrical Load" : "Beban Listrik";
    case "grid":
      return lang === "en" ? "Utility Grid" : "Jaringan Grid";
  }
}

function formatMwh(kwh: number, lang: "id" | "en"): string {
  return `${formatNumber(kwh / 1000, lang, 1)} ${lang === "en" ? "MWh/yr" : "MWh/thn"}`;
}

export default function SystemSchematicSvg({
  config,
  result,
  state = "ready",
  errorMessage,
}: {
  config: HybridProjectConfig;
  result?: HybridSimulateResponse | null;
  state?: "ready" | "loading" | "error";
  errorMessage?: string;
}) {
  const { lang } = usePreferences();
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (state === "loading") {
    return (
      <div className="chart-card">
        <div className="chart-head">
          <h3>{lang === "en" ? "Hybrid System Schematic" : "Skema Sistem Hybrid"}</h3>
        </div>
        <div className="state" role="status">
          <p>{lang === "en" ? "Loading system schematic..." : "Memuat skema aliran sistem..."}</p>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="chart-card">
        <div className="chart-head">
          <h3>{lang === "en" ? "Hybrid System Schematic" : "Skema Sistem Hybrid"}</h3>
        </div>
        <div className="state bad" role="alert">
          <p>{errorMessage || (lang === "en" ? "Failed to render system schematic." : "Gagal menampilkan skema sistem.")}</p>
        </div>
      </div>
    );
  }

  const topology = resolveProjectTopology(config);
  const bounds = computeSchematicBounds(topology.nodes, 52);
  const nodeMap = new Map(topology.nodes.map((n) => [n.id, n]));
  const year1Grid = result?.lifetime_summary?.yearly?.[0];
  const gridImportKwh = year1Grid?.grid_import_kwh ?? 0;
  const gridExportKwh = year1Grid?.grid_export_kwh ?? 0;

  function nodeLines(node: TopologyNode, connected: boolean): { primary: string; secondary: string; isAlert?: boolean } {
    const { pv, bess, biomass } = config.components;
    if (node.kind === "ac_bus") {
      return {
        primary: "EMS Dispatch",
        secondary: result
          ? `${formatMwh(result.summary.served_load_kwh, lang)}`
          : config.simulation.dispatch_strategy,
      };
    }

    if (!connected) {
      return {
        primary: lang === "en" ? "Disconnected" : "Terputus / Nonaktif",
        secondary: node.kind === "grid" ? (lang === "en" ? "Off-grid" : "Terisolasi") : "-",
      };
    }

    switch (node.kind) {
      case "pv":
        return result
          ? {
              primary: formatMwh(result.summary.pv_generation_kwh, lang),
              secondary:
                result.summary.curtailment_kwh > 0.01
                  ? `${formatNumber(pv.capacity_kwp, lang, 0)} kWp | Curtail ${formatNumber(result.summary.curtailment_kwh / 1000, lang, 1)}`
                  : `${formatNumber(pv.capacity_kwp, lang, 0)} kWp | Inv ${formatNumber(pv.inverter_ac_kw, lang, 0)} kW`,
            }
          : {
              primary: `${formatNumber(pv.capacity_kwp, lang, 0)} kWp`,
              secondary: `Inv ${formatNumber(pv.inverter_ac_kw, lang, 0)} kW`,
            };
      case "bess":
        return result && result.bess_summary
          ? {
              primary: `Dis ${formatMwh(result.bess_summary.total_discharge_kwh, lang)}`,
              secondary: `Chg ${formatNumber(result.bess_summary.total_charge_kwh / 1000, lang, 1)} | ${formatNumber(result.bess_summary.equivalent_full_cycles, lang, 0)} EFC`,
            }
          : {
              primary: `${formatNumber(bess.nominal_capacity_kwh, lang, 0)} kWh`,
              secondary: `${formatNumber(bess.max_charge_kw, lang, 0)} / ${formatNumber(bess.max_discharge_kw, lang, 0)} kW`,
            };
      case "biomass":
        return result && result.biomass_summary
          ? {
              primary: formatMwh(result.biomass_summary.total_generation_kwh, lang),
              secondary: `${formatNumber(result.biomass_summary.total_operating_hours, lang, 0)} jam | ${formatNumber(result.biomass_summary.total_fuel_tons, lang, 0)} ton`,
            }
          : {
              primary: `${formatNumber(biomass.rated_capacity_kw, lang, 0)} kW`,
              secondary: biomass.fuel_preset.toUpperCase(),
            };
      case "load":
        return result
          ? {
              primary: formatMwh(result.summary.served_load_kwh, lang),
              secondary:
                result.summary.unmet_load_kwh > 0.01
                  ? `Unmet ${formatMwh(result.summary.unmet_load_kwh, lang)}`
                  : (lang === "en" ? "100% load served" : "100% beban terpenuhi"),
              isAlert: result.summary.unmet_load_kwh > 0.01,
            }
          : {
              primary: `${formatNumber(config.load_profile.peak_load_kw, lang, 0)} kW puncak`,
              secondary: config.load_profile.mode === "csv" ? "Profil CSV" : "Profil Sintetis",
            };
      case "grid":
        return result
          ? {
              primary: `Imp ${formatMwh(gridImportKwh, lang)}`,
              secondary: `Eks ${formatMwh(gridExportKwh, lang)}`,
            }
          : {
              primary: lang === "en" ? "Connected by EMS" : "Terhubung via EMS",
              secondary: `${formatNumber(config.finance.grid_import_tariff_per_kwh, lang, 0)} ${config.project.currency_code}/kWh`,
            };
    }
  }

  function edgeFlowBadge(kind: TopologyNodeKind): string | null {
    if (!result) return null;
    switch (kind) {
      case "pv":
        return formatMwh(result.summary.pv_generation_kwh, lang);
      case "bess":
        return result.bess_summary
          ? `${formatNumber(result.bess_summary.total_discharge_kwh / 1000, lang, 1)} / ${formatNumber(result.bess_summary.total_charge_kwh / 1000, lang, 1)} MWh`
          : null;
      case "biomass":
        return result.biomass_summary ? formatMwh(result.biomass_summary.total_generation_kwh, lang) : null;
      case "load":
        return formatMwh(result.summary.served_load_kwh, lang);
      case "grid":
        return `${formatNumber(gridImportKwh / 1000, lang, 1)} / ${formatNumber(gridExportKwh / 1000, lang, 1)} MWh`;
      case "ac_bus":
        return null;
    }
  }

  function handleDownloadSvg() {
    if (!svgRef.current) return;
    const svgText = serializeSchematicSvgWithLightTheme(svgRef.current);
    const slug = config.project.project_name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    downloadFile(`${slug}-schematic.svg`, svgText, "image/svg+xml;charset=utf-8");
  }

  return (
    <div className="chart-card">
      <div className="chart-head">
        <div>
          <h3>{lang === "en" ? "Hybrid System Schematic (Year 1 Flow)" : "Skema Aliran Energi Sistem Hybrid (Tahun 1)"}</h3>
        </div>
        <div className="actions-inline">
          <span className="chip">{config.simulation.dispatch_strategy}</span>
          {result && (
            <button type="button" className="btn btn-sm ghost" onClick={handleDownloadSvg}>
              Unduh SVG
            </button>
          )}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
        role="img"
        aria-label={
          result
            ? `Skema aliran energi Tahun 1: PV ${formatMwh(result.summary.pv_generation_kwh, lang)}, Beban terpenuhi ${formatMwh(result.summary.served_load_kwh, lang)}.`
            : `Skema desain sistem: PV ${config.components.pv.capacity_kwp} kWp, strategi ${config.simulation.dispatch_strategy}.`
        }
      >
        <defs>
          <marker id="flow-arrow-end" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 8 5 L 0 9 z" fill="var(--accent)" />
          </marker>
          <marker id="flow-arrow-start" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 10 1 L 2 5 L 10 9 z" fill="var(--accent)" />
          </marker>
        </defs>

        {/* Garis penghubung sesuai topologi kanvas */}
        {topology.edges.map((edge) => {
          const src = nodeMap.get(edge.source);
          const tgt = nodeMap.get(edge.target);
          if (!src || !tgt) return null;
          const geo = getEdgeGeometry(src, tgt);
          const compNode = src.kind === "ac_bus" ? tgt : src;
          const color = SERIES_COLOR_BY_KIND[compNode.kind];
          const bidirectional = compNode.kind === "bess" || compNode.kind === "grid";
          const flowLabel = edgeFlowBadge(compNode.kind);
          const pill = flowLabel ? computeEdgePillLayout(geo, flowLabel) : null;

          return (
            <g key={edge.id}>
              <path
                d={geo.pathD}
                fill="none"
                stroke={color}
                strokeWidth={3}
                markerStart={bidirectional ? "url(#flow-arrow-start)" : undefined}
                markerEnd="url(#flow-arrow-end)"
              />
              {flowLabel && pill && (
                <g>
                  <rect
                    x={pill.x}
                    y={pill.y}
                    width={pill.width}
                    height={pill.height}
                    rx={10}
                    fill="var(--surface)"
                    stroke={color}
                    strokeWidth={1.25}
                  />
                  <text
                    x={pill.cx}
                    y={pill.cy + 3.2}
                    textAnchor="middle"
                    style={{
                      fill: "var(--navytext)",
                      fontSize: "9.5px",
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {flowLabel}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Blok komponen mengikuti posisi node dari kanvas */}
        {topology.nodes.map((node) => {
          const rect = getNodeRect(node);
          const connected = isKindConnectedToBus(topology, node.kind);
          const isBus = node.kind === "ac_bus";
          const color = SERIES_COLOR_BY_KIND[node.kind];
          const info = nodeLines(node, connected);

          return (
            <g key={node.id}>
              <rect
                x={rect.x}
                y={rect.y}
                width={rect.width}
                height={rect.height}
                rx={isBus ? 8 : 6}
                fill={isBus ? "var(--bg)" : "var(--surface-subtle)"}
                stroke={connected ? color : "var(--border)"}
                strokeWidth={isBus ? 2.5 : 2}
                strokeDasharray={connected ? undefined : "4 4"}
              />
              <text
                x={isBus ? rect.cx : rect.x + 12}
                y={rect.y + 23}
                textAnchor={isBus ? "middle" : "start"}
                style={{ fill: "var(--navytext)", fontWeight: 700, fontSize: "12.5px" }}
              >
                {nodeHeading(node.kind, lang, config)}
              </text>
              <text
                x={isBus ? rect.cx : rect.x + 12}
                y={rect.y + 43}
                textAnchor={isBus ? "middle" : "start"}
                style={{
                  fill: connected ? color : "var(--muted)",
                  fontWeight: 600,
                  fontSize: "12px",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {info.primary}
              </text>
              <text
                x={isBus ? rect.cx : rect.x + 12}
                y={rect.y + 61}
                textAnchor={isBus ? "middle" : "start"}
                style={{
                  fill: info.isAlert ? "var(--errtext)" : "var(--muted)",
                  fontSize: "10.5px",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {info.secondary}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
