"use client";

import { use, useEffect, useMemo, useState } from "react";
import EChart, { getChartThemeColors, type EChartsOption } from "@/components/hybrid/EChart";
import HybridShell from "@/components/hybrid/HybridShell";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import { SLOW_ENGINE_NOTE, formatNumber } from "@/lib/format";
import { fetchHybridPresets, previewHybridWeather } from "@/lib/hybrid-api";
import type { HybridPresetsResponse } from "@/lib/hybrid-types";
import { usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

const FALLBACK_LOCATIONS = [
  { id: "jakarta", name: "Jakarta (Jawa Barat) [REAL DATA]", latitude: -6.20, longitude: 106.80, elevation_m: 12, timezone: "Asia/Jakarta" },
  { id: "cikarang", name: "Cikarang Kawasan Industri [REAL DATA]", latitude: -6.28, longitude: 107.15, elevation_m: 25, timezone: "Asia/Jakarta" },
  { id: "surabaya", name: "Surabaya (Jawa Timur) [REAL DATA]", latitude: -7.25, longitude: 112.75, elevation_m: 5, timezone: "Asia/Jakarta" },
  { id: "medan", name: "Medan (Sumatera Utara) [REAL DATA]", latitude: 3.59, longitude: 98.67, elevation_m: 25, timezone: "Asia/Jakarta" },
  { id: "makassar", name: "Makassar (Sulawesi Selatan) [REAL DATA]", latitude: -5.14, longitude: 119.43, elevation_m: 8, timezone: "Asia/Makassar" },
  { id: "kupang", name: "Kupang (NTT) [REAL DATA]", latitude: -10.17, longitude: 123.61, elevation_m: 45, timezone: "Asia/Makassar" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export default function HybridLocationPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, ready, updateProject } = useHybridProject(projectId);
  const { pushToast } = useToast();
  const { theme, lang } = usePreferences();
  const colors = useMemo(() => getChartThemeColors(theme), [theme]);

  const [presets, setPresets] = useState<HybridPresetsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    fetchHybridPresets().then(setPresets).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [loading]);

  const weatherPreview = project?.weatherPreview ?? null;

  const weatherOption = useMemo<EChartsOption>(() => {
    if (!weatherPreview) return {};
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: colors.text } },
      grid: { left: 48, right: 48, top: 40, bottom: 28 },
      xAxis: { type: "category", data: MONTHS, axisLabel: { color: colors.muted } },
      yAxis: [
        { type: "value", name: "kWh/m2", nameTextStyle: { color: colors.muted }, axisLabel: { color: colors.muted }, splitLine: { lineStyle: { color: colors.border } } },
        { type: "value", name: "C", nameTextStyle: { color: colors.muted }, axisLabel: { color: colors.muted }, splitLine: { show: false } },
      ],
      series: [
        { name: "GHI (kWh/m2)", type: "bar", color: colors.pv, data: weatherPreview.monthly.map((m) => m.ghi_kwh_m2) },
        { name: "DNI (kWh/m2)", type: "bar", color: colors.bess, data: weatherPreview.monthly.map((m) => m.dni_kwh_m2) },
        { name: "Suhu Rata-rata (C)", type: "line", yAxisIndex: 1, color: colors.biomass, data: weatherPreview.monthly.map((m) => m.avg_temp_c) },
      ],
    };
  }, [weatherPreview, colors]);

  if (!ready) {
    return <div className="state"><p>Memuat proyek&hellip;</p></div>;
  }
  if (!project) {
    return <MissingProjectState />;
  }

  const locations = presets?.location_presets ?? FALLBACK_LOCATIONS;

  async function handleFetchWeather() {
    if (!project) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const preview = await previewHybridWeather(project);
      updateProject((p) => ({
        ...p,
        project: {
          ...p.project,
          elevation_m: preview.weather_source.elevation_m ?? p.project.elevation_m,
        },
        weatherPreview: preview,
      }));
      pushToast("Data cuaca PVGIS v5.3 TMY berhasil diambil.", "success");
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg([...err.problems.general, ...Object.values(err.problems.fields)].join(" "));
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Gagal mengambil data cuaca.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <HybridShell
      project={project}
      activeStep="location"
      title={lang === "en" ? "Location & Solar Resource" : "Lokasi & Sumber Daya Cuaca"}
      subtitle="Pilih lokasi proyek dan ambil data cuaca TMY per jam dari PVGIS v5.3 (multi-tahun PVGIS-ERA5)."
      result={result}
    >
      <div className="grid-hybrid">
        <section className="card" aria-labelledby="h-loc">
          <div className="card-header">
            <h2 id="h-loc">Identitas &amp; Koordinat Lokasi</h2>
          </div>

          <div className="fld" style={{ marginTop: 0 }}>
            <label htmlFor="loc-name">Nama Proyek</label>
            <input
              id="loc-name"
              type="text"
              value={project.project.project_name}
              onChange={(e) => updateProject((p) => ({ ...p, project: { ...p.project, project_name: e.target.value } }))}
            />
          </div>

          <div className="fld">
            <label htmlFor="loc-preset">Preset Kota Indonesia [REAL DATA]</label>
            <select
              id="loc-preset"
              defaultValue=""
              onChange={(e) => {
                const hit = locations.find((l) => l.id === e.target.value);
                if (!hit) return;
                updateProject((p) => ({
                  ...p,
                  project: {
                    ...p.project,
                    latitude: hit.latitude,
                    longitude: hit.longitude,
                    elevation_m: hit.elevation_m,
                    timezone: hit.timezone,
                  },
                  weatherPreview: null,
                }));
              }}
            >
              <option value="">Pilih kota preset untuk mengisi koordinat...</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.latitude}, {l.longitude})
                </option>
              ))}
            </select>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="loc-lat">Lintang (Latitude)</label>
              <input
                id="loc-lat"
                type="number"
                step="0.01"
                value={project.project.latitude}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) updateProject((p) => ({ ...p, project: { ...p.project, latitude: v }, weatherPreview: null }));
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="loc-lon">Bujur (Longitude)</label>
              <input
                id="loc-lon"
                type="number"
                step="0.01"
                value={project.project.longitude}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) updateProject((p) => ({ ...p, project: { ...p.project, longitude: v }, weatherPreview: null }));
                }}
              />
            </div>
          </div>

          <div className="fld">
            <label htmlFor="loc-tz">Zona Waktu Lokal</label>
            <select
              id="loc-tz"
              value={project.project.timezone}
              onChange={(e) => updateProject((p) => ({ ...p, project: { ...p.project, timezone: e.target.value }, weatherPreview: null }))}
            >
              <option value="Asia/Jakarta">WIB (Asia/Jakarta, UTC+7)</option>
              <option value="Asia/Makassar">WITA (Asia/Makassar, UTC+8)</option>
              <option value="Asia/Jayapura">WIT (Asia/Jayapura, UTC+9)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>

          <div className="row">
            <button type="button" className="btn primary" disabled={loading} onClick={() => void handleFetchWeather()}>
              {loading ? "Mengambil Data Cuaca..." : "Ambil Data Cuaca PVGIS"}
            </button>
          </div>
        </section>

        <section aria-labelledby="h-weather-out">
          <h2 id="h-weather-out" style={{ marginTop: 0 }}>Pratinjau Sumber Daya Cuaca</h2>

          {loading && (
            <div className="state" role="status">
              <p>Menghubungi mesin hitung dan PVGIS v5.3 TMY&hellip;</p>
              {slow && <p className="note" style={{ marginTop: "0.75rem" }}>{SLOW_ENGINE_NOTE}</p>}
            </div>
          )}

          {!loading && errorMsg && (
            <div className="state bad" role="alert">
              <h3>Gagal mengambil data cuaca</h3>
              <p>{errorMsg}</p>
            </div>
          )}

          {!loading && !errorMsg && !weatherPreview && (
            <div className="state">
              <h3>Belum ada pratinjau cuaca</h3>
              <p>Tekan tombol &ldquo;Ambil Data Cuaca PVGIS&rdquo; di sebelah kiri untuk melihat irradiansi dan suhu tahunan lokasi ini.</p>
            </div>
          )}

          {!loading && weatherPreview && (
            <>
              <div className="kpis">
                <div className="kpi">
                  <span>GHI Tahunan</span>
                  <b className="accent">{formatNumber(weatherPreview.annual_summary.total_ghi_kwh_m2, lang, 0)} kWh/m2</b>
                  <span>{weatherPreview.weather_source.dataset ?? "PVGIS-ERA5"}</span>
                </div>
                <div className="kpi">
                  <span>DNI Tahunan</span>
                  <b>{formatNumber(weatherPreview.annual_summary.total_dni_kwh_m2, lang, 0)} kWh/m2</b>
                  <span>DHI: {formatNumber(weatherPreview.annual_summary.total_dhi_kwh_m2, lang, 0)} kWh/m2</span>
                </div>
                <div className="kpi">
                  <span>Suhu Udara Rata-rata</span>
                  <b>{formatNumber(weatherPreview.annual_summary.avg_temp_c, lang, 1)} C</b>
                  <span>Min {weatherPreview.annual_summary.min_temp_c} C / Maks {weatherPreview.annual_summary.max_temp_c} C</span>
                </div>
                <div className="kpi">
                  <span>Elevasi &amp; Angin</span>
                  <b>{weatherPreview.weather_source.elevation_m ?? "-"} m</b>
                  <span>Angin rata-rata {weatherPreview.annual_summary.avg_wind_m_s} m/s</span>
                </div>
              </div>

              <div className="sec chart-card">
                <div className="chart-head">
                  <h3>Radiasi Surya &amp; Suhu Bulanan (TMY)</h3>
                  <span className="chip">{weatherPreview.weather_source.period ?? "2005-2023"}</span>
                </div>
                <EChart
                  option={weatherOption}
                  height={320}
                  ariaLabel="Grafik irradiansi GHI, DNI, dan suhu udara rata-rata bulanan dari PVGIS TMY."
                />
              </div>
            </>
          )}
        </section>
      </div>
    </HybridShell>
  );
}
