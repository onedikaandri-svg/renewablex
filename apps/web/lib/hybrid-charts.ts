import type { HybridProjectConfig, HybridSimulateResponse } from "@/lib/hybrid-types";

export interface SankeyNodeItem {
  name: string;
}

export interface SankeyLinkItem {
  source: string;
  target: string;
  value: number;
}

export interface SankeyEnergyData {
  nodes: SankeyNodeItem[];
  links: SankeyLinkItem[];
  rows: Array<{ source: string; target: string; mwh: number }>;
}

/**
 * Menyusun data Diagram Aliran Energi (Sankey Tahun 1) langsung dari angka mesin backend
 * dalam struktur graf berarah bebas siklus (DAG) agar aman dirender ECharts Sankey.
 */
export function buildSankeyEnergyData(
  result: HybridSimulateResponse,
  lang: "id" | "en",
): SankeyEnergyData {
  const pvMwh = Math.max(0, result.summary.pv_generation_kwh / 1000);
  const bioMwh = Math.max(0, result.summary.biomass_generation_kwh / 1000);
  const gridImpMwh = Math.max(0, (result.lifetime_summary.yearly?.[0]?.grid_import_kwh ?? 0) / 1000);
  const gridExpMwh = Math.max(0, (result.lifetime_summary.yearly?.[0]?.grid_export_kwh ?? 0) / 1000);
  const bessChgMwh = Math.max(0, (result.bess_summary?.total_charge_kwh ?? 0) / 1000);
  const bessDisMwh = Math.max(0, (result.bess_summary?.total_discharge_kwh ?? 0) / 1000);
  const bessLossMwh = Math.max(0, (result.bess_summary?.conversion_losses_kwh ?? 0) / 1000);
  const servedMwh = Math.max(0, result.summary.served_load_kwh / 1000);
  const curtailMwh = Math.max(0, result.summary.curtailment_kwh / 1000);
  const totalSupplyMwh = pvMwh + bioMwh + gridImpMwh;
  const bessAuxMwh = Math.max(0, (result.bess_summary?.aux_load_kwh ?? 0) / 1000);
  const directSupplyToBusMwh = Math.max(0, totalSupplyMwh - bessChgMwh);

  const labels =
    lang === "en"
      ? {
          pv: "Solar PV",
          biomass: "Biomass",
          gridImp: "Grid Import",
          supplyBus: "Supply Bus",
          bessChg: "BESS Storage",
          distBus: "AC Distribution",
          bessLoss: "BESS Losses",
          served: "Served Load",
          gridExp: "Grid Export",
          curtail: "Curtailment",
          parasitic: "Aux & Parasitic",
        }
      : {
          pv: "Solar PV",
          biomass: "Biomass",
          gridImp: "Impor Grid",
          supplyBus: "Bus Pasokan AC",
          bessChg: "Penyimpanan BESS",
          distBus: "Distribusi AC",
          bessLoss: "Rugi Konversi BESS",
          served: "Beban Terpenuhi",
          gridExp: "Ekspor Grid",
          curtail: "Curtailment",
          parasitic: "Beban Parasitik",
        };

  const candidates: Array<{ source: string; target: string; raw: number }> = [
    { source: labels.pv, target: labels.supplyBus, raw: pvMwh },
    { source: labels.biomass, target: labels.supplyBus, raw: bioMwh },
    { source: labels.gridImp, target: labels.supplyBus, raw: gridImpMwh },
    { source: labels.supplyBus, target: labels.bessChg, raw: bessChgMwh },
    { source: labels.supplyBus, target: labels.distBus, raw: directSupplyToBusMwh },
    { source: labels.bessChg, target: labels.distBus, raw: bessDisMwh },
    { source: labels.bessChg, target: labels.bessLoss, raw: bessLossMwh },
    { source: labels.distBus, target: labels.served, raw: servedMwh },
    { source: labels.distBus, target: labels.gridExp, raw: gridExpMwh },
    { source: labels.distBus, target: labels.curtail, raw: curtailMwh },
    { source: labels.distBus, target: labels.parasitic, raw: bessAuxMwh },
  ];

  const links: SankeyLinkItem[] = [];
  const nodeSet = new Set<string>();
  for (const item of candidates) {
    const val = Math.round(item.raw * 100) / 100;
    if (val > 0.001) {
      links.push({ source: item.source, target: item.target, value: val });
      nodeSet.add(item.source);
      nodeSet.add(item.target);
    }
  }

  return {
    nodes: Array.from(nodeSet).map((name) => ({ name })),
    links,
    rows: links.map((l) => ({ source: l.source, target: l.target, mwh: l.value })),
  };
}

export interface DurationCurveSeriesData {
  percentLabels: string[];
  loadKw: number[];
  servedKw: number[];
  pvKw: number[];
  biomassKw: number[];
  stats: Array<{
    key: "load" | "served" | "pv" | "biomass";
    peakKw: number;
    medianKw: number;
    minKw: number;
  }>;
}

