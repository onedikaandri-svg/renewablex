"use client";

import { useMemo, useRef, useState } from "react";
import EChart, { getChartThemeColors, type EChartsOption } from "@/components/hybrid/EChart";
import SystemSchematicSvg from "@/components/hybrid/SystemSchematicSvg";
import { translateDetailText, translateWarning } from "@/lib/errors-id";
import { downloadFile, formatCompactCurrency, formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import {
  buildDegradationSeries,
  buildDurationCurveSeries,
  buildSankeyEnergyData,
} from "@/lib/hybrid-charts";
import type { HybridProjectConfig, HybridSimulateResponse } from "@/lib/hybrid-types";
import { usePreferences } from "@/lib/preferences";

type DashboardTab = "overview" | "dispatch" | "heatmap" | "finance";
type HeatmapMetric = "load" | "pv" | "soc" | "unmet";

const DASHBOARD_TABS: DashboardTab[] = ["overview", "dispatch", "heatmap", "finance"];
const MONTH_NAMES_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTH_NAMES_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function HybridDashboard({
  config,
  result,
}: {
  config: HybridProjectConfig;
  result: HybridSimulateResponse;
}) {
  const { theme, lang } = usePreferences();
  const colors = useMemo(() => getChartThemeColors(theme), [theme]);
  const [activeTab, setActiveTab] = useState<DashboardTab>("overview");
  const [startDay, setStartDay] = useState(1);
  const [windowDays, setWindowDays] = useState<1 | 3 | 7>(3);
  const [heatmapMetric, setHeatmapMetric] = useState<HeatmapMetric>("load");
  const [inspectHourOffset, setInspectHourOffset] = useState(12);
  const tabRefs = useRef<Partial<Record<DashboardTab, HTMLButtonElement | null>>>({});

  function handleTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, current: DashboardTab) {
    const idx = DASHBOARD_TABS.indexOf(current);
    if (idx < 0) return;
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % DASHBOARD_TABS.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + DASHBOARD_TABS.length) % DASHBOARD_TABS.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = DASHBOARD_TABS.length - 1;
    if (nextIdx !== null) {
      e.preventDefault();
      const target = DASHBOARD_TABS[nextIdx];
      setActiveTab(target);
      tabRefs.current[target]?.focus();
    }
  }

  const fin = result.finance_summary;
  const em = result.emissions_summary;
  const curr = fin?.currency_code ?? config.project.currency_code;
  const monthLabels = lang === "en" ? MONTH_NAMES_EN : MONTH_NAMES_ID;

  const displayWarnings = useMemo(() => {
    if (result.warning_codes && result.warning_codes.length > 0) {
      return result.warning_codes.map((code) => translateWarning(code));
    }
    return result.warnings.map((msg) => translateDetailText(msg));
  }, [result.warning_codes, result.warnings]);

  // 1. Grafik Energi Bulanan Bertumpuk
  const monthlyOption = useMemo<EChartsOption>(() => {
    const pv = result.monthly.map((m) => Math.round(m.pv_generation_kwh / 1000));
    const bio = result.monthly.map((m) => Math.round(m.biomass_generation_kwh / 1000));
    const diesel = result.monthly.map((m) => Math.round((m.diesel_generation_kwh ?? 0) / 1000));
    const dis = result.monthly.map((m) => Math.round(m.bess_discharge_kwh / 1000));
    const imp = result.monthly.map((m) => Math.round(m.grid_import_kwh / 1000));
    const load = result.monthly.map((m) => Math.round(m.load_kwh / 1000));

    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: {
        top: 0,
        textStyle: { color: colors.text },
      },
      grid: { left: 48, right: 20, top: 44, bottom: 28 },
      xAxis: {
        type: "category",
        data: monthLabels,
        axisLabel: { color: colors.muted },
        axisLine: { lineStyle: { color: colors.border } },
      },
      yAxis: {
        type: "value",
        name: "MWh",
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      series: [
        { name: "PV", type: "bar", stack: "supply", color: colors.pv, data: pv },
        { name: "Biomass", type: "bar", stack: "supply", color: colors.biomass, data: bio },
        { name: "Diesel", type: "bar", stack: "supply", color: colors.diesel, data: diesel },
        { name: "BESS Discharge", type: "bar", stack: "supply", color: colors.bess, data: dis },
        { name: "Grid Import", type: "bar", stack: "supply", color: colors.grid, data: imp },
        {
          name: lang === "en" ? "Load" : "Beban",
          type: "line",
          color: colors.load,
          lineStyle: { width: 2.5, type: "dashed" },
          symbol: "circle",
          symbolSize: 5,
          data: load,
        },
      ],
    };
  }, [result.monthly, monthLabels, colors, lang]);

  // 2. Diagram Waterfall Rugi PV
  const waterfallOption = useMemo<EChartsOption>(() => {
    const losses = result.pv_loss_breakdown_kwh || {};
    const poa = losses.poa_nominal_kwh ?? result.summary.pv_generation_kwh;
    const steps: Array<{ key: string; label: string; value: number }> = [
      { key: "iam_loss_kwh", label: "IAM", value: losses.iam_loss_kwh ?? 0 },
      { key: "soiling_loss_kwh", label: "Soiling", value: losses.soiling_loss_kwh ?? 0 },
      { key: "snow_loss_kwh", label: "Salju", value: losses.snow_loss_kwh ?? 0 },
      { key: "temperature_loss_kwh", label: lang === "en" ? "Cell Temp" : "Suhu Sel", value: losses.temperature_loss_kwh ?? 0 },
      {
        key: "dc_system_loss_kwh",
        label: lang === "en" ? "DC Losses" : "Rugi DC",
        value:
          losses.dc_system_loss_kwh ??
          (losses.mismatch_loss_kwh ?? 0) +
            (losses.dc_wiring_loss_kwh ?? 0) +
            (losses.shading_loss_kwh ?? 0) +
            (losses.availability_loss_kwh ?? 0) +
            (losses.lid_loss_kwh ?? 0) +
            (losses.degradation_loss_kwh ?? 0),
      },
      { key: "inverter_loss_kwh", label: "Inverter", value: losses.inverter_loss_kwh ?? 0 },
      { key: "clipping_loss_kwh", label: "Clipping", value: losses.clipping_loss_kwh ?? 0 },
    ].filter((s) => s.value > 0.01 || s.key === "temperature_loss_kwh" || s.key === "inverter_loss_kwh");

    const categories: string[] = [lang === "en" ? "Nominal POA" : "POA Nominal"];
    const baseData: number[] = [0];
    const positiveData: Array<number | "-"> = [Math.round(poa / 1000)];
    const lossData: Array<number | "-"> = ["-"];

    let running = poa;
    for (const s of steps) {
      running = Math.max(running - s.value, 0);
      categories.push(s.label);
      baseData.push(Math.round(running / 1000));
      positiveData.push("-");
      lossData.push(Math.round(s.value / 1000));
    }

    categories.push(lang === "en" ? "Net PV AC" : "PV AC Bersih");
    baseData.push(0);
    positiveData.push(Math.round(result.summary.pv_generation_kwh / 1000));
    lossData.push("-");

    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 48, right: 20, top: 24, bottom: 36 },
      xAxis: {
        type: "category",
        data: categories,
        axisLabel: { color: colors.muted, interval: 0, rotate: 18 },
        axisLine: { lineStyle: { color: colors.border } },
      },
      yAxis: {
        type: "value",
        name: "MWh",
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      series: [
        {
          name: "Base",
          type: "bar",
          stack: "wf",
          itemStyle: { borderColor: "transparent", color: "transparent" },
          emphasis: { itemStyle: { borderColor: "transparent", color: "transparent" } },
          data: baseData,
        },
        {
          name: lang === "en" ? "Energy (MWh)" : "Energi (MWh)",
          type: "bar",
          stack: "wf",
          color: colors.pv,
          data: positiveData,
        },
        {
          name: lang === "en" ? "Loss (MWh)" : "Rugi (MWh)",
          type: "bar",
          stack: "wf",
          color: colors.unmet,
          data: lossData,
        },
      ],
    };
  }, [result.pv_loss_breakdown_kwh, result.summary.pv_generation_kwh, colors, lang]);

  // 3. Dispatch & SOC untuk jendela hari terpilih
  const hourly = result.hourly_year_1;
  const maxStartDay = Math.max(1, 366 - windowDays);
  const clampedStartDay = Math.min(startDay, maxStartDay);
  const startStep = (clampedStartDay - 1) * 24;
  const endStep = Math.min(startStep + windowDays * 24, hourly?.steps_count ?? 8760);

  const dispatchOption = useMemo<EChartsOption>(() => {
    if (!hourly) return {};
    const labels = hourly.local_time.slice(startStep, endStep);
    const pv = hourly.pv_generation_kw.slice(startStep, endStep);
    const bio = hourly.biomass_generation_kw.slice(startStep, endStep);
    const diesel = (hourly.diesel_generation_kw ?? new Array(hourly.steps_count).fill(0)).slice(startStep, endStep);
    const dis = hourly.bess_discharge_kw.slice(startStep, endStep);
    const imp = hourly.grid_import_kw.slice(startStep, endStep);
    const unmet = hourly.unmet_load_kw.slice(startStep, endStep);
    const load = hourly.load_kw.slice(startStep, endStep);

    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: colors.text } },
      grid: { left: 50, right: 20, top: 44, bottom: 52 },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 20, bottom: 6 }],
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: colors.muted },
        axisLine: { lineStyle: { color: colors.border } },
      },
      yAxis: {
        type: "value",
        name: "kW",
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      series: [
        { name: "PV", type: "line", stack: "gen", areaStyle: { opacity: 0.7 }, symbol: "none", color: colors.pv, data: pv },
        { name: "Biomass", type: "line", stack: "gen", areaStyle: { opacity: 0.7 }, symbol: "none", color: colors.biomass, data: bio },
        { name: "Diesel", type: "line", stack: "gen", areaStyle: { opacity: 0.7 }, symbol: "none", color: colors.diesel, data: diesel },
        { name: "BESS Discharge", type: "line", stack: "gen", areaStyle: { opacity: 0.65 }, symbol: "none", color: colors.bess, data: dis },
        { name: "Grid Import", type: "line", stack: "gen", areaStyle: { opacity: 0.55 }, symbol: "none", color: colors.grid, data: imp },
        { name: "Unmet Load", type: "line", stack: "gen", areaStyle: { opacity: 0.5 }, symbol: "none", color: colors.unmet, data: unmet },
        {
          name: lang === "en" ? "Load" : "Beban",
          type: "line",
          symbol: "none",
          color: colors.load,
          lineStyle: { width: 2, type: "dashed" },
          data: load,
        },
      ],
    };
  }, [hourly, startStep, endStep, colors, lang]);

  const socOption = useMemo<EChartsOption>(() => {
    if (!hourly || !hourly.bess_soc_fraction) return {};
    const labels = hourly.local_time.slice(startStep, endStep);
    const socPct = hourly.bess_soc_fraction.slice(startStep, endStep).map((v) => Math.round(v * 1000) / 10);
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 50, right: 20, top: 24, bottom: 32 },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { color: colors.muted },
        axisLine: { lineStyle: { color: colors.border } },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        name: "SOC (%)",
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      series: [
        {
          name: "SOC (%)",
          type: "line",
          symbol: "none",
          color: colors.bess,
          areaStyle: { opacity: 0.2 },
          data: socPct,
        },
      ],
    };
  }, [hourly, startStep, endStep, colors]);

  // 4. Peta Panas 8.760 Jam (Hari 1..365 x Jam 0..23)
  const heatmapData = useMemo(() => {
    if (!hourly) return { points: [] as Array<[number, number, number]>, min: 0, max: 1, avg: 0, unit: "kW" };
    let source: number[];
    let scale = 1;
    let unit = "kW";
    if (heatmapMetric === "pv") {
      source = hourly.pv_generation_kw;
    } else if (heatmapMetric === "soc" && hourly.bess_soc_fraction) {
      source = hourly.bess_soc_fraction;
      scale = 100;
      unit = "%";
    } else if (heatmapMetric === "unmet") {
      source = hourly.unmet_load_kw;
    } else {
      source = hourly.load_kw;
    }

    const points: Array<[number, number, number]> = [];
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    const len = Math.min(source.length, 8760);
    for (let i = 0; i < len; i++) {
      const dayIdx = Math.floor(i / 24);
      const hrIdx = i % 24;
      const val = Math.round(source[i] * scale * 100) / 100;
      points.push([dayIdx, hrIdx, val]);
      if (val < min) min = val;
      if (val > max) max = val;
      sum += val;
    }
    return {
      points,
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) && max > min ? max : (min || 0) + 1,
      avg: len > 0 ? sum / len : 0,
      unit,
    };
  }, [hourly, heatmapMetric]);

  const heatmapOption = useMemo<EChartsOption>(() => {
    const days = Array.from({ length: 365 }, (_, i) => `${i + 1}`);
    const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
    const palette =
      heatmapMetric === "unmet"
        ? ["#F8FAFC", "#FDE68A", "#F97316", "#B42318"]
        : heatmapMetric === "soc"
          ? ["#E0F2FE", "#38BDF8", "#0284C7", "#0369A1"]
          : ["#F1F5F9", "#B9B9F9", "#8E5CFF", "#533AFD"];

    return {
      tooltip: {
        position: "top",
        formatter: (params: unknown) => {
          const p = params as { value: [number, number, number] };
          return `${lang === "en" ? "Day" : "Hari"} ${p.value[0] + 1}, ${String(p.value[1]).padStart(2, "0")}:00<br/><b>${formatNumber(p.value[2], lang, 2)} ${heatmapData.unit}</b>`;
        },
      },
      grid: { left: 48, right: 20, top: 18, bottom: 56 },
      xAxis: {
        type: "category",
        data: days,
        name: lang === "en" ? "Day of Year" : "Hari ke-",
        nameLocation: "middle",
        nameGap: 26,
        axisLabel: { color: colors.muted, interval: 29 },
      },
      yAxis: {
        type: "category",
        data: hours,
        axisLabel: { color: colors.muted, interval: 3 },
      },
      visualMap: {
        min: heatmapData.min,
        max: heatmapData.max,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        textStyle: { color: colors.muted },
        inRange: { color: palette },
      },
      series: [
        {
          type: "heatmap",
          data: heatmapData.points,
          animation: false,
          progressive: 2000,
        },
      ],
    };
  }, [heatmapData, heatmapMetric, colors, lang]);

  // 4b. Diagram Aliran Energi (Sankey Tahun 1)
  const sankeyData = useMemo(() => buildSankeyEnergyData(result, lang), [result, lang]);
  const sankeyOption = useMemo<EChartsOption>(() => {
    if (sankeyData.links.length === 0) return {};
    const nodeColorMap: Record<string, string> = {
      "Solar PV": colors.pv,
      Biomass: colors.biomass,
      "Diesel Generator": colors.diesel,
      "Impor Grid": colors.grid,
      "Grid Import": colors.grid,
      "Penyimpanan BESS": colors.bess,
      "BESS Storage": colors.bess,
      "Beban Terpenuhi": colors.load,
      "Served Load": colors.load,
      Curtailment: colors.unmet,
      "Rugi Konversi BESS": colors.muted,
      "BESS Losses": colors.muted,
      "Beban Parasitik": colors.muted,
      "Aux & Parasitic": colors.muted,
      "Ekspor Grid": colors.grid,
      "Grid Export": colors.grid,
      "Bus Pasokan AC": colors.accent,
      "Supply Bus": colors.accent,
      "Distribusi AC": colors.accent,
      "AC Distribution": colors.accent,
    };
    return {
      tooltip: {
        trigger: "item",
        triggerOn: "mousemove",
        formatter: (params: unknown) => {
          const p = params as { dataType?: string; name?: string; value?: number; data?: { source?: string; target?: string; value?: number } };
          if (p.dataType === "edge" && p.data) {
            return `${p.data.source} -> ${p.data.target}<br/><b>${formatNumber(p.data.value ?? 0, lang, 2)} MWh/thn</b>`;
          }
          return `${p.name ?? ""}: <b>${formatNumber(p.value ?? 0, lang, 2)} MWh/thn</b>`;
        },
      },
      series: [
        {
          type: "sankey",
          left: 16,
          right: 120,
          top: 16,
          bottom: 16,
          nodeAlign: "justify",
          emphasis: { focus: "adjacency" },
          lineStyle: { color: "gradient", curveness: 0.45, opacity: 0.45 },
          label: { color: colors.text, fontSize: 11 },
          data: sankeyData.nodes.map((n) => ({
            name: n.name,
            itemStyle: { color: nodeColorMap[n.name] ?? colors.accent },
          })),
          links: sankeyData.links,
        },
      ],
    };
  }, [sankeyData, colors, lang]);

  // 4c. Kurva Durasi Beban & Pembangkitan (Tahun 1, decimated untuk tampilan mulus)
  const durationData = useMemo(() => (hourly ? buildDurationCurveSeries(hourly, 240) : null), [hourly]);
  const durationOption = useMemo<EChartsOption>(() => {
    if (!durationData) return {};
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: colors.text } },
      grid: { left: 52, right: 20, top: 44, bottom: 38 },
      xAxis: {
        type: "category",
        data: durationData.percentLabels,
        name: lang === "en" ? "Time Exceeded (%)" : "Durasi Terlampaui (% jam/thn)",
        nameLocation: "middle",
        nameGap: 24,
        axisLabel: { color: colors.muted, interval: Math.max(1, Math.floor(durationData.percentLabels.length / 6)) },
        axisLine: { lineStyle: { color: colors.border } },
      },
      yAxis: {
        type: "value",
        name: "kW",
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      series: [
        {
          name: lang === "en" ? "Load (kW)" : "Beban (kW)",
          type: "line",
          symbol: "none",
          color: colors.load,
          lineStyle: { width: 2, type: "dashed" },
          data: durationData.loadKw,
        },
        {
          name: lang === "en" ? "Served Load (kW)" : "Beban Terpenuhi (kW)",
          type: "line",
          symbol: "none",
          color: colors.grid,
          lineStyle: { width: 2 },
          data: durationData.servedKw,
        },
        {
          name: "PV (kW)",
          type: "line",
          symbol: "none",
          color: colors.pv,
          lineStyle: { width: 2 },
          data: durationData.pvKw,
        },
        ...(durationData.biomassKw.some((v) => v > 0)
          ? [
              {
                name: "Biomass (kW)",
                type: "line" as const,
                symbol: "none",
                color: colors.biomass,
                lineStyle: { width: 2 },
                data: durationData.biomassKw,
              },
            ]
          : []),
        ...(durationData.dieselKw.some((v) => v > 0)
          ? [
              {
                name: "Diesel (kW)",
                type: "line" as const,
                symbol: "none",
                color: colors.diesel,
                lineStyle: { width: 2 },
                data: durationData.dieselKw,
              },
            ]
          : []),
      ],
    };
  }, [durationData, colors, lang]);

  // 4d. Grafik Degradasi Kapasitas PV & BESS Sepanjang Umur Proyek
  const degradationData = useMemo(() => buildDegradationSeries(result, config), [result, config]);
  const degradationOption = useMemo<EChartsOption>(() => {
    if (degradationData.years.length === 0) return {};
    const eventLines = degradationData.events.map((ev) => ({
      xAxis: `${ev.year}`,
      name: ev.eventType,
    }));
    const minPv = Math.min(...degradationData.pvCapacityPct, 75);
    const minBess = degradationData.bessCapacityPct ? Math.min(...degradationData.bessCapacityPct, 75) : 75;
    const yMin = Math.max(0, Math.floor(Math.min(minPv, minBess) / 5) * 5 - 5);

    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: colors.text } },
      grid: { left: 52, right: 20, top: 44, bottom: 32 },
      xAxis: {
        type: "category",
        data: degradationData.years,
        name: lang === "en" ? "Year" : "Tahun",
        axisLabel: { color: colors.muted },
        axisLine: { lineStyle: { color: colors.border } },
      },
      yAxis: {
        type: "value",
        min: yMin,
        max: 102,
        name: "%",
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      series: [
        {
          name: lang === "en" ? "PV Capacity Factor (%)" : "Kapasitas Efektif PV (%)",
          type: "line",
          color: colors.pv,
          lineStyle: { width: 2.5 },
          symbol: "circle",
          symbolSize: 5,
          data: degradationData.pvCapacityPct,
          markLine:
            eventLines.length > 0
              ? {
                  symbol: ["none", "none"],
                  silent: true,
                  label: { formatter: "{b}", color: colors.muted, fontSize: 10 },
                  lineStyle: { color: colors.biomass, type: "dashed" },
                  data: eventLines,
                }
              : undefined,
        },
        ...(degradationData.bessCapacityPct
          ? [
              {
                name: lang === "en" ? "BESS Effective Capacity (%)" : "Kapasitas Efektif BESS (%)",
                type: "line" as const,
                color: colors.bess,
                lineStyle: { width: 2.5 },
                symbol: "triangle",
                symbolSize: 6,
                data: degradationData.bessCapacityPct,
              },
            ]
          : []),
      ],
    };
  }, [degradationData, colors, lang]);

  // 5. Arus Kas Tahunan + Kumulatif & Rincian LCOE
  const cashflowOption = useMemo<EChartsOption>(() => {
    const years = result.cashflow_schedule.map((r) => `${r.year}`);
    const net = result.cashflow_schedule.map((r) => Math.round(r.net_cash_flow / 1e6));
    const cum = result.cashflow_schedule.map((r) => Math.round(r.cumulative_cash_flow / 1e6));
    const unitScale = "Juta " + curr;

    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: colors.text } },
      grid: { left: 60, right: 20, top: 40, bottom: 32 },
      xAxis: {
        type: "category",
        data: years,
        axisLabel: { color: colors.muted },
        axisLine: { lineStyle: { color: colors.border } },
      },
      yAxis: {
        type: "value",
        name: unitScale,
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      series: [
        {
          name: lang === "en" ? "Annual Net Cash Flow" : "Arus Kas Bersih Tahunan",
          type: "bar",
          color: colors.bess,
          data: net,
        },
        {
          name: lang === "en" ? "Cumulative Cash Flow" : "Arus Kas Kumulatif",
          type: "line",
          color: colors.pv,
          lineStyle: { width: 2.5 },
          markLine: { silent: true, symbol: "none", data: [{ yAxis: 0 }], lineStyle: { color: colors.muted, type: "dashed" } },
          data: cum,
        },
      ],
    };
  }, [result.cashflow_schedule, curr, colors, lang]);

  const lcoeOption = useMemo<EChartsOption>(() => {
    if (!result.lcoe_breakdown) return {};
    const rawEntries: Array<[string, number]> = [
      ["CAPEX PV", result.lcoe_breakdown.capex_pv ?? 0],
      ["CAPEX BESS", result.lcoe_breakdown.capex_bess ?? 0],
      ["CAPEX Biomass", result.lcoe_breakdown.capex_biomass ?? 0],
      ["CAPEX Diesel", result.lcoe_breakdown.capex_diesel ?? 0],
      ["CAPEX BOS", result.lcoe_breakdown.capex_bos ?? 0],
      ["O&M", result.lcoe_breakdown.om ?? 0],
      [lang === "en" ? "Fuel & Logistics" : "Bahan Bakar", result.lcoe_breakdown.fuel_and_logistics ?? 0],
      [lang === "en" ? "Replacement" : "Penggantian", result.lcoe_breakdown.replacement_and_overhaul ?? 0],
      ["Grid Import", result.lcoe_breakdown.grid_import ?? 0],
      [lang === "en" ? "Tax Net" : "Pajak Neto", result.lcoe_breakdown.tax_net_credit ?? 0],
      [lang === "en" ? "Salvage Credit" : "Kredit Nilai Sisa", result.lcoe_breakdown.salvage_credit ?? 0],
      [lang === "en" ? "Export Credit" : "Kredit Ekspor", result.lcoe_breakdown.export_credit ?? 0],
    ];
    const entries = rawEntries.filter(([, val]) => Math.abs(val) > 0.001);

    return {
      tooltip: { trigger: "axis" },
      grid: { left: 130, right: 24, top: 16, bottom: 28 },
      xAxis: {
        type: "value",
        name: `${curr}/kWh`,
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      yAxis: {
        type: "category",
        data: entries.map(([name]) => name),
        axisLabel: { color: colors.text },
      },
      series: [
        {
          type: "bar",
          data: entries.map(([, val]) => ({
            value: Math.round(val * 100) / 100,
            itemStyle: { color: val >= 0 ? colors.pv : colors.grid },
          })),
        },
      ],
    };
  }, [result.lcoe_breakdown, curr, colors, lang]);

  function handleExportJson() {
    downloadFile(
      `${config.project.project_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-hybrid-result.json`,
      JSON.stringify(result, null, 2),
      "application/json",
    );
  }

  function handleExportCashflowCsv() {
    const header = [
      "year",
      "served_load_kwh",
      "pv_generation_kwh",
      "biomass_generation_kwh",
      "diesel_generation_kwh",
      "capex_outflow",
      "gross_revenue_or_savings",
      "om_cost",
      "fuel_and_logistics_cost",
      "replacement_and_overhaul_cost",
      "salvage_inflow",
      "tax_outflow",
      "net_cash_flow",
      "cumulative_cash_flow",
    ];
    const rows = result.cashflow_schedule.map((r) =>
      [
        r.year,
        r.served_load_kwh,
        r.pv_generation_kwh,
        r.biomass_generation_kwh,
        r.diesel_generation_kwh ?? 0,
        r.capex_outflow,
        r.gross_revenue_or_savings,
        r.om_cost,
        r.fuel_and_logistics_cost,
        r.replacement_and_overhaul_cost,
        r.salvage_inflow,
        r.tax_outflow,
        r.net_cash_flow,
        r.cumulative_cash_flow,
      ].join(","),
    );
    downloadFile("cashflow_schedule.csv", [header.join(","), ...rows].join("\n"), "text/csv;charset=utf-8");
  }

  function handleExportHourlyCsv() {
    if (!hourly) return;
    const header = [
      "local_time",
      "load_kw",
      "pv_generation_kw",
      "biomass_generation_kw",
      "diesel_generation_kw",
      "diesel_fuel_liters",
      "bess_charge_kw",
      "bess_discharge_kw",
      "grid_import_kw",
      "grid_export_kw",
      "served_load_kw",
      "unmet_load_kw",
      "curtailment_kw",
      "bess_soc_fraction",
    ];
    const lines = [header.join(",")];
    for (let i = 0; i < hourly.steps_count; i++) {
      lines.push(
        [
          hourly.local_time[i],
          hourly.load_kw[i],
          hourly.pv_generation_kw[i],
          hourly.biomass_generation_kw[i],
          hourly.diesel_generation_kw?.[i] ?? 0,
          hourly.diesel_fuel_liters?.[i] ?? 0,
          hourly.bess_charge_kw[i],
          hourly.bess_discharge_kw[i],
          hourly.grid_import_kw[i],
          hourly.grid_export_kw[i],
          hourly.served_load_kw[i],
          hourly.unmet_load_kw[i],
          hourly.curtailment_kw[i],
          hourly.bess_soc_fraction ? hourly.bess_soc_fraction[i] : "",
        ].join(","),
      );
    }
    downloadFile("hourly_year_1.csv", lines.join("\n"), "text/csv;charset=utf-8");
  }

  const totalRow = useMemo(() => {
    return result.cashflow_schedule.reduce(
      (acc, r) => ({
        served: acc.served + r.served_load_kwh,
        rev: acc.rev + r.gross_revenue_or_savings + r.export_revenue,
        opex: acc.opex + r.om_cost + r.fuel_and_logistics_cost + r.grid_import_cost,
        repl: acc.repl + r.replacement_and_overhaul_cost,
        net: acc.net + r.net_cash_flow,
      }),
      { served: 0, rev: 0, opex: 0, repl: 0, net: 0 },
    );
  }, [result.cashflow_schedule]);

  const inspectStepIdx = Math.min(startStep + inspectHourOffset, (hourly?.steps_count ?? 1) - 1);

  return (
    <>
      {displayWarnings.length > 0 && (
        <div className="warn" role="note">
          <h3>{lang === "en" ? "Simulation Notes" : "Catatan Simulasi"}</h3>
          <ul>{displayWarnings.map((w, idx) => <li key={idx}>{w}</li>)}</ul>
        </div>
      )}

      {/* Strip KPI Utama */}
      <div className="kpis">
        <div className="kpi">
          <span>NPV ({fin ? `${fin.project_lifetime_years} thn` : "-"})</span>
          <b className={fin && fin.npv >= 0 ? "pos" : "neg"}>
            {fin ? formatCompactCurrency(fin.npv, curr, lang) : "Belum dihitung"}
          </b>
          <span>{fin ? `WACC ${formatPercent(fin.discount_rate, lang, 1)}` : ""}</span>
        </div>

        <div className="kpi">
          <span>{lang === "en" ? "Project IRR" : "IRR Proyek"}</span>
          <b className="accent">
            {fin && fin.irr !== null ? formatPercent(fin.irr, lang, 2) : (lang === "en" ? "N/A" : "Tidak tersedia")}
          </b>
          <span>{fin ? fin.irr_status : ""}</span>
        </div>

        <div className="kpi">
          <span>LCOE</span>
          <b>{fin ? `${formatCurrency(fin.lcoe, curr, lang, 0)}/kWh` : "-"}</b>
          <span>NPC: {fin ? formatCompactCurrency(fin.total_npc, curr, lang) : "-"}</span>
        </div>

        <div className="kpi">
          <span>{lang === "en" ? "Simple / Disc. Payback" : "Payback Sederhana / Terdiskonto"}</span>
          <b>
            {fin && fin.simple_payback_years !== null ? `${formatNumber(fin.simple_payback_years, lang, 1)} thn` : "Belum kembali"}
          </b>
          <span>
            {fin && fin.discounted_payback_years !== null
              ? `Terdiskonto: ${formatNumber(fin.discounted_payback_years, lang, 1)} thn`
              : "Terdiskonto: belum kembali"}
          </span>
        </div>

        <div className="kpi">
          <span>{lang === "en" ? "Renewable Fraction" : "Pangsa Terbarukan"}</span>
          <b className="pos">{formatPercent(result.summary.renewable_fraction, lang, 1)}</b>
          <span>
            Unmet: {formatNumber(result.summary.unmet_load_kwh / 1000, lang, 1)} MWh/thn
          </span>
        </div>

        <div className="kpi">
          <span>{lang === "en" ? "Avoided Emissions" : "Emisi Dihindari"}</span>
          <b className="pos">
            {em ? `${formatNumber(em.avoided_emissions_tons_co2e, lang, 0)} ton CO2e` : "-"}
          </b>
          <span>{em ? `Baseline grid ${em.grid_emission_factor_kg_co2e_per_kwh} kg/kWh` : ""}</span>
        </div>
      </div>

      {/* Tab Navigasi Hasil */}
      <div className="sec">
        <div className="tabs" role="tablist" aria-label={lang === "en" ? "Dashboard sections" : "Bagian dasbor hasil"}>
          <button
            ref={(el) => { tabRefs.current.overview = el; }}
            type="button"
            role="tab"
            id="tab-overview"
            tabIndex={activeTab === "overview" ? 0 : -1}
            aria-selected={activeTab === "overview"}
            aria-controls="panel-overview"
            className="tab-btn"
            onClick={() => setActiveTab("overview")}
            onKeyDown={(e) => handleTabKeyDown(e, "overview")}
          >
            {lang === "en" ? "Overview & Monthly" : "Ringkasan & Bulanan"}
          </button>
          <button
            ref={(el) => { tabRefs.current.dispatch = el; }}
            type="button"
            role="tab"
            id="tab-dispatch"
            tabIndex={activeTab === "dispatch" ? 0 : -1}
            aria-selected={activeTab === "dispatch"}
            aria-controls="panel-dispatch"
            className="tab-btn"
            onClick={() => setActiveTab("dispatch")}
            onKeyDown={(e) => handleTabKeyDown(e, "dispatch")}
          >
            {lang === "en" ? "Dispatch & SOC" : "Dispatch & SOC"}
          </button>
          <button
            ref={(el) => { tabRefs.current.heatmap = el; }}
            type="button"
            role="tab"
            id="tab-heatmap"
            tabIndex={activeTab === "heatmap" ? 0 : -1}
            aria-selected={activeTab === "heatmap"}
            aria-controls="panel-heatmap"
            className="tab-btn"
            onClick={() => setActiveTab("heatmap")}
            onKeyDown={(e) => handleTabKeyDown(e, "heatmap")}
          >
            {lang === "en" ? "8760h Heatmaps" : "Peta Panas 8.760 Jam"}
          </button>
          <button
            ref={(el) => { tabRefs.current.finance = el; }}
            type="button"
            role="tab"
            id="tab-finance"
            tabIndex={activeTab === "finance" ? 0 : -1}
            aria-selected={activeTab === "finance"}
            aria-controls="panel-finance"
            className="tab-btn"
            onClick={() => setActiveTab("finance")}
            onKeyDown={(e) => handleTabKeyDown(e, "finance")}
          >
            {lang === "en" ? "Finance & Cash Flow" : "Keuangan & Arus Kas"}
          </button>
        </div>

        {/* Panel 1: Ringkasan & Bulanan */}
        {activeTab === "overview" && (
          <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
            <div className="grid-2">
              <div className="chart-card">
                <div className="chart-head">
                  <h3>{lang === "en" ? "Monthly Energy Supply vs Load" : "Energi Bulanan per Sumber vs Beban"}</h3>
                  <span className="chip">MWh / {lang === "en" ? "mo" : "bulan"}</span>
                </div>
                <EChart
                  option={monthlyOption}
                  height={320}
                  ariaLabel="Grafik batang bertumpuk energi bulanan PV, Biomass, BESS, dan Grid terhadap beban."
                />
                <details className="more">
                  <summary>{lang === "en" ? "Monthly energy table (accessible alternative)" : "Tabel energi bulanan (alternatif teks)"}</summary>
                  <div className="tw" tabIndex={0} role="region" aria-label="Tabel ringkasan energi bulanan">
                    <table className="sens-main">
                      <caption>Energi bulanan Tahun 1 (MWh)</caption>
                      <thead>
                        <tr>
                          <th scope="col">Bulan</th>
                          <th scope="col">Beban</th>
                          <th scope="col">PV</th>
                          <th scope="col">Biomass</th>
                          <th scope="col">Diesel</th>
                          <th scope="col">BESS Dis.</th>
                          <th scope="col">Grid Imp.</th>
                          <th scope="col">Unmet</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.monthly.map((m) => (
                          <tr key={m.month}>
                            <th scope="row">{monthLabels[m.month - 1] ?? m.month}</th>
                            <td>{formatNumber(m.load_kwh / 1000, lang, 1)}</td>
                            <td>{formatNumber(m.pv_generation_kwh / 1000, lang, 1)}</td>
                            <td>{formatNumber(m.biomass_generation_kwh / 1000, lang, 1)}</td>
                            <td>{formatNumber((m.diesel_generation_kwh ?? 0) / 1000, lang, 1)}</td>
                            <td>{formatNumber(m.bess_discharge_kwh / 1000, lang, 1)}</td>
                            <td>{formatNumber(m.grid_import_kwh / 1000, lang, 1)}</td>
                            <td>{formatNumber(m.unmet_load_kwh / 1000, lang, 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>

              <div className="chart-card">
                <div className="chart-head">
                  <h3>{lang === "en" ? "PV Loss Waterfall (Year 1)" : "Diagram Rugi PV (Waterfall Tahun 1)"}</h3>
                  <span className="chip">MWh</span>
                </div>
                <EChart
                  option={waterfallOption}
                  height={320}
                  ariaLabel="Diagram waterfall rugi PV dari irradiansi POA nominal hingga keluaran AC bersih."
                />
                <details className="more">
                  <summary>{lang === "en" ? "PV loss breakdown table" : "Tabel rincian rugi PV (alternatif teks)"}</summary>
                  <div className="tw tw-auto" tabIndex={0} role="region" aria-label="Tabel rincian rugi PV">
                    <table className="sens-main">
                      <caption>Rincian konversi energi PV Tahun 1 (MWh)</caption>
                      <thead>
                        <tr>
                          <th scope="col">Tahap</th>
                          <th scope="col">Energi (MWh)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(result.pv_loss_breakdown_kwh || {}).map(([k, v]) => (
                          <tr key={k}>
                            <th scope="row">{k}</th>
                            <td>{formatNumber(v / 1000, lang, 2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            </div>

            <div className="sec chart-card">
              <div className="chart-head">
                <h3>{lang === "en" ? "Annual Energy Flow Diagram (Sankey, Year 1)" : "Diagram Aliran Energi Tahunan (Sankey Tahun 1)"}</h3>
                <span className="chip">{lang === "en" ? "MWh/yr" : "MWh/thn"}</span>
              </div>
              {sankeyData.links.length === 0 ? (
                <div className="state">
                  <p>{lang === "en" ? "No energy flow data available." : "Belum ada data aliran energi untuk ditampilkan."}</p>
                </div>
              ) : (
                <>
                  <EChart
                    option={sankeyOption}
                    height={300}
                    ariaLabel="Diagram Sankey aliran energi Tahun 1 dari pembangkit menuju BESS, beban terpenuhi, ekspor, dan rugi konversi."
                  />
                  <details className="more">
                    <summary>{lang === "en" ? "Energy flow table (accessible alternative)" : "Tabel aliran energi Sankey (alternatif teks)"}</summary>
                    <div className="tw tw-auto" tabIndex={0} role="region" aria-label="Tabel aliran energi Sankey">
                      <table className="sens-main">
                        <caption>Aliran energi tahunan antar simpul sistem (MWh/thn)</caption>
                        <thead>
                          <tr>
                            <th scope="col">Dari</th>
                            <th scope="col">Menuju</th>
                            <th scope="col">Energi (MWh/thn)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sankeyData.rows.map((r, i) => (
                            <tr key={`${r.source}-${r.target}-${i}`}>
                              <th scope="row">{r.source}</th>
                              <td>{r.target}</td>
                              <td>{formatNumber(r.mwh, lang, 2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </>
              )}
            </div>

            <div className="sec grid-2">
              <SystemSchematicSvg config={config} result={result} />

              <div className="card">
                <div className="card-header">
                  <h3>{lang === "en" ? "Technical & Component Summary (Year 1)" : "Ringkasan Teknis & Komponen (Tahun 1)"}</h3>
                  <span className="chip">{result.lifetime_summary.multi_year_mode}</span>
                </div>
                <div className="grid-2">
                  <div>
                    <p className="note"><strong>Total Beban:</strong> <span className="tabular-nums">{formatNumber(result.summary.total_load_kwh / 1000, lang, 1)} MWh</span></p>
                    <p className="note"><strong>Produksi PV:</strong> <span className="tabular-nums">{formatNumber(result.summary.pv_generation_kwh / 1000, lang, 1)} MWh</span></p>
                    <p className="note"><strong>Yield Spesifik PV:</strong> <span className="tabular-nums">{formatNumber(result.summary.pv_specific_yield_kwh_per_kwp, lang, 0)} kWh/kWp</span></p>
                    <p className="note"><strong>Curtailment:</strong> <span className="tabular-nums">{formatNumber(result.summary.curtailment_kwh / 1000, lang, 1)} MWh</span></p>
                    <p className="note"><strong>Galat Neraca Maks:</strong> <span className="tabular-nums">{result.summary.max_balance_error_kw.toExponential(2)} kW</span></p>
                  </div>
                  <div>
                    {result.bess_summary ? (
                      <>
                        <p className="note"><strong>BESS Charge / Discharge:</strong> <span className="tabular-nums">{formatNumber(result.bess_summary.total_charge_kwh / 1000, lang, 1)} / {formatNumber(result.bess_summary.total_discharge_kwh / 1000, lang, 1)} MWh</span></p>
                        <p className="note"><strong>Siklus BESS (EFC):</strong> <span className="tabular-nums">{formatNumber(result.bess_summary.equivalent_full_cycles, lang, 1)} siklus</span></p>
                      </>
                    ) : (
                      <p className="note"><strong>BESS:</strong> Tidak diaktifkan</p>
                    )}
                    {result.biomass_summary ? (
                      <>
                        <p className="note"><strong>Produksi Biomass:</strong> <span className="tabular-nums">{formatNumber(result.biomass_summary.total_generation_kwh / 1000, lang, 1)} MWh</span></p>
                        <p className="note"><strong>Jam Operasi / Start:</strong> <span className="tabular-nums">{formatNumber(result.biomass_summary.total_operating_hours, lang, 0)} jam / {result.biomass_summary.startup_count}x</span></p>
                        <p className="note"><strong>Konsumsi Bahan Bakar:</strong> <span className="tabular-nums">{formatNumber(result.biomass_summary.total_fuel_tons, lang, 1)} ton</span></p>
                      </>
                    ) : (
                      <p className="note"><strong>Biomass:</strong> Tidak diaktifkan</p>
                    )}
                    {result.diesel_summary ? (
                      <>
                        <p className="note"><strong>Produksi Diesel (Non-Terbarukan):</strong> <span className="tabular-nums">{formatNumber(result.diesel_summary.total_generation_kwh / 1000, lang, 1)} MWh</span></p>
                        <p className="note"><strong>Jam Operasi / Start Diesel:</strong> <span className="tabular-nums">{formatNumber(result.diesel_summary.total_operating_hours, lang, 0)} jam / {result.diesel_summary.startup_count}x</span></p>
                        <p className="note"><strong>Konsumsi Solar / Emisi:</strong> <span className="tabular-nums">{formatNumber(result.diesel_summary.total_fuel_liters, lang, 0)} L / {formatNumber(result.diesel_summary.total_co2e_kg / 1000, lang, 1)} tCO2e</span></p>
                      </>
                    ) : (
                      <p className="note"><strong>Diesel Generator:</strong> Tidak diaktifkan</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Panel 2: Dispatch & SOC */}
        {activeTab === "dispatch" && (
          <div id="panel-dispatch" role="tabpanel" aria-labelledby="tab-dispatch">
            {!hourly ? (
              <div className="state">
                <h3>Data deret waktu per jam tidak tersedia</h3>
                <p>Jalankan simulasi ulang dari Halaman 7 agar data dispatch 8.760 jam tersimpan.</p>
              </div>
            ) : (
              <>
                <div className="card">
                  <div className="grid-2">
                    <div className="fld" style={{ marginTop: 0 }}>
                      <div className="label-row">
                        <label htmlFor="dispatch-day">Pilih Hari Awal</label>
                        <span className="unit tabular-nums">Hari {clampedStartDay} dari 365</span>
                      </div>
                      <input
                        id="dispatch-day"
                        type="range"
                        className="range-slider"
                        min={1}
                        max={maxStartDay}
                        value={clampedStartDay}
                        onChange={(e) => setStartDay(Number(e.target.value))}
                      />
                    </div>
                    <div className="fld" style={{ marginTop: 0 }}>
                      <label>Rentang Tampilan</label>
                      <div className="actions-inline">
                        {([1, 3, 7] as const).map((d) => (
                          <button
                            key={d}
                            type="button"
                            className={`btn btn-sm ${windowDays === d ? "primary" : "ghost"}`}
                            onClick={() => setWindowDays(d)}
                          >
                            {d === 1 ? "24 Jam" : `${d} Hari`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="sec chart-card">
                  <div className="chart-head">
                    <h3>{lang === "en" ? "Hourly Dispatch Stack" : "Dispatch Daya Per Jam"}</h3>
                    <span className="chip">{hourly.local_time[startStep]} sampai {hourly.local_time[endStep - 1]}</span>
                  </div>
                  <EChart
                    option={dispatchOption}
                    height={330}
                    ariaLabel="Grafik area bertumpuk dispatch pembangkit, baterai, dan beban per jam."
                  />
                </div>

                {hourly.bess_soc_fraction && (
                  <div className="sec chart-card">
                    <div className="chart-head">
                      <h3>{lang === "en" ? "Battery State of Charge (SOC)" : "Kurva State of Charge (SOC) Baterai"}</h3>
                      <span className="chip">% kapasitas efektif</span>
                    </div>
                    <EChart
                      option={socOption}
                      height={220}
                      ariaLabel="Grafik kurva State of Charge baterai dalam persen pada rentang hari terpilih."
                    />
                  </div>
                )}

                {hourly.trace_reason && (
                  <div className="sec card">
                    <div className="card-header">
                      <h3>Inspeksi Jejak Keputusan EMS</h3>
                      <span className="chip">{hourly.local_time[inspectStepIdx]}</span>
                    </div>
                    <div className="fld" style={{ marginTop: 0 }}>
                      <div className="label-row">
                        <label htmlFor="inspect-hour">Geser Jam Inspeksi pada Jendela Terpilih</label>
                        <span className="unit tabular-nums">Langkah #{inspectStepIdx}</span>
                      </div>
                      <input
                        id="inspect-hour"
                        type="range"
                        className="range-slider"
                        min={0}
                        max={Math.max(0, endStep - startStep - 1)}
                        value={Math.min(inspectHourOffset, Math.max(0, endStep - startStep - 1))}
                        onChange={(e) => setInspectHourOffset(Number(e.target.value))}
                      />
                    </div>
                    <p className="note sec">
                      <strong>Alasan EMS:</strong> <code>{hourly.trace_reason[inspectStepIdx]}</code>
                    </p>
                    <p className="note tabular-nums">
                      Beban: {hourly.load_kw[inspectStepIdx]} kW | PV: {hourly.pv_generation_kw[inspectStepIdx]} kW | Biomass: {hourly.biomass_generation_kw[inspectStepIdx]} kW | Diesel: {hourly.diesel_generation_kw?.[inspectStepIdx] ?? 0} kW | Charge: {hourly.bess_charge_kw[inspectStepIdx]} kW | Discharge: {hourly.bess_discharge_kw[inspectStepIdx]} kW
                    </p>
                  </div>
                )}

                {durationData && (
                  <div className="sec chart-card">
                    <div className="chart-head">
                      <h3>{lang === "en" ? "Load & Generation Duration Curve (Year 1)" : "Kurva Durasi Beban & Pembangkitan (Tahun 1)"}</h3>
                      <span className="chip">{durationData.percentLabels.length} titik sampel dari 8.760 jam</span>
                    </div>
                    <EChart
                      option={durationOption}
                      height={300}
                      ariaLabel="Kurva durasi beban, beban terpenuhi, PV, dan Biomass sepanjang 8.760 jam Tahun 1."
                    />
                    <details className="more">
                      <summary>{lang === "en" ? "Duration curve statistics table" : "Ringkasan statistik kurva durasi (alternatif teks)"}</summary>
                      <div className="tw tw-auto" tabIndex={0} role="region" aria-label="Ringkasan statistik kurva durasi">
                        <table className="sens-main">
                          <caption>Nilai puncak, median, dan minimum deret 8.760 jam (kW)</caption>
                          <thead>
                            <tr>
                              <th scope="col">Seri</th>
                              <th scope="col">Puncak (kW)</th>
                              <th scope="col">Median (kW)</th>
                              <th scope="col">Minimum (kW)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {durationData.stats.map((st) => (
                              <tr key={st.key}>
                                <th scope="row">{st.key}</th>
                                <td>{formatNumber(st.peakKw, lang, 2)}</td>
                                <td>{formatNumber(st.medianKw, lang, 2)}</td>
                                <td>{formatNumber(st.minKw, lang, 2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Panel 3: Peta Panas 8.760 Jam */}
        {activeTab === "heatmap" && (
          <div id="panel-heatmap" role="tabpanel" aria-labelledby="tab-heatmap">
            {!hourly ? (
              <div className="state">
                <h3>Data per jam 8.760 langkah tidak tersedia</h3>
                <p>Jalankan simulasi ulang untuk menampilkan peta panas tahunan.</p>
              </div>
            ) : (
              <div className="chart-card">
                <div className="chart-head">
                  <h3>{lang === "en" ? "Annual 8760-Hour Heatmap (365 Days x 24 Hours)" : "Peta Panas Tahunan 8.760 Jam (365 Hari x 24 Jam)"}</h3>
                  <div className="actions-inline">
                    {([
                      ["load", lang === "en" ? "Load (kW)" : "Beban (kW)"],
                      ["pv", "PV (kW)"],
                      ...(hourly.bess_soc_fraction ? [["soc", "SOC BESS (%)"]] : []),
                      ["unmet", "Unmet Load (kW)"],
                    ] as Array<[HeatmapMetric, string]>).map(([m, label]) => (
                      <button
                        key={m}
                        type="button"
                        className={`btn btn-sm ${heatmapMetric === m ? "primary" : "ghost"}`}
                        onClick={() => setHeatmapMetric(m)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <EChart
                  option={heatmapOption}
                  height={380}
                  ariaLabel={`Peta panas 8760 jam untuk metrik ${heatmapMetric}. Minimum ${heatmapData.min}, rata-rata ${heatmapData.avg.toFixed(1)}, maksimum ${heatmapData.max} ${heatmapData.unit}.`}
                />

                <p className="note sec tabular-nums">
                  Ringkasan statistik ({heatmapData.unit}): Minimum = {formatNumber(heatmapData.min, lang, 2)}, Rata-rata = {formatNumber(heatmapData.avg, lang, 2)}, Maksimum = {formatNumber(heatmapData.max, lang, 2)}.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Panel 4: Keuangan & Arus Kas */}
        {activeTab === "finance" && (
          <div id="panel-finance" role="tabpanel" aria-labelledby="tab-finance">
            <div className="grid-2">
              <div className="chart-card">
                <div className="chart-head">
                  <h3>{lang === "en" ? "Annual & Cumulative Cash Flow" : "Arus Kas Tahunan & Kumulatif"}</h3>
                  <span className="chip">Juta {curr}</span>
                </div>
                <EChart
                  option={cashflowOption}
                  height={320}
                  ariaLabel="Grafik kombinasi arus kas bersih tahunan dan arus kas kumulatif."
                />
              </div>

              <div className="chart-card">
                <div className="chart-head">
                  <h3>{lang === "en" ? "LCOE Cost Breakdown" : "Rincian Biaya LCOE"}</h3>
                  <span className="chip">{curr}/kWh</span>
                </div>
                <EChart
                  option={lcoeOption}
                  height={320}
                  ariaLabel="Grafik batang rincian komponen biaya LCOE."
                />
                {result.lcoe_breakdown && (
                  <details className="more">
                    <summary>{lang === "en" ? "LCOE breakdown table" : "Tabel rincian komponen LCOE (alternatif teks)"}</summary>
                    <div className="tw tw-auto" tabIndex={0} role="region" aria-label="Tabel rincian LCOE">
                      <table className="sens-main">
                        <caption>Kontribusi biaya LCOE ({curr}/kWh)</caption>
                        <thead>
                          <tr>
                            <th scope="col">Komponen Biaya</th>
                            <th scope="col">Nilai ({curr}/kWh)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(result.lcoe_breakdown).map(([k, v]) => (
                            <tr key={k}>
                              <th scope="row">{k}</th>
                              <td>{formatNumber(v, lang, 2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
            </div>

            {degradationData.years.length > 0 && (
              <div className="sec chart-card">
                <div className="chart-head">
                  <div>
                    <h3>{lang === "en" ? "PV & BESS Capacity Degradation Over Project Lifetime" : "Degradasi Kapasitas PV & BESS Sepanjang Umur Proyek"}</h3>
                    <p className="note">
                      {result.lifetime_summary.multi_year_mode === "scaled_year_1"
                        ? "Catatan jujur: pada mode cepat scaled_year_1, kapasitas BESS Tahun 2 ke atas mengikuti hasil Tahun 1. Jalankan full_hourly di Halaman 7 untuk degradasi BESS tiap jam selama umur proyek."
                        : "Menampilkan penurunan kapasitas efektif tahunan PV dan BESS beserta penanda tahun penggantian."}
                    </p>
                  </div>
                  <span className="chip">% kapasitas awal</span>
                </div>
                <EChart
                  option={degradationOption}
                  height={280}
                  ariaLabel="Grafik degradasi kapasitas efektif PV dan BESS dari Tahun 1 sampai akhir umur proyek."
                />
                <details className="more">
                  <summary>{lang === "en" ? "Capacity degradation table" : "Tabel degradasi kapasitas tahunan (alternatif teks)"}</summary>
                  <div className="tw" tabIndex={0} role="region" aria-label="Tabel degradasi kapasitas PV dan BESS">
                    <table className="sens-main">
                      <caption>Kapasitas efektif PV dan BESS per tahun (%)</caption>
                      <thead>
                        <tr>
                          <th scope="col">Tahun</th>
                          <th scope="col">PV (%)</th>
                          <th scope="col">BESS (%)</th>
                          <th scope="col">Kejadian Umur</th>
                        </tr>
                      </thead>
                      <tbody>
                        {degradationData.rows.map((row) => (
                          <tr key={row.year}>
                            <th scope="row">{row.year}</th>
                            <td>{formatNumber(row.pvPct, lang, 1)}</td>
                            <td>{row.bessPct !== null ? formatNumber(row.bessPct, lang, 1) : "-"}</td>
                            <td>{row.eventsLabel}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
            )}

            <div className="sec actions-inline">
              <button type="button" className="btn ghost" onClick={handleExportJson}>
                Ekspor Hasil JSON
              </button>
              <button type="button" className="btn ghost" onClick={handleExportCashflowCsv}>
                Ekspor CSV Arus Kas
              </button>
              {hourly && (
                <button type="button" className="btn ghost" onClick={handleExportHourlyCsv}>
                  Ekspor CSV 8.760 Jam
                </button>
              )}
            </div>

            <div className="sec tw" tabIndex={0} role="region" aria-label="Jadwal arus kas proyek multi-tahun">
              <table>
                <caption>Jadwal arus kas tahunan Tahun 0 sampai {result.lifetime_summary.project_lifetime_years} ({curr})</caption>
                <thead>
                  <tr>
                    <th scope="col">Tahun</th>
                    <th scope="col">Beban Terpasok (kWh)</th>
                    <th scope="col">CAPEX ({curr})</th>
                    <th scope="col">Pendapatan / Penghematan</th>
                    <th scope="col">O&amp;M + Bahan Bakar</th>
                    <th scope="col">Penggantian / Overhaul</th>
                    <th scope="col">Nilai Sisa</th>
                    <th scope="col">Arus Kas Bersih</th>
                    <th scope="col">Kumulatif</th>
                  </tr>
                </thead>
                <tbody>
                  {result.cashflow_schedule.map((r) => {
                    const opexFuel = r.om_cost + r.fuel_and_logistics_cost + r.grid_import_cost;
                    return (
                      <tr key={r.year}>
                        <th scope="row">{r.year}</th>
                        <td>{formatNumber(r.served_load_kwh, lang, 0)}</td>
                        <td>{formatNumber(r.capex_outflow, lang, 0)}</td>
                        <td>{formatNumber(r.gross_revenue_or_savings + r.export_revenue, lang, 0)}</td>
                        <td>{formatNumber(opexFuel, lang, 0)}</td>
                        <td>{formatNumber(r.replacement_and_overhaul_cost, lang, 0)}</td>
                        <td>{formatNumber(r.salvage_inflow, lang, 0)}</td>
                        <td className={r.net_cash_flow >= 0 ? "num-pos" : "num-neg"}>{formatNumber(r.net_cash_flow, lang, 0)}</td>
                        <td className={r.cumulative_cash_flow >= 0 ? "num-pos" : "num-neg"}>{formatNumber(r.cumulative_cash_flow, lang, 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Total</th>
                    <td>{formatNumber(totalRow.served, lang, 0)}</td>
                    <td>{fin ? formatNumber(fin.net_capex, lang, 0) : "-"}</td>
                    <td>{formatNumber(totalRow.rev, lang, 0)}</td>
                    <td>{formatNumber(totalRow.opex, lang, 0)}</td>
                    <td>{formatNumber(totalRow.repl, lang, 0)}</td>
                    <td>{fin ? formatNumber(fin.total_salvage_value, lang, 0) : "-"}</td>
                    <td className={totalRow.net >= 0 ? "num-pos" : "num-neg"}>{formatNumber(totalRow.net, lang, 0)}</td>
                    <td>-</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </div>

      <p className="note sec">
        Sumber cuaca: {result.weather_source.dataset ?? result.weather_source.provider} ({result.weather_source.period ?? "TMY"}), zona waktu {result.weather_source.timezone}. Mesin v{result.engine_version}, kontrak v{result.contract_version}, hash konfigurasi <code>{result.config_hash.slice(0, 18)}...</code>, dihitung {result.calculated_at}.
      </p>
    </>
  );
}
