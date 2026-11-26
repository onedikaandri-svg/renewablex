"use client";

import { use, useEffect, useMemo, useState } from "react";
import EChart, { getChartThemeColors, type EChartsOption } from "@/components/hybrid/EChart";
import HybridShell from "@/components/hybrid/HybridShell";
import RangeNumberField from "@/components/hybrid/RangeNumberField";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import { SLOW_ENGINE_NOTE, formatNumber, formatPercent } from "@/lib/format";
import { previewHybridLoad } from "@/lib/hybrid-api";
import { usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

export default function HybridLoadPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, ready, updateProject } = useHybridProject(projectId);
  const { pushToast } = useToast();
  const { theme, lang } = usePreferences();
  const colors = useMemo(() => getChartThemeColors(theme), [theme]);

  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!loading) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [loading]);

  const loadPreview = project?.loadPreview ?? null;

  const dailyOption = useMemo<EChartsOption>(() => {
    if (!loadPreview) return {};
    return {
      tooltip: { trigger: "axis" },
      legend: { top: 0, textStyle: { color: colors.text } },
      grid: { left: 48, right: 20, top: 40, bottom: 28 },
      xAxis: {
        type: "category",
        data: loadPreview.daily_average_24h.map((d) => `${String(d.hour).padStart(2, "0")}:00`),
        axisLabel: { color: colors.muted },
      },
      yAxis: {
        type: "value",
        name: "kW",
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      series: [
        { name: "Maksimum (kW)", type: "line", symbol: "none", lineStyle: { type: "dashed", width: 1.5 }, color: colors.muted, data: loadPreview.daily_average_24h.map((d) => d.max_kw) },
        { name: "Rata-rata (kW)", type: "line", areaStyle: { opacity: 0.2 }, color: colors.pv, lineStyle: { width: 2.5 }, data: loadPreview.daily_average_24h.map((d) => d.avg_kw) },
        { name: "Minimum (kW)", type: "line", symbol: "none", lineStyle: { type: "dotted", width: 1.5 }, color: colors.bess, data: loadPreview.daily_average_24h.map((d) => d.min_kw) },
      ],
    };
  }, [loadPreview, colors]);

  const heatmapOption = useMemo<EChartsOption>(() => {
    if (!loadPreview) return {};
    const points: Array<[number, number, number]> = [];
    let min = Infinity;
    let max = -Infinity;
    const arr = loadPreview.hourly_load_kw;
    for (let i = 0; i < Math.min(arr.length, 8760); i++) {
      const v = Math.round(arr[i] * 10) / 10;
      points.push([Math.floor(i / 24), i % 24, v]);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return {
      tooltip: {
        position: "top",
        formatter: (p: unknown) => {
          const item = p as { value: [number, number, number] };
          return `Hari ${item.value[0] + 1}, ${String(item.value[1]).padStart(2, "0")}:00<br/><b>${formatNumber(item.value[2], lang, 1)} kW</b>`;
        },
      },
      grid: { left: 48, right: 18, top: 18, bottom: 52 },
      xAxis: { type: "category", data: Array.from({ length: 365 }, (_, i) => `${i + 1}`), axisLabel: { color: colors.muted, interval: 29 } },
      yAxis: { type: "category", data: Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`), axisLabel: { color: colors.muted, interval: 3 } },
      visualMap: {
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) && max > min ? max : 1,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        textStyle: { color: colors.muted },
        inRange: { color: ["#F1F5F9", "#B9B9F9", "#8E5CFF", "#533AFD"] },
      },
      series: [{ type: "heatmap", data: points, animation: false, progressive: 2000 }],
    };
  }, [loadPreview, colors, lang]);

  if (!ready) return <div className="state"><p>Memuat proyek&hellip;</p></div>;
  if (!project) return <MissingProjectState />;

  const lp = project.load_profile;

  async function handlePreview() {
    if (!project) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await previewHybridLoad(project);
      updateProject((p) => ({ ...p, loadPreview: res }));
      pushToast("Profil beban berhasil divalidasi oleh mesin.", "success");
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg([...err.problems.general, ...Object.values(err.problems.fields)].join(" "));
      } else {
        setErrorMsg(err instanceof Error ? err.message : "Gagal memvalidasi profil beban.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCsvUpload(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    updateProject((p) => ({
      ...p,
      load_profile: { ...p.load_profile, mode: "csv", csv_text: text, csv_filename: file.name },
      loadPreview: null,
    }));
    pushToast(`Berkas "${file.name}" dimuat. Klik Pratinjau & Validasi Beban.`, "info");
  }

  return (
    <HybridShell
      project={project}
      activeStep="load"
      title={lang === "en" ? "Electrical Load Profile" : "Profil Beban Listrik (8.760 Jam)"}
      subtitle="Bangun profil beban sintetis dari parameter atau unggah berkas CSV 8.760 jam per tahun."
      result={result}
    >
      <div className="grid-hybrid">
        <section className="card" aria-labelledby="h-load-in">
          <div className="card-header">
            <h2 id="h-load-in">Sumber Profil Beban</h2>
          </div>

          <div className="seg-group" role="group" aria-label="Mode profil beban">
            <button
              type="button"
              className="seg-btn"
              aria-pressed={lp.mode === "synthetic"}
              onClick={() => updateProject((p) => ({ ...p, load_profile: { ...p.load_profile, mode: "synthetic" } }))}
            >
              Pembangkit Sintetis
            </button>
            <button
              type="button"
              className="seg-btn"
              aria-pressed={lp.mode === "csv"}
              onClick={() => updateProject((p) => ({ ...p, load_profile: { ...p.load_profile, mode: "csv" } }))}
            >
              Unggah CSV 8.760 Jam
            </button>
          </div>

          {lp.mode === "synthetic" ? (
            <>
              <RangeNumberField
                id="load-base"
                label="Beban Dasar (Base Load)"
                unit="kW"
                min={0}
                max={2000}
                step={5}
                value={lp.base_load_kw}
                onChange={(v) => updateProject((p) => ({ ...p, load_profile: { ...p.load_profile, base_load_kw: v } }))}
              />
              <RangeNumberField
                id="load-peak"
                label="Beban Puncak (Peak Load)"
                unit="kW"
                min={1}
                max={5000}
                step={10}
                value={lp.peak_load_kw}
                onChange={(v) => updateProject((p) => ({ ...p, load_profile: { ...p.load_profile, peak_load_kw: v } }))}
              />
              <div className="grid-2">
                <div className="fld">
                  <label htmlFor="load-noise">Derau Acak (Fraksi 0..0,99)</label>
                  <input
                    id="load-noise"
                    type="number"
                    step="0.01"
                    min={0}
                    max={0.99}
                    value={lp.noise_fraction}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) updateProject((p) => ({ ...p, load_profile: { ...p.load_profile, noise_fraction: v } }));
                    }}
                  />
                </div>
                <div className="fld">
                  <label htmlFor="load-seed">Seed Deterministik</label>
                  <input
                    id="load-seed"
                    type="number"
                    step={1}
                    value={lp.seed}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) updateProject((p) => ({ ...p, load_profile: { ...p.load_profile, seed: Math.trunc(v) } }));
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="fld">
              <label htmlFor="load-csv-file">Pilih Berkas CSV (8.760 Baris)</label>
              <input
                id="load-csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void handleCsvUpload(e.target.files?.[0])}
              />
              <p className="note" style={{ marginTop: "0.5rem" }}>
                Format didukung: 1 kolom nilai kW atau 2 kolom (<code>waktu,load_kw</code>). Tidak boleh ada nilai kosong atau negatif.
              </p>
              {lp.csv_filename && <p className="note">Berkas termuat: <strong>{lp.csv_filename}</strong></p>}
            </div>
          )}

          <div className="row">
            <button type="button" className="btn primary" disabled={loading} onClick={() => void handlePreview()}>
              {loading ? "Memvalidasi Beban..." : "Pratinjau & Validasi Beban"}
            </button>
          </div>
        </section>

        <section aria-labelledby="h-load-out">
          <h2 id="h-load-out" style={{ marginTop: 0 }}>Pratinjau Profil Beban</h2>

          {loading && (
            <div className="state" role="status">
              <p>Memvalidasi deret beban 8.760 langkah di mesin hitung&hellip;</p>
              {slow && <p className="note" style={{ marginTop: "0.75rem" }}>{SLOW_ENGINE_NOTE}</p>}
            </div>
          )}

          {!loading && errorMsg && (
            <div className="state bad" role="alert">
              <h3>Data beban belum valid</h3>
              <p>{errorMsg}</p>
            </div>
          )}

          {!loading && !errorMsg && !loadPreview && (
            <div className="state">
              <h3>Belum ada pratinjau beban</h3>
              <p>Tekan &ldquo;Pratinjau &amp; Validasi Beban&rdquo; untuk melihat kurva harian rata-rata dan peta panas 8.760 jam.</p>
            </div>
          )}

          {!loading && loadPreview && (
            <>
              <div className="kpis">
                <div className="kpi">
                  <span>Total Energi Beban</span>
                  <b className="accent">{formatNumber(loadPreview.summary.total_load_kwh / 1000, lang, 1)} MWh/thn</b>
                  <span>{loadPreview.summary.steps_count} langkah</span>
                </div>
                <div className="kpi">
                  <span>Beban Puncak</span>
                  <b>{formatNumber(loadPreview.summary.peak_load_kw, lang, 1)} kW</b>
                  <span>Min: {formatNumber(loadPreview.summary.min_load_kw, lang, 1)} kW</span>
                </div>
                <div className="kpi">
                  <span>Rata-rata &amp; Load Factor</span>
                  <b>{formatNumber(loadPreview.summary.average_load_kw, lang, 1)} kW</b>
                  <span>Load factor: {formatPercent(loadPreview.summary.load_factor, lang, 1)}</span>
                </div>
              </div>

              <div className="sec chart-card">
                <div className="chart-head">
                  <h3>Profil Beban Harian Rata-rata (24 Jam)</h3>
                  <span className="chip">kW</span>
                </div>
                <EChart option={dailyOption} height={260} ariaLabel="Grafik profil beban harian rata-rata 24 jam." />
              </div>

              <div className="sec chart-card">
                <div className="chart-head">
                  <h3>Peta Panas Beban Tahunan (365 Hari x 24 Jam)</h3>
                  <span className="chip">kW</span>
                </div>
                <EChart option={heatmapOption} height={320} ariaLabel="Peta panas beban listrik sepanjang 8.760 jam." />
              </div>
            </>
          )}
        </section>
      </div>
    </HybridShell>
  );
}
