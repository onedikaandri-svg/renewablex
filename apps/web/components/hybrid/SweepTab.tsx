"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import EChart, { getChartThemeColors, type EChartsOption } from "@/components/hybrid/EChart";
import { ViabilityChip } from "@/components/hybrid/HybridShell";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import { translateDetailText } from "@/lib/errors-id";
import { slowEngineNoteFor, downloadFile, formatCompactCurrency, formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { cancelHybridSweepJob, getHybridSweepJob, submitHybridSweepJob } from "@/lib/hybrid-api";
import { buildExportFilenameSlug, buildSweepCsv } from "@/lib/hybrid-export";
import {
  applySweepCombinationToProject,
  clearSimulationResult,
  getSweepResult,
  saveSweepCombinationAsScenario,
  saveSweepResult,
} from "@/lib/hybrid-storage";
import type {
  HybridProjectConfig,
  HybridSimulateResponse,
  HybridSweepCombination,
  HybridSweepResult,
  SweepSortBy,
} from "@/lib/hybrid-types";
import { tr, usePreferences } from "@/lib/preferences";

function parseAxisNumbers(text: string): number[] {
  const parts = text
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const nums: number[] = [];
  for (const part of parts) {
    const val = Number(part.replace(",", "."));
    if (!Number.isFinite(val)) return [];
    nums.push(val);
  }
  return nums;
}

export default function SweepTab({
  project,
  updateProject,
  setResult,
  onScenarioSaved,
}: {
  project: HybridProjectConfig;
  updateProject: (updater: (prev: HybridProjectConfig) => HybridProjectConfig) => void;
  setResult: (res: HybridSimulateResponse | null) => void;
  onScenarioSaved: () => void;
}) {
  const { theme, lang } = usePreferences();
  const { pushToast } = useToast();
  const colors = useMemo(() => getChartThemeColors(theme), [theme]);

  const [pvText, setPvText] = useState("300, 500, 700");
  const [bessText, setBessText] = useState("0, 400, 800");
  const [bioText, setBioText] = useState("0, 250");
  const [dieselText, setDieselText] = useState("0");
  const [invMode, setInvMode] = useState<"keep_dc_ac_ratio" | "fixed">("keep_dc_ac_ratio");
  const [maxUnmetPct, setMaxUnmetPct] = useState("5");
  const [minRenPct, setMinRenPct] = useState("80");
  const [sortBy, setSortBy] = useState<SweepSortBy>("lcoe_asc");
  const [feasibleFirst, setFeasibleFirst] = useState(true);
  const [onlyFeasible, setOnlyFeasible] = useState(false);
  const [tableSort, setTableSort] = useState<SweepSortBy>("lcoe_asc");

  const [running, setRunning] = useState(false);
  const [slow, setSlow] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [sweepResult, setSweepResult] = useState<HybridSweepResult | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    setSweepResult(getSweepResult(project.id));
  }, [project.id]);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!running) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [running]);

  const pvVals = useMemo(() => parseAxisNumbers(pvText), [pvText]);
  const bessVals = useMemo(() => parseAxisNumbers(bessText), [bessText]);
  const bioVals = useMemo(() => parseAxisNumbers(bioText), [bioText]);
  const dieselVals = useMemo(() => parseAxisNumbers(dieselText), [dieselText]);
  const maxCombos = project.simulation.multi_year_mode === "full_hourly" ? 12 : 64;
  const totalCombos = pvVals.length * bessVals.length * bioVals.length * dieselVals.length;
  const axisError =
    pvVals.length === 0 || pvVals.some((v) => v <= 0)
      ? "Daftar PV (kWp) wajib berisi angka > 0."
      : bessVals.length === 0 || bessVals.some((v) => v < 0)
        ? "Daftar BESS (kWh) wajib berisi angka >= 0."
        : bioVals.length === 0 || bioVals.some((v) => v < 0)
          ? "Daftar Biomass (kW) wajib berisi angka >= 0."
          : dieselVals.length === 0 || dieselVals.some((v) => v < 0)
            ? "Daftar Diesel (kW) wajib berisi angka >= 0."
            : totalCombos > maxCombos
              ? `Total ${totalCombos} kombinasi melebihi batas aman ${maxCombos} kombinasi.`
              : null;

  async function handleRunSweep() {
    if (axisError) {
      setErrors([axisError]);
      return;
    }
    setRunning(true);
    setErrors([]);
    setProgress(2);
    setProgressText("Mendaftarkan job sapuan kombinasi ke mesin hitung...");

    const parsedUnmet = maxUnmetPct.trim() === "" ? null : Number(maxUnmetPct) / 100;
    const parsedRen = minRenPct.trim() === "" ? null : Number(minRenPct) / 100;

    try {
      const created = await submitHybridSweepJob(project, {
        pv_capacity_kwp_values: pvVals,
        bess_capacity_kwh_values: bessVals,
        biomass_capacity_kw_values: bioVals,
        diesel_capacity_kw_values: dieselVals,
        pv_inverter_sizing_mode: invMode,
        scale_replacement_costs: true,
        max_unmet_load_fraction: parsedUnmet !== null && Number.isFinite(parsedUnmet) ? parsedUnmet : null,
        min_renewable_fraction: parsedRen !== null && Number.isFinite(parsedRen) ? parsedRen : null,
        sort_by: sortBy,
        feasible_first: feasibleFirst,
      });
      if (unmountedRef.current) return;
      setActiveJobId(created.job_id);
      setProgress(Math.max(created.progress_percent, 4));
      setProgressText(created.current_step_label);

      while (!unmountedRef.current) {
        await new Promise((r) => setTimeout(r, 1500));
        if (unmountedRef.current) return;
        const status = await getHybridSweepJob(created.job_id);
        setProgress(status.progress_percent);
        setProgressText(
          `${status.completed_combinations} dari ${status.total_combinations} kombinasi (${status.current_step_label})`,
        );

        if (status.status === "completed" && status.result) {
          saveSweepResult(project.id, status.result);
          setSweepResult(status.result);
          setTableSort(status.result.sort_by);
          setActiveJobId(null);
          pushToast(`Sapuan ${status.result.total_combinations} kombinasi selesai.`, "success");
          return;
        }
        if (status.status === "cancelled") {
          setActiveJobId(null);
          setErrors(["Job sapuan kombinasi dibatalkan."]);
          return;
        }
        if (status.status === "failed") {
          setActiveJobId(null);
          const msg = status.error ? translateDetailText(status.error.msg) : "Sapuan gagal pada mesin hitung.";
          setErrors([msg]);
          return;
        }
      }
    } catch (err) {
      setActiveJobId(null);
      if (err instanceof ApiError) {
        setErrors([...err.problems.general, ...Object.values(err.problems.fields)]);
      } else {
        setErrors([err instanceof Error ? err.message : "Gagal menjalankan sapuan kombinasi."]);
      }
    } finally {
      if (!unmountedRef.current) setRunning(false);
    }
  }

  async function handleCancelSweep() {
    if (!activeJobId) return;
    try {
      await cancelHybridSweepJob(activeJobId);
      pushToast("Permintaan pembatalan sapuan dikirim.", "info");
    } catch {
      // Abaikan jika job sudah selesai bersamaan.
    }
  }

  function handleApplyCombo(combo: HybridSweepCombination) {
    updateProject((prev) => applySweepCombinationToProject(prev, combo));
    clearSimulationResult(project.id);
    setResult(null);
    pushToast(
      `Konfigurasi ${combo.combination_id} diterapkan. Jalankan simulasi di Halaman 7 untuk memperbarui dasbor.`,
      "success",
    );
  }

  function handleSaveScenario(combo: HybridSweepCombination) {
    const saved = saveSweepCombinationAsScenario(project, combo);
    onScenarioSaved();
    pushToast(`Skenario "${saved.project.project_name}" tersimpan di daftar proyek.`, "success");
  }

  function handleExportCsv() {
    if (!sweepResult) return;
    const slug = buildExportFilenameSlug(project.project.project_name);
    downloadFile(`${slug}-sapuan-kombinasi.csv`, buildSweepCsv(sweepResult), "text/csv;charset=utf-8");
  }

  const displayedCombos = useMemo(() => {
    if (!sweepResult) return [];
    const filtered = onlyFeasible
      ? sweepResult.combinations.filter((c) => c.feasible)
      : [...sweepResult.combinations];
    filtered.sort((a, b) => {
      if (feasibleFirst && a.feasible !== b.feasible) return a.feasible ? -1 : 1;
      if (tableSort === "lcoe_asc") return a.finance.lcoe - b.finance.lcoe;
      if (tableSort === "total_npc_asc") return a.finance.total_npc - b.finance.total_npc;
      if (tableSort === "npv_desc") return b.finance.npv - a.finance.npv;
      if (tableSort === "irr_desc") return (b.finance.irr ?? -999) - (a.finance.irr ?? -999);
      return b.technical.renewable_fraction - a.technical.renewable_fraction;
    });
    return filtered;
  }, [sweepResult, onlyFeasible, feasibleFirst, tableSort]);

  const paretoOption = useMemo<EChartsOption>(() => {
    if (!sweepResult || sweepResult.combinations.length === 0) return {};
    const curr = sweepResult.combinations[0].finance.currency_code;
    const feasiblePts = sweepResult.combinations
      .filter((c) => c.feasible)
      .map((c) => ({
        value: [Math.round(c.technical.renewable_fraction * 1000) / 10, c.finance.lcoe],
        comboId: c.combination_id,
        rank: c.rank,
      }));
    const infeasiblePts = sweepResult.combinations
      .filter((c) => !c.feasible)
      .map((c) => ({
        value: [Math.round(c.technical.renewable_fraction * 1000) / 10, c.finance.lcoe],
        comboId: c.combination_id,
        rank: c.rank,
      }));

    return {
      tooltip: {
        trigger: "item",
        formatter: (params: unknown) => {
          const p = params as { data?: { comboId?: string; rank?: number; value?: [number, number] } };
          const val = p.data?.value ?? [0, 0];
          return `<b>#${p.data?.rank} ${p.data?.comboId}</b><br/>Pangsa Terbarukan: ${formatNumber(val[0], lang, 1)}%<br/>LCOE: ${formatCurrency(val[1], curr, lang, 0)}/kWh`;
        },
      },
      legend: { top: 0, textStyle: { color: colors.text } },
      grid: { left: 68, right: 24, top: 44, bottom: 44 },
      xAxis: {
        type: "value",
        name: lang === "en" ? "Renewable Fraction (%)" : "Pangsa Terbarukan (%)",
        nameLocation: "middle",
        nameGap: 26,
        min: 0,
        max: 100,
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      yAxis: {
        type: "value",
        name: `LCOE (${curr}/kWh)`,
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      series: [
        {
          name: lang === "en" ? "Feasible" : "Memenuhi Batasan",
          type: "scatter",
          symbol: "circle",
          symbolSize: 12,
          color: colors.grid,
          data: feasiblePts,
        },
        {
          name: lang === "en" ? "Infeasible" : "Tidak Memenuhi Batasan",
          type: "scatter",
          symbol: "triangle",
          symbolSize: 11,
          color: colors.unmet,
          data: infeasiblePts,
        },
      ],
    };
  }, [sweepResult, colors, lang]);

  const winner = sweepResult?.combinations[0] ?? null;

  return (
    <div className="grid-hybrid">
      <section className="card" aria-labelledby="h-sweep-form">
        <div className="card-header">
          <h2 id="h-sweep-form">
            {tr(lang, "Sizing Sweep Ranges (HOMER Style)", "Rentang Ukuran Sizing (Gaya HOMER)", "設備容量スイープ範囲（HOMER方式）")}
          </h2>
          <button
            type="button"
            className="btn btn-sm ghost"
            onClick={() => {
              setPvText("300, 500, 700");
              setBessText("0, 400, 800");
              setBioText("0, 250");
              setDieselText("0");
            }}
          >
            {tr(lang, "Load Sample [REAL DATA]", "Isi Contoh [REAL DATA]", "サンプル読込 [REAL DATA]")}
          </button>
        </div>

        <p className="note">
          {tr(
            lang,
            <>Enter comma-separated sizing candidates. Include <code>0</code> for BESS, Biomass, or Diesel to test combinations without that component.</>,
            <>Masukkan kandidat ukuran dipisah koma. Isi angka <code>0</code> di BESS, Biomass, atau Diesel kalau mau ikut mengetes skenario tanpa komponen tersebut.</>,
            <>カンマ区切りで候補容量を入力します。蓄電池・バイオマス・ディーゼルに <code>0</code> を含めると、その設備なしの組み合わせも比較できます。</>,
          )}
        </p>

        <div className="fld">
          <div className="label-row">
            <label htmlFor="sw-pv">Ukuran PV (kWp)</label>
            <span className="unit tabular-nums">{pvVals.length} nilai</span>
          </div>
          <input id="sw-pv" type="text" value={pvText} onChange={(e) => setPvText(e.target.value)} placeholder="300, 500, 700" />
        </div>

        <div className="fld">
          <div className="label-row">
            <label htmlFor="sw-bess">Kapasitas BESS (kWh)</label>
            <span className="unit tabular-nums">{bessVals.length} nilai</span>
          </div>
          <input id="sw-bess" type="text" value={bessText} onChange={(e) => setBessText(e.target.value)} placeholder="0, 400, 800" />
        </div>

        <div className="fld">
          <div className="label-row">
            <label htmlFor="sw-bio">Kapasitas Biomass (kW)</label>
            <span className="unit tabular-nums">{bioVals.length} nilai</span>
          </div>
          <input id="sw-bio" type="text" value={bioText} onChange={(e) => setBioText(e.target.value)} placeholder="0, 250" />
        </div>

        <div className="fld">
          <div className="label-row">
            <label htmlFor="sw-diesel">Kapasitas Diesel Generator (kW)</label>
            <span className="unit tabular-nums">{dieselVals.length} nilai</span>
          </div>
          <input id="sw-diesel" type="text" value={dieselText} onChange={(e) => setDieselText(e.target.value)} placeholder="0" />
        </div>

        <div className="fld">
          <label htmlFor="sw-inv">Ukuran Inverter PV</label>
          <select id="sw-inv" value={invMode} onChange={(e) => setInvMode(e.target.value as "keep_dc_ac_ratio" | "fixed")}>
            <option value="keep_dc_ac_ratio">Ikuti Rasio DC/AC Dasar</option>
            <option value="fixed">Tetap (Sesuai Desain Saat Ini)</option>
          </select>
        </div>

        <div className="grid-2">
          <div className="fld">
            <label htmlFor="sw-unmet">Maks. Unmet Load (%)</label>
            <input id="sw-unmet" type="number" min={0} max={100} step={1} value={maxUnmetPct} onChange={(e) => setMaxUnmetPct(e.target.value)} />
          </div>
          <div className="fld">
            <label htmlFor="sw-ren">Min. Terbarukan (%)</label>
            <input id="sw-ren" type="number" min={0} max={100} step={1} value={minRenPct} onChange={(e) => setMinRenPct(e.target.value)} />
          </div>
        </div>

        <div className="fld">
          <label htmlFor="sw-sort">Urutkan Peringkat Berdasarkan</label>
          <select id="sw-sort" value={sortBy} onChange={(e) => setSortBy(e.target.value as SweepSortBy)}>
            <option value="lcoe_asc">LCOE Terendah</option>
            <option value="total_npc_asc">Total NPC Terendah</option>
            <option value="npv_desc">NPV Tertinggi</option>
            <option value="irr_desc">IRR Tertinggi</option>
            <option value="renewable_fraction_desc">Pangsa Terbarukan Tertinggi</option>
          </select>
        </div>

        <label className="check-row" style={{ marginTop: "0.5rem" }}>
          <input type="checkbox" checked={feasibleFirst} onChange={(e) => setFeasibleFirst(e.target.checked)} />
          <span>Utamakan konfigurasi yang memenuhi batasan di peringkat atas</span>
        </label>

        <div className="fld">
          <span className={`chip ${totalCombos > maxCombos ? "chip-unviable" : ""}`}>
            Total: <span className="tabular-nums">{totalCombos}</span> / {maxCombos} kombinasi ({project.simulation.multi_year_mode})
          </span>
          {axisError && <p className="err">{axisError}</p>}
        </div>

        <div className="row">
          <button
            type="button"
            className="btn primary"
            disabled={running || Boolean(axisError)}
            onClick={() => void handleRunSweep()}
          >
            {running
              ? tr(lang, "Running Sweep...", "Lagi Menjalankan Sizing...", "スイープ計算中...")
              : tr(lang, "Run Sizing Sweep", "Gas Cari Ukuran Optimal", "容量スイープを実行")}
          </button>
          {running && activeJobId && (
            <button type="button" className="btn danger-ghost" onClick={() => void handleCancelSweep()}>
              {tr(lang, "Cancel Sweep", "Batalkan", "キャンセル")}
            </button>
          )}
        </div>
      </section>

      <section aria-labelledby="h-sweep-out">
        <h2 id="h-sweep-out" style={{ marginTop: 0 }}>
          {tr(lang, "Sizing Sweep Results", "Hasil Pencarian Ukuran Optimal", "容量スイープ結果")}
        </h2>

        {running && (
          <div className="state" role="status">
            <h3>{tr(lang, "Processing Sizing Sweep", "Lagi Memproses Kombinasi Ukuran", "組み合わせシミュレーション処理中")}</h3>
            <p>{progressText}</p>
            <div className="progress-track" aria-label={tr(lang, "Sweep progress", "Progres sapuan kombinasi", "スイープ進捗")}>
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="note tabular-nums">{progress}% {tr(lang, "completed", "selesai", "完了")}</p>
            {slow && (
              <div style={{ marginTop: "1rem", padding: "0.875rem", background: "var(--surface-subtle)", borderRadius: "var(--radius-md)" }}>
                <p className="note" style={{ color: "var(--text)", fontWeight: 600 }}>
                  {tr(lang, "The calculation engine may be waking up from sleep mode.", "Mesin hitung sepertinya lagi bangun dari mode tidur.", "計算エンジンがスリープ状態から起動しています。")}
                </p>
                <p className="note">{slowEngineNoteFor(lang)}</p>
              </div>
            )}
          </div>
        )}

        {!running && errors.length > 0 && (
          <div className="state bad" role="alert">
            <h3>{tr(lang, "Sizing sweep did not succeed", "Pencarian ukuran belum berhasil", "スイープ計算を実行できませんでした")}</h3>
            <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            <div className="row" style={{ borderTop: 0, paddingTop: "0.5rem" }}>
              <button type="button" className="btn ghost" onClick={() => void handleRunSweep()}>
                {tr(lang, "Re-run Sweep", "Coba Jalankan Lagi", "再実行する")}
              </button>
            </div>
          </div>
        )}

        {!running && errors.length === 0 && !sweepResult && (
          <div className="state">
            <h3>{tr(lang, "No sizing sweep results yet", "Belum ada hasil pencarian ukuran nih", "まだスイープ結果がありません")}</h3>
            <p>
              {tr(
                lang,
                <>Set your candidate PV, BESS, and Biomass sizes on the left, then press <strong>&ldquo;Run Sizing Sweep&rdquo;</strong> to find the most cost-effective configuration.</>,
                <>Isi kandidat kapasitas PV, BESS, dan Biomass di panel kiri, terus klik <strong>&ldquo;Gas Cari Ukuran Optimal&rdquo;</strong> buat nemuin kombinasi paling hemat!</>,
                <>左側でPV・蓄電池・バイオマスの候補容量を指定し、<strong>「容量スイープを実行」</strong>を押すと最も経済的な構成を探索します。</>,
              )}
            </p>
          </div>
        )}

        {!running && sweepResult && (
          <>
            {winner && (
              <div className="card" style={{ marginBottom: "1rem" }}>
                <div className="card-header">
                  <div>
                    <span className="eyebrow">Peringkat #1 ({winner.feasible ? "Memenuhi Batasan" : "Di Luar Batasan"})</span>
                    <h3>{winner.combination_id}</h3>
                  </div>
                  <div className="actions-inline">
                    <ViabilityChip status={winner.finance.viability_status} />
                    <button type="button" className="btn btn-sm primary" onClick={() => handleApplyCombo(winner)}>
                      Terapkan ke Proyek Aktif
                    </button>
                    <button type="button" className="btn btn-sm ghost" onClick={() => handleSaveScenario(winner)}>
                      Simpan sebagai Skenario Baru
                    </button>
                  </div>
                </div>
                <div className="kpis">
                  <div className="kpi">
                    <span>Ukuran Sistem</span>
                    <b style={{ fontSize: "1.05rem" }}>
                      {formatNumber(winner.sizing.pv_capacity_kwp, lang, 0)} kWp | {formatNumber(winner.sizing.bess_nominal_capacity_kwh, lang, 0)} kWh | {formatNumber(winner.sizing.biomass_rated_capacity_kw, lang, 0)} kW Bio | {formatNumber(winner.sizing.diesel_rated_capacity_kw ?? 0, lang, 0)} kW Diesel
                    </b>
                  </div>
                  <div className="kpi">
                    <span>LCOE</span>
                    <b>{formatCurrency(winner.finance.lcoe, winner.finance.currency_code, lang, 0)}/kWh</b>
                  </div>
                  <div className="kpi">
                    <span>NPV</span>
                    <b className={winner.finance.npv >= 0 ? "pos" : "neg"}>
                      {formatCompactCurrency(winner.finance.npv, winner.finance.currency_code, lang)}
                    </b>
                  </div>
                  <div className="kpi">
                    <span>Pangsa Terbarukan</span>
                    <b className="pos">{formatPercent(winner.technical.renewable_fraction, lang, 1)}</b>
                  </div>
                </div>
              </div>
            )}

            <div className="chart-card" style={{ marginBottom: "1rem" }}>
              <div className="chart-head">
                <h3>Kurva Pareto: LCOE vs Pangsa Energi Terbarukan</h3>
                <span className="chip tabular-nums">{sweepResult.feasible_count} / {sweepResult.total_combinations} layak</span>
              </div>
              <EChart
                option={paretoOption}
                height={300}
                ariaLabel="Grafik sebar Pareto membandingkan LCOE terhadap pangsa energi terbarukan seluruh kombinasi sapuan."
              />
            </div>

            <div className="card">
              <div className="card-header">
                <h3>Tabel Peringkat Kombinasi ({displayedCombos.length})</h3>
                <div className="actions-inline">
                  <label className="check-row" style={{ minHeight: "2.25rem" }}>
                    <input type="checkbox" checked={onlyFeasible} onChange={(e) => setOnlyFeasible(e.target.checked)} />
                    <span>Hanya yang layak batasan</span>
                  </label>
                  <select
                    aria-label="Urutkan tabel hasil sapuan"
                    value={tableSort}
                    onChange={(e) => setTableSort(e.target.value as SweepSortBy)}
                    style={{ width: "auto", minHeight: "2.25rem" }}
                  >
                    <option value="lcoe_asc">Urut: LCOE</option>
                    <option value="total_npc_asc">Urut: NPC</option>
                    <option value="npv_desc">Urut: NPV</option>
                    <option value="irr_desc">Urut: IRR</option>
                    <option value="renewable_fraction_desc">Urut: Terbarukan</option>
                  </select>
                  <button type="button" className="btn btn-sm ghost" onClick={handleExportCsv}>
                    Ekspor CSV Hasil Sapuan
                  </button>
                </div>
              </div>

              <div className="tw" tabIndex={0} role="region" aria-label="Tabel hasil sapuan kombinasi, bisa digulir">
                <table>
                  <caption>Hasil simulasi seluruh kombinasi ukuran PV, BESS, Biomass, dan Diesel Generator.</caption>
                  <thead>
                    <tr>
                      <th scope="col">#</th>
                      <th scope="col">Kombinasi</th>
                      <th scope="col">Status</th>
                      <th scope="col">LCOE</th>
                      <th scope="col">Total NPC</th>
                      <th scope="col">NPV</th>
                      <th scope="col">IRR</th>
                      <th scope="col">Terbarukan</th>
                      <th scope="col">Unmet</th>
                      <th scope="col">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedCombos.map((c) => (
                      <tr key={c.combination_id}>
                        <th scope="row">{c.rank}</th>
                        <td>
                          <strong>{c.combination_id}</strong>
                          <span className="sub">
                            {c.feasible ? "Memenuhi batasan" : `Gagal: ${c.infeasible_reasons.join(", ")}`}
                          </span>
                        </td>
                        <td><ViabilityChip status={c.finance.viability_status} /></td>
                        <td>{formatCurrency(c.finance.lcoe, c.finance.currency_code, lang, 0)}</td>
                        <td>{formatCompactCurrency(c.finance.total_npc, c.finance.currency_code, lang)}</td>
                        <td className={c.finance.npv >= 0 ? "num-pos" : "num-neg"}>
                          {formatCompactCurrency(c.finance.npv, c.finance.currency_code, lang)}
                        </td>
                        <td>{c.finance.irr !== null ? formatPercent(c.finance.irr, lang, 1) : "-"}</td>
                        <td>{formatPercent(c.technical.renewable_fraction, lang, 1)}</td>
                        <td>{formatPercent(c.technical.unmet_load_fraction, lang, 1)}</td>
                        <td>
                          <div className="actions-inline">
                            <button type="button" className="btn btn-sm primary" onClick={() => handleApplyCombo(c)}>
                              Terapkan
                            </button>
                            <button type="button" className="btn btn-sm ghost" onClick={() => handleSaveScenario(c)}>
                              Simpan Skenario
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="note" style={{ marginTop: "0.75rem" }}>
                Setelah menekan <strong>Terapkan</strong>, buka <Link href={`/hybrid/${project.id}/run`}>Halaman 7 (Jalankan)</Link> untuk menghasilkan deret 8.760 jam penuh dan memperbarui laporan PDF/Excel.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