function decimateSortedDescending(sorted: number[], maxPoints: number): { indices: number[]; values: number[] } {
  const n = sorted.length;
  if (n === 0) return { indices: [], values: [] };
  if (n <= maxPoints) {
    return {
      indices: sorted.map((_, idx) => idx),
      values: sorted.map((v) => Math.round(v * 100) / 100),
    };
  }
  const indices: number[] = [];
  const values: number[] = [];
  const last = n - 1;
  for (let k = 0; k < maxPoints; k++) {
    const idx = k === maxPoints - 1 ? last : Math.round((k * last) / (maxPoints - 1));
    if (indices.length === 0 || indices[indices.length - 1] !== idx) {
      indices.push(idx);
      values.push(Math.round(sorted[idx] * 100) / 100);
    }
  }
  return { indices, values };
}

/**
 * Menyusun kurva durasi (0% sampai 100% jam setahun, terurut menurun) dengan decimation
 * tampilan agar ringan di browser sambil mempertahankan nilai puncak dan minimum eksak.
 */
export function buildDurationCurveSeries(
  hourly: NonNullable<HybridSimulateResponse["hourly_year_1"]>,
  maxPoints = 240,
): DurationCurveSeriesData {
  const rawSeries = [
    { key: "load" as const, arr: hourly.load_kw },
    { key: "served" as const, arr: hourly.served_load_kw },
    { key: "pv" as const, arr: hourly.pv_generation_kw },
    { key: "biomass" as const, arr: hourly.biomass_generation_kw },
  ];

  const sortedMap = new Map<string, number[]>();
  const stats: DurationCurveSeriesData["stats"] = [];

  for (const s of rawSeries) {
    const sorted = [...s.arr].sort((a, b) => b - a);
    sortedMap.set(s.key, sorted);
    const n = sorted.length;
    stats.push({
      key: s.key,
      peakKw: n > 0 ? sorted[0] : 0,
      medianKw: n > 0 ? sorted[Math.floor(n / 2)] : 0,
      minKw: n > 0 ? sorted[n - 1] : 0,
    });
  }

  const loadSorted = sortedMap.get("load") ?? [];
  const baseDecimated = decimateSortedDescending(loadSorted, maxPoints);
  const totalLen = Math.max(loadSorted.length - 1, 1);
  const percentLabels = baseDecimated.indices.map((idx) => `${((idx / totalLen) * 100).toFixed(1)}%`);

  return {
    percentLabels,
    loadKw: baseDecimated.values,
    servedKw: baseDecimated.indices.map((idx) => Math.round(((sortedMap.get("served") ?? [])[idx] ?? 0) * 100) / 100),
    pvKw: baseDecimated.indices.map((idx) => Math.round(((sortedMap.get("pv") ?? [])[idx] ?? 0) * 100) / 100),
    biomassKw: baseDecimated.indices.map((idx) => Math.round(((sortedMap.get("biomass") ?? [])[idx] ?? 0) * 100) / 100),
    stats,
  };
}

export interface DegradationSeriesData {
  years: string[];
  pvCapacityPct: number[];
  bessCapacityPct: number[] | null;
  events: Array<{ year: number; eventType: string; description: string }>;
  rows: Array<{
    year: number;
    pvPct: number;
    bessPct: number | null;
    eventsLabel: string;
  }>;
}

/**
 * Mengekstrak deret degradasi kapasitas PV dan BESS sepanjang umur proyek dari hasil backend.
 */
export function buildDegradationSeries(
  result: HybridSimulateResponse,
  config: HybridProjectConfig,
): DegradationSeriesData {
  const yearly = result.lifetime_summary.yearly ?? [];
  const nominalBess = config.components.bess.enabled ? config.components.bess.nominal_capacity_kwh : 0;
  const hasBess = Boolean(result.bess_summary) && nominalBess > 0;
  const eventsByYear = new Map<number, string[]>();

  for (const ev of result.lifetime_summary.lifecycle_events ?? []) {
    const arr = eventsByYear.get(ev.year) ?? [];
    arr.push(ev.event_type);
    eventsByYear.set(ev.year, arr);
  }

  const years = yearly.map((y) => `${y.year}`);
  const pvCapacityPct = yearly.map((y) => Math.round(y.pv_degradation_factor * 1000) / 10);
  const bessCapacityPct = hasBess
    ? yearly.map((y) =>
        y.bess_final_effective_capacity_kwh > 0
          ? Math.round((y.bess_final_effective_capacity_kwh / nominalBess) * 1000) / 10
          : 0,
      )
    : null;

  const rows = yearly.map((y, idx) => ({
    year: y.year,
    pvPct: pvCapacityPct[idx],
    bessPct: bessCapacityPct ? bessCapacityPct[idx] : null,
    eventsLabel: (eventsByYear.get(y.year) ?? []).join(", ") || "-",
  }));

  return {
    years,
    pvCapacityPct,
    bessCapacityPct,
    events: (result.lifetime_summary.lifecycle_events ?? []).map((ev) => ({
      year: ev.year,
      eventType: ev.event_type,
      description: ev.description,
    })),
    rows,
  };
}
