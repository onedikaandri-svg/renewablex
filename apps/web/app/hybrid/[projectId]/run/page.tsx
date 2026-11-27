"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useRef, useState } from "react";
import HybridShell from "@/components/hybrid/HybridShell";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import { translateDetailText } from "@/lib/errors-id";
import { slowEngineNoteFor, formatNumber, formatPercent } from "@/lib/format";
import { getHybridJob, runHybridSimulate, submitHybridJob } from "@/lib/hybrid-api";
import { saveSimulationResult } from "@/lib/hybrid-storage";
import { validateSystemTopology } from "@/lib/hybrid-topology";
import type { MultiYearMode } from "@/lib/hybrid-types";
import { tr, usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

export default function HybridRunPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const router = useRouter();
  const { project, result, setResult, ready, updateProject } = useHybridProject(projectId);
  const { pushToast } = useToast();
  const { lang } = usePreferences();

  const [running, setRunning] = useState(false);
  const [slow, setSlow] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stepLabel, setStepLabel] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!running) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [running]);

  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  const validation = useMemo(() => {
    if (!project) return { valid: true, errors: [], warnings: [] };
    return validateSystemTopology(project);
  }, [project]);

  if (!ready) {
    return (
      <div className="state">
        <p>{tr(lang, "Loading project...", "Lagi memuat proyek...", "プロジェクトを読み込み中...")}</p>
      </div>
    );
  }
  if (!project) return <MissingProjectState />;

  async function handleRun() {
    if (!project || !validation.valid) return;
    setRunning(true);
    setErrors([]);
    setProgress(5);
    setStepLabel(
      tr(
        lang,
        "Sending configuration to calculation engine...",
        "Mengirim konfigurasi ke mesin hitung...",
        "計算エンジンへ設定を送信中...",
      ),
    );

    try {
      if (project.simulation.multi_year_mode === "scaled_year_1") {
        setStepLabel(
          tr(
            lang,
            "Running Year 1 8,760-hour simulation and financial analysis...",
            "Menghitung simulasi 8.760 jam Tahun 1 dan arus kas proyek...",
            "1年目の8,760時間シミュレーションおよび財務分析を実行中...",
          ),
        );
        setProgress(35);
        const res = await runHybridSimulate(project);
        if (cancelledRef.current) return;
        saveSimulationResult(project.id, res, project);
        setResult(res);
        setProgress(100);
        setStepLabel(tr(lang, "Simulation completed.", "Simulasi beres!", "シミュレーション完了。"));
        pushToast(
          tr(
            lang,
            "Hybrid simulation completed.",
            "Mantap! Simulasi hybrid beres dihitung.",
            "ハイブリッドシミュレーションが完了しました。",
          ),
          "success",
        );
        router.push(`/hybrid/${project.id}/results`);
      } else {
        const created = await submitHybridJob(project);
        setProgress(Math.max(created.progress_percent, 5));
        setStepLabel(created.current_step_label);

        while (!cancelledRef.current) {
          await new Promise((r) => setTimeout(r, 600));
          if (cancelledRef.current) return;
          const job = await getHybridJob(created.job_id);
          setProgress(job.progress_percent);
          setStepLabel(job.current_step_label);

          if (job.status === "completed" && job.result) {
            saveSimulationResult(project.id, job.result, project);
            setResult(job.result);
            pushToast(
              tr(
                lang,
                "Full multi-year simulation completed.",
                "Mantap! Simulasi multi-tahun penuh sudah beres.",
                "全期間マルチイヤーシミュレーションが完了しました。",
              ),
              "success",
            );
            router.push(`/hybrid/${project.id}/results`);
            return;
          }
          if (job.status === "failed") {
            const msg = job.error
              ? translateDetailText(job.error.msg)
              : tr(
                  lang,
                  "Simulation failed in calculation engine.",
                  "Simulasi gagal di mesin hitung.",
                  "計算エンジンでのシミュレーションに失敗しました。",
                );
            setErrors([msg]);
            return;
          }
        }
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors([...err.problems.general, ...Object.values(err.problems.fields)]);
      } else {
        setErrors([
          err instanceof Error
            ? err.message
            : tr(
                lang,
                "An error occurred while running the simulation.",
                "Ada kendala saat menjalankan simulasi.",
                "シミュレーションの実行中にエラーが発生しました。",
              ),
        ]);
      }
    } finally {
      if (!cancelledRef.current) setRunning(false);
    }
  }

  const mode = project.simulation.multi_year_mode;

  return (
    <HybridShell
      project={project}
      activeStep="run"
      title={tr(
        lang,
        "Review & Run Simulation",
        "Cek Ringkasan & Jalankan Simulasi",
        "設定確認・シミュレーション実行",
      )}
      subtitle={tr(
        lang,
        "Review your project configuration summary, choose the multi-year calculation mode, and run the simulation on the engine.",
        "Cek dulu ringkasan proyekmu, pilih mode hitung multi-tahun, terus gas jalankan simulasi di mesin hitung!",
        "プロジェクト設定の概要を確認し、複数年の計算モードを選択してシミュレーションを実行します。",
      )}
      result={result}
    >
      <div className="grid-hybrid">
        <section className="card" aria-labelledby="h-run-cfg">
          <div className="card-header">
            <h2 id="h-run-cfg">
              {tr(lang, "Configuration Summary", "Ringkasan Konfigurasi", "設定サマリー")}
            </h2>
          </div>

          {!validation.valid && (
            <div className="state bad" role="alert" style={{ marginBottom: "1rem" }}>
              <h3>
                {tr(
                  lang,
                  "System topology is not ready for simulation",
                  "Topologi sistem belum siap disimulasikan nih",
                  "システム構成に未解決のエラーがあります",
                )}
              </h3>
              <ul>
                {validation.errors.map((err, i) => (
                  <li key={i}>{lang === "id" ? err.messageId : err.messageEn}</li>
                ))}
              </ul>
              <div className="row" style={{ borderTop: 0, paddingTop: "0.5rem", marginTop: "0.25rem" }}>
                <Link href={`/hybrid/${project.id}/system`} className="btn btn-sm primary">
                  {tr(
                    lang,
                    "Fix in System Design (Step 4)",
                    "Perbaiki di Desain Sistem (Langkah 4)",
                    "システム設計（ステップ4）で修正する",
                  )}
                </Link>
              </div>
            </div>
          )}

          {validation.warnings.length > 0 && (
            <div className="warn" role="note">
              <h3>{tr(lang, "Topology Notes", "Catatan Topologi", "構成に関する注記")}</h3>
              <ul>
                {validation.warnings.map((w, i) => (
                  <li key={i}>{lang === "id" ? w.messageId : w.messageEn}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="note">
            <strong>{tr(lang, "Location:", "Lokasi:", "地点:")}</strong> {project.project.latitude}, {project.project.longitude} ({project.project.timezone})
          </p>
          <p className="note">
            <strong>{tr(lang, "Load:", "Profil Beban:", "電力負荷:")}</strong>{" "}
            {project.load_profile.mode === "csv"
              ? tr(
                  lang,
                  `Uploaded CSV (${project.load_profile.csv_filename || "not selected"})`,
                  `File CSV (${project.load_profile.csv_filename || "belum dipilih"})`,
                  `CSVアップロード (${project.load_profile.csv_filename || "未選択"})`,
                )
              : tr(
                  lang,
                  `Synthetic ${formatNumber(project.load_profile.base_load_kw, lang, 0)} to ${formatNumber(project.load_profile.peak_load_kw, lang, 0)} kW`,
                  `Sintetis ${formatNumber(project.load_profile.base_load_kw, lang, 0)} sampai ${formatNumber(project.load_profile.peak_load_kw, lang, 0)} kW`,
                  `合成プロファイル ${formatNumber(project.load_profile.base_load_kw, lang, 0)} 〜 ${formatNumber(project.load_profile.peak_load_kw, lang, 0)} kW`,
                )}
          </p>
          <p className="note">
            <strong>PV:</strong> {formatNumber(project.components.pv.capacity_kwp, lang, 0)} kWp ({project.components.pv.model})
          </p>
          <p className="note">
            <strong>BESS:</strong>{" "}
            {project.components.bess.enabled
              ? `${formatNumber(project.components.bess.nominal_capacity_kwh, lang, 0)} kWh (${formatNumber(project.components.bess.max_charge_kw, lang, 0)} kW)`
              : tr(lang, "Disabled", "Nonaktif", "無効")}
          </p>
          <p className="note">
            <strong>Biomass:</strong>{" "}
            {project.components.biomass.enabled
              ? `${formatNumber(project.components.biomass.rated_capacity_kw, lang, 0)} kW (${project.components.biomass.fuel_preset})`
              : tr(lang, "Disabled", "Nonaktif", "無効")}
          </p>
          <p className="note">
            <strong>Diesel Generator:</strong>{" "}
            {project.components.diesel?.enabled
              ? `${formatNumber(project.components.diesel.rated_capacity_kw, lang, 0)} kW (${tr(lang, "non-renewable", "non-terbarukan", "非再エネ")})`
              : tr(lang, "Disabled", "Nonaktif", "無効")}
          </p>
          <p className="note">
            <strong>{tr(lang, "EMS Strategy:", "Strategi EMS:", "EMS戦略:")}</strong> {project.simulation.dispatch_strategy}
          </p>
          <p className="note">
            <strong>{tr(lang, "Economics:", "Ekonomi:", "経済条件:")}</strong>{" "}
            {tr(
              lang,
              `${project.simulation.project_lifetime_years}-year lifetime, WACC ${formatPercent(project.finance.discount_rate, lang, 1)}, tariff ${formatNumber(project.finance.electricity_tariff_per_kwh, lang, 0)} ${project.project.currency_code}/kWh`,
              `Umur ${project.simulation.project_lifetime_years} tahun, WACC ${formatPercent(project.finance.discount_rate, lang, 1)}, tarif ${formatNumber(project.finance.electricity_tariff_per_kwh, lang, 0)} ${project.project.currency_code}/kWh`,
              `事業期間 ${project.simulation.project_lifetime_years}年、WACC ${formatPercent(project.finance.discount_rate, lang, 1)}、電力単価 ${formatNumber(project.finance.electricity_tariff_per_kwh, lang, 0)} ${project.project.currency_code}/kWh`,
            )}
          </p>

          <fieldset>
            <legend>{tr(lang, "Multi-Year Simulation Mode", "Mode Hitung Multi-Tahun", "複数年シミュレーションモード")}</legend>
            <label className="check-row">
              <input
                type="radio"
                name="multi-year-mode"
                checked={mode === "scaled_year_1"}
                onChange={() =>
                  updateProject((p) => ({
                    ...p,
                    simulation: { ...p.simulation, multi_year_mode: "scaled_year_1" as MultiYearMode },
                  }))
                }
              />
              <span>
                {tr(
                  lang,
                  <>Fast Scaled Year 1 Mode (<code>scaled_year_1</code>, Default)</>,
                  <>Mode Cepat Proyeksi Tahun 1 (<code>scaled_year_1</code>, Rekomendasi)</>,
                  <>高速1年目スケールモード (<code>scaled_year_1</code>、標準)</>,
                )}
              </span>
            </label>
            <label className="check-row">
              <input
                type="radio"
                name="multi-year-mode"
                checked={mode === "full_hourly"}
                onChange={() =>
                  updateProject((p) => ({
                    ...p,
                    simulation: { ...p.simulation, multi_year_mode: "full_hourly" as MultiYearMode },
                  }))
                }
              />
              <span>
                {tr(
                  lang,
                  <>Full {project.simulation.project_lifetime_years}-Year Hourly Simulation via Async Job (<code>full_hourly</code>)</>,
                  <>Simulasi Penuh {project.simulation.project_lifetime_years} Tahun per Jam via Job Asinkron (<code>full_hourly</code>)</>,
                  <>全{project.simulation.project_lifetime_years}年間・時間別フルシミュレーション (<code>full_hourly</code>)</>,
                )}
              </span>
            </label>
          </fieldset>

          <div className="row">
            <button type="button" className="btn primary" disabled={running || !validation.valid} onClick={() => void handleRun()}>
              {running
                ? tr(lang, "Calculating...", "Lagi Menghitung...", "計算実行中...")
                : tr(lang, "Run Simulation", "Gas Jalankan Simulasi", "シミュレーションを実行")}
            </button>
            {result && (
              <Link href={`/hybrid/${project.id}/results`} className="btn ghost">
                {tr(lang, "Open Last Results Dashboard", "Lihat Hasil Terakhir", "前回の結果ダッシュボードを開く")}
              </Link>
            )}
          </div>
        </section>

        <section aria-labelledby="h-run-status">
          <h2 id="h-run-status" style={{ marginTop: 0 }}>
            {tr(lang, "Simulation Execution Status", "Status Eksekusi Simulasi", "シミュレーション実行ステータス")}
          </h2>

          {running && (
            <div className="state" role="status">
              <h3>{tr(lang, "Processing Hybrid Simulation", "Lagi Memproses Simulasi Hybrid", "ハイブリッドシミュレーション処理中")}</h3>
              <p>{stepLabel}</p>
              <div className="progress-track" aria-label={tr(lang, "Simulation progress", "Progres simulasi", "計算進捗")}>
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="note tabular-nums">
                {progress}% {tr(lang, "completed", "selesai", "完了")}
              </p>
              {slow && (
                <div style={{ marginTop: "1rem", padding: "0.875rem", background: "var(--surface-subtle)", borderRadius: "var(--radius-md)" }}>
                  <p className="note" style={{ color: "var(--text)", fontWeight: 600 }}>
                    {tr(
                      lang,
                      "The calculation engine may be waking up from sleep mode.",
                      "Mesin hitung sepertinya lagi bangun dari mode tidur.",
                      "計算エンジンがスリープ状態から起動しています。",
                    )}
                  </p>
                  <p className="note">{slowEngineNoteFor(lang)}</p>
                </div>
              )}
            </div>
          )}

          {!running && errors.length > 0 && (
            <div className="state bad" role="alert">
              <h3>{tr(lang, "Simulation did not succeed", "Simulasi belum berhasil nih", "シミュレーションを実行できませんでした")}</h3>
              <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              <p>
                {tr(
                  lang,
                  'Fix the related parameters, then press "Run Simulation" again.',
                  'Cek dan perbaiki parameter yang terkait, terus klik "Gas Jalankan Simulasi" lagi ya.',
                  '関連するパラメータを修正してから、もう一度「シミュレーションを実行」を押してください。',
                )}
              </p>
            </div>
          )}

          {!running && errors.length === 0 && (
            <div className="state">
              <h3>{tr(lang, "Ready to run", "Siap digas!", "実行準備完了")}</h3>
              <p>
                {tr(
                  lang,
                  <>
                    Press <strong>&ldquo;Run Simulation&rdquo;</strong> to execute the Python hybrid calculation engine (8,760-hour power balance and multi-year cash flow). Once finished, you will be redirected to the Results Dashboard.
                  </>,
                  <>
                    Klik tombol <strong>&ldquo;Gas Jalankan Simulasi&rdquo;</strong> di kiri buat mulai hitung neraca energi 8.760 jam dan arus kas multi-tahun di mesin Python. Begitu beres, kamu otomatis dibawa ke Dasbor Hasil!
                  </>,
                  <>
                    左側の<strong>「シミュレーションを実行」</strong>ボタンを押すと、Python計算エンジンで8,760時間の電力収支と複数年キャッシュフローを計算します。完了後、自動的に結果ダッシュボードへ移動します。
                  </>,
                )}
              </p>
            </div>
          )}
        </section>
      </div>
    </HybridShell>
  );
}
