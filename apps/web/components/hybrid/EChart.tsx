"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { usePreferences } from "@/lib/preferences";

echarts.use([
  BarChart,
  LineChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  VisualMapComponent,
  MarkLineComponent,
  MarkPointComponent,
  CanvasRenderer,
]);

export type EChartsOption = echarts.EChartsCoreOption;

export interface ChartThemeColors {
  text: string;
  muted: string;
  border: string;
  surface: string;
  pv: string;
  bess: string;
  biomass: string;
  load: string;
  grid: string;
  unmet: string;
  accent: string;
}

export function getChartThemeColors(theme: "light" | "dark"): ChartThemeColors {
  if (theme === "dark") {
    return {
      text: "#F1F5F9",
      muted: "#A9B4C2",
      border: "#1E3A5F",
      surface: "#0B2542",
      pv: "#A78BFA",
      bess: "#38BDF8",
      biomass: "#FBBF24",
      load: "#E2E8F0",
      grid: "#4ADE80",
      unmet: "#F87171",
      accent: "#A78BFA",
    };
  }
  return {
    text: "#0B1F3A",
    muted: "#5A687D",
    border: "#E5EDF5",
    surface: "#FFFFFF",
    pv: "#533AFD",
    bess: "#0EA5E9",
    biomass: "#D97706",
    load: "#061B31",
    grid: "#16A34A",
    unmet: "#B42318",
    accent: "#533AFD",
  };
}

export default function EChart({
  option,
  height = 320,
  ariaLabel,
}: {
  option: EChartsOption;
  height?: number;
  ariaLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const { theme } = usePreferences();

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const instance = echarts.init(el, undefined, { renderer: "canvas" });
    chartRef.current = instance;

    const ro = new ResizeObserver(() => {
      instance.resize();
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      instance.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.setOption(option, { notMerge: true });
  }, [option, theme]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      style={{ width: "100%", height: `${height}px` }}
    />
  );
}
