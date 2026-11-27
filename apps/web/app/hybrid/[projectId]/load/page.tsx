"use client";

import { use, useEffect, useMemo, useState } from "react";
import EChart, { getChartThemeColors, type EChartsOption } from "@/components/hybrid/EChart";
import HybridShell from "@/components/hybrid/HybridShell";
import RangeNumberField from "@/components/hybrid/RangeNumberField";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import { slowEngineNoteFor, formatNumber, formatPercent } from "@/lib/format";
import { previewHybridLoad } from "@/lib/hybrid-api";
import { tr, usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

type LoadShapePresetId = "engine_default" | "industrial_24h" | "commercial_day" | "residential_evening" | "custom";

const ENGINE_DEFAULT_DAILY_24: number[] = [
  0.10, 0.08, 0.06, 0.06, 0.08, 0.15,
  0.35, 0.58, 0.78, 0.90, 0.96, 1.00,
  0.95, 0.97, 0.94, 0.88, 0.76, 0.65,
  0.58, 0.50, 0.42, 0.30, 0.20, 0.14,
];

const INDUSTRIAL_24H_DAILY_24: number[] = [
  0.88, 0.86, 0.85, 0.85, 0.87, 0.90,
  0.94, 0.98, 1.00, 1.00, 0.99, 0.96,
  0.95, 0.99, 1.00, 0.99, 0.97, 0.95,
  0.94, 0.93, 0.92, 0.91, 0.90, 0.89,
];

const COMMERCIAL_DAY_DAILY_24: number[] = [
  0.08, 0.07, 0.07, 0.07, 0.08, 0.12,
  0.28, 0.62, 0.88, 0.96, 1.00, 0.98,
  0.92, 0.97, 1.00, 0.95, 0.82, 0.52,
  0.30, 0.20, 0.15, 0.12, 0.10, 0.09,
];

const RESIDENTIAL_EVENING_DAILY_24: number[] = [
  0.22, 0.18, 0.16, 0.15, 0.18, 0.32,
  0.48, 0.42, 0.30, 0.26, 0.25, 0.27,
  0.30, 0.32, 0.34, 0.38, 0.50, 0.74,
  0.94, 1.00, 0.96, 0.82, 0.56, 0.34,
];

const DEFAULT_MONTHLY_12: number[] = [
  1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
  1.0, 1.0, 1.0, 1.0, 1.0, 1.0,
];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function arraysEqual(a: number[] | null | undefined, b: number[]): boolean {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
}

function detectLoadShapePreset(
  daily: number[] | null | undefined,
  monthly: number[] | null | undefined,
): LoadShapePresetId {
  const isDefaultMonthly = !monthly || arraysEqual(monthly, DEFAULT_MONTHLY_12);
  if (!daily && !monthly) return "engine_default";
  if (isDefaultMonthly && arraysEqual(daily, INDUSTRIAL_24H_DAILY_24)) return "industrial_24h";
  if (isDefaultMonthly && arraysEqual(daily, COMMERCIAL_DAY_DAILY_24)) return "commercial_day";
  if (isDefaultMonthly && arraysEqual(daily, RESIDENTIAL_EVENING_DAILY_24)) return "residential_evening";
  return "custom";
}

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
  const activePresetId = detectLoadShapePreset(lp.daily_profile, lp.monthly_factors);
  const editableDaily =
    Array.isArray(lp.daily_profile) && lp.daily_profile.length === 24
      ? lp.daily_profile
      : ENGINE_DEFAULT_DAILY_24;
  const editableMonthly =
    Array.isArray(lp.monthly_factors) && lp.monthly_factors.length === 12
      ? lp.monthly_factors
      : DEFAULT_MONTHLY_12;

  function handleSelectShapePreset(preset: LoadShapePresetId) {
    if (preset === "engine_default") {
      updateProject((p) => ({
        ...p,
        load_profile: { ...p.load_profile, daily_profile: null, monthly_factors: null },
        loadPreview: null,
      }));
      return;
    }
    if (preset === "industrial_24h") {
      updateProject((p) => ({
        ...p,
        load_profile: {
          ...p.load_profile,
          daily_profile: [...INDUSTRIAL_24H_DAILY_24],
          monthly_factors: [...DEFAULT_MONTHLY_12],
        },
        loadPreview: null,
      }));
      return;
    }
    if (preset === "commercial_day") {
      updateProject((p) => ({
        ...p,
        load_profile: {
          ...p.load_profile,
          daily_profile: [...COMMERCIAL_DAY_DAILY_24],
          monthly_factors: [...DEFAULT_MONTHLY_12],
        },
        loadPreview: null,
      }));
      return;
    }
    if (preset === "residential_evening") {
      updateProject((p) => ({
        ...p,
        load_profile: {
          ...p.load_profile,
          daily_profile: [...RESIDENTIAL_EVENING_DAILY_24],
          monthly_factors: [...DEFAULT_MONTHLY_12],
        },
        loadPreview: null,
      }));
      return;
    }
    updateProject((p) => ({
      ...p,
      load_profile: {
        ...p.load_profile,
        daily_profile:
          Array.isArray(p.load_profile.daily_profile) && p.load_profile.daily_profile.length === 24
            ? [...p.load_profile.daily_profile]
            : [...ENGINE_DEFAULT_DAILY_24],
        monthly_factors:
          Array.isArray(p.load_profile.monthly_factors) && p.load_profile.monthly_factors.length === 12
            ? [...p.load_profile.monthly_factors]
            : [...DEFAULT_MONTHLY_12],
      },
      loadPreview: null,
    }));
  }

  function handleUpdateHourlyWeight(hourIdx: number, val: number) {
    const clamped = Math.max(0, val);
    updateProject((p) => {
      const nextDaily =
        Array.isArray(p.load_profile.daily_profile) && p.load_profile.daily_profile.length === 24
          ? [...p.load_profile.daily_profile]
          : [...ENGINE_DEFAULT_DAILY_24];
      nextDaily[hourIdx] = clamped;
      const nextMonthly =
        Array.isArray(p.load_profile.monthly_factors) && p.load_profile.monthly_factors.length === 12
          ? [...p.load_profile.monthly_factors]
          : [...DEFAULT_MONTHLY_12];
      return {
        ...p,
        load_profile: {
          ...p.load_profile,
          daily_profile: nextDaily,
          monthly_factors: nextMonthly,
        },
        loadPreview: null,
      };
    });
  }

  function handleUpdateMonthlyFactor(monthIdx: number, val: number) {
    const clamped = Math.max(0, val);
    updateProject((p) => {
      const nextDaily =
        Array.isArray(p.load_profile.daily_profile) && p.load_profile.daily_profile.length === 24
          ? [...p.load_profile.daily_profile]
          : [...ENGINE_DEFAULT_DAILY_24];
      const nextMonthly =
        Array.isArray(p.load_profile.monthly_factors) && p.load_profile.monthly_factors.length === 12
          ? [...p.load_profile.monthly_factors]
          : [...DEFAULT_MONTHLY_12];
      nextMonthly[monthIdx] = clamped;
      return {
        ...p,
        load_profile: {
          ...p.load_profile,
          daily_profile: nextDaily,
          monthly_factors: nextMonthly,
        },
        loadPreview: null,
      };
    });
  }

  async function handlePreview() {
    if (!project) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await previewHybridLoad(project);
      updateProject((p) => ({ ...p, loadPreview: res }));
      pushToast(
        tr(
          lang,
          "Load profile validated by the calculation engine.",
          "Mantap! Profil beban sudah lolos validasi mesin.",
          "電力負荷プロファイルが計算エンジンで検証されました。",
        ),
        "success",
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorMsg([...err.problems.general, ...Object.values(err.problems.fields)].join(" "));
      } else {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : tr(lang, "Failed to validate load profile.", "Gagal memvalidasi profil beban.", "負荷プロファイルの検証に失敗しました。"),
        );
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
    pushToast(
      tr(
        lang,
        `File "${file.name}" loaded. Click Preview & Validate Load.`,
        `Sip, file "${file.name}" sudah masuk. Klik Cek & Validasi Beban ya!`,
        `ファイル「${file.name}」を読み込みました。「負荷プレビュー・検証」を押してください。`,
      ),
      "info",
    );
  }

  return (
    <HybridShell
      project={project}
      activeStep="load"
      title={tr(
        lang,
        "Electrical Load Profile (8,760 Hours)",
        "Profil Beban Listrik (8.760 Jam)",
        "電力負荷プロファイル（8,760時間）",
      )}
      subtitle={tr(
        lang,
        "Build a synthetic hourly load profile from parameters or upload your own 8,760-hour annual CSV file.",
        "Bikin profil beban otomatis dari parameter harian/bulanan, atau unggah file CSV 8.760 jam milikmu sendiri.",
        "パラメータから時間別負荷プロファイルを合成するか、8,760時間の年間CSVファイルをアップロードします。",
      )}
      result={result}
    >
      <div className="grid-hybrid">
        <section className="card" aria-labelledby="h-load-in">
          <div className="card-header">
            <h2 id="h-load-in">{tr(lang, "Load Profile Source", "Sumber Profil Beban", "負荷データソース")}</h2>
          </div>

          <div className="seg-group" role="group" aria-label={tr(lang, "Load profile mode", "Mode profil beban", "負荷プロファイルモード")}>
            <button
              type="button"
              className="seg-btn"
              aria-pressed={lp.mode === "synthetic"}
              onClick={() => updateProject((p) => ({ ...p, load_profile: { ...p.load_profile, mode: "synthetic" } }))}
            >
              {tr(lang, "Synthetic Builder", "Profil Otomatis (Sintetis)", "合成プロファイル生成")}
            </button>
            <button
              type="button"
              className="seg-btn"
              aria-pressed={lp.mode === "csv"}
              onClick={() => updateProject((p) => ({ ...p, load_profile: { ...p.load_profile, mode: "csv" } }))}
            >
              {tr(lang, "Upload 8,760h CSV", "Unggah CSV 8.760 Jam", "8,760時間CSVアップロード")}
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

              <div className="fld">
                <label htmlFor="load-shape-preset">Preset Pola Harian [REAL DATA]</label>
                <select
                  id="load-shape-preset"
                  value={activePresetId}
                  onChange={(e) => handleSelectShapePreset(e.target.value as LoadShapePresetId)}
                >
                  <option value="engine_default">Bawaan Mesin (Standar Industri)</option>
                  <option value="industrial_24h">Industri 24 Jam / 3 Shift [REAL DATA]</option>
                  <option value="commercial_day">Komersial &amp; Perkantoran Siang (08:00 - 17:00) [REAL DATA]</option>
                  <option value="residential_evening">Perumahan / Puncak Malam (18:00 - 22:00) [REAL DATA]</option>
                  <option value="custom">Kustom (Edit 24 Jam &amp; 12 Bulan)</option>
                </select>
              </div>

              <details className="more">
                <summary>Editor Pola Harian (24 Jam) &amp; Faktor Musiman (12 Bulan)</summary>
                <p className="note" style={{ marginTop: "0.375rem" }}>
                  Bobot jam (0,00 sampai 1,00+) menentukan interpolasi antara beban dasar dan beban puncak. Faktor bulanan mengalikan profil beban pada masing-masing bulan.
                </p>

                <fieldset style={{ marginTop: "0.75rem" }}>
                  <legend>Bobot Harian 24 Jam (00:00 sampai 23:00)</legend>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(5.25rem, 1fr))",
                      gap: "0.5rem",
                      marginTop: "0.5rem",
                    }}
                  >
                    {editableDaily.map((w, idx) => {
                      const hourLabel = `${String(idx).padStart(2, "0")}:00`;
                      return (
                        <div key={`hr-${idx}`} className="fld" style={{ marginTop: 0 }}>
                          <label htmlFor={`load-hr-${idx}`} className="tabular-nums" style={{ fontSize: "0.75rem" }}>
                            {hourLabel}
                          </label>
                          <input
                            id={`load-hr-${idx}`}
                            type="number"
                            step="0.05"
                            min={0}
                            max={2}
                            value={w}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v)) handleUpdateHourlyWeight(idx, v);
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </fieldset>

                <fieldset style={{ marginTop: "0.875rem" }}>
                  <legend>Faktor Musiman 12 Bulan (Jan sampai Des)</legend>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(5.25rem, 1fr))",
                      gap: "0.5rem",
                      marginTop: "0.5rem",
                    }}
                  >
                    {editableMonthly.map((mFactor, idx) => (
                      <div key={`mo-${idx}`} className="fld" style={{ marginTop: 0 }}>
                        <label htmlFor={`load-mo-${idx}`} style={{ fontSize: "0.75rem" }}>
                          {MONTH_NAMES[idx]}
                        </label>
                        <input
                          id={`load-mo-${idx}`}
                          type="number"
                          step="0.05"
                          min={0}
                          max={3}
                          value={mFactor}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v)) handleUpdateMonthlyFactor(idx, v);
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </fieldset>
              </details>
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
              {loading
                ? tr(lang, "Validating Load...", "Lagi Memvalidasi Beban...", "負荷データを検証中...")
                : tr(lang, "Preview & Validate Load", "Cek & Validasi Beban", "負荷プレビュー・検証")}
            </button>
          </div>
        </section>

        <section aria-labelledby="h-load-out">
          <h2 id="h-load-out" style={{ marginTop: 0 }}>
            {tr(lang, "Load Profile Preview", "Pratinjau Profil Beban", "負荷プロファイルプレビュー")}
          </h2>

          {loading && (
            <div className="state" role="status">
              <p>{tr(lang, "Validating 8,760-step load series in calculation engine...", "Lagi memvalidasi deret beban 8.760 jam di mesin hitung...", "計算エンジンで8,760ステップの負荷系列を検証中...")}</p>
              {slow && <p className="note" style={{ marginTop: "0.75rem" }}>{slowEngineNoteFor(lang)}</p>}
            </div>
          )}

          {!loading && errorMsg && (
            <div className="state bad" role="alert">
              <h3>{tr(lang, "Load data is not valid yet", "Data beban belum valid nih", "負荷データにエラーがあります")}</h3>
              <p>{errorMsg}</p>
            </div>
          )}

          {!loading && !errorMsg && !loadPreview && (
            <div className="state">
              <h3>{tr(lang, "No load preview yet", "Belum ada pratinjau beban", "負荷プレビューがまだありません")}</h3>
              <p>
                {tr(
                  lang,
                  'Press "Preview & Validate Load" to view the 24-hour average daily curve and 8,760-hour heatmap.',
                  'Klik "Cek & Validasi Beban" buat lihat kurva harian rata-rata dan heatmap 8.760 jam.',
                  '「負荷プレビュー・検証」を押すと、24時間平均負荷曲線と8,760時間ヒートマップが表示されます。',
                )}
              </p>
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
