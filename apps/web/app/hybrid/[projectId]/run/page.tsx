"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useRef, useState } from "react";
import HybridShell from "@/components/hybrid/HybridShell";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import { translateDetailText } from "@/lib/errors-id";
import { SLOW_ENGINE_NOTE, formatNumber, formatPercent } from "@/lib/format";
import { getHybridJob, runHybridSimulate, submitHybridJob } from "@/lib/hybrid-api";
import { saveSimulationResult } from "@/lib/hybrid-storage";
import { validateSystemTopology } from "@/lib/hybrid-topology";
import type { MultiYearMode } from "@/lib/hybrid-types";
import { usePreferences } from "@/lib/preferences";
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
        <p>{lang === "en" ? "Loading project..." : "Memuat proyek..."}</p>
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
      lang === "en"
        ? "Sending configuration to calculation engine..."
        : "Mengirim konfigurasi ke mesin hitung...",
    );

    try {
      if (project.simulation.multi_year_mode === "scaled_year_1") {
        setStepLabel(
          lang === "en"
            ? "Running Year 1 8,760-hour simulation and financial analysis..."
            : "Menjalankan simulasi 8.760 jam Tahun 1 dan analisis keuangan...",
        );
        setProgress(35);
        const res = await runHybridSimulate(project);
        if (cancelledRef.current) return;
        saveSimulationResult(project.id, res, project);
        setResult(res);
        setProgress(100);
        setStepLabel(lang === "en" ? "Simulation completed." : "Simulasi selesai.");
        pushToast(
          lang === "en"
            ? "Hybrid simulation completed."
            : "Simulasi hybrid berhasil diselesaikan.",
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
              lang === "en"
                ? "Full multi-year simulation completed."
                : "Simulasi multi-tahun penuh selesai.",
              "success",
            );
            router.push(`/hybrid/${project.id}/results`);
            return;
          }
          if (job.status === "failed") {
            const msg = job.error
              ? translateDetailText(job.error.msg)
              : lang === "en"
                ? "Simulation failed in calculation engine."
                : "Simulasi gagal di mesin hitung.";
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
            : lang === "en"
              ? "An error occurred while running the simulation."
              : "Terjadi kesalahan saat menjalankan simulasi.",
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
      title={lang === "en" ? "Review & Run Simulation" : "Ringkasan & Jalankan Simulasi"}
      subtitle={
        lang === "en"
          ? "Review your project configuration summary, choose the multi-year calculation mode, and run the simulation on the engine."
          : "Periksa ringkasan konfigurasi proyek, pilih mode kalkulasi multi-tahun, lalu jalankan simulasi pada mesin hitung."
      }
      result={result}
    >
      <div className="grid-hybrid">
        <section className="card" aria-labelledby="h-run-cfg">
          <div className="card-header">
            <h2 id="h-run-cfg">{lang === "en" ? "Configuration Summary" : "Ringkasan Konfigurasi"}</h2>
          </div>

          {!validation.valid && (
            <div className="state bad" role="alert" style={{ marginBottom: "1rem" }}>
              <h3>
                {lang === "en"
                  ? "System topology is not ready for simulation"
                  : "Topologi sistem belum siap disimulasikan"}
              </h3>
              <ul>
                {validation.errors.map((err, i) => (
                  <li key={i}>{lang === "en" ? err.messageEn : err.messageId}</li>
                ))}
              </ul>
              <div className="row" style={{ borderTop: 0, paddingTop: "0.5rem", marginTop: "0.25rem" }}>
                <Link href={`/hybrid/${project.id}/system`} className="btn btn-sm primary">
                  {lang === "en" ? "Fix in System Design (Step 4)" : "Perbaiki di Desain Sistem (Halaman 4)"}
                </Link>
              </div>
            </div>
          )}

          {validation.warnings.length > 0 && (
            <div className="warn" role="note">
              <h3>{lang === "en" ? "Topology Notes" : "Catatan Topologi"}</h3>
              <ul>
                {validation.warnings.map((w, i) => (
                  <li key={i}>{lang === "en" ? w.messageEn : w.messageId}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="note">
            <strong>{lang === "en" ? "Location:" : "Lokasi:"}</strong> {project.project.latitude}, {project.project.longitude} ({project.project.timezone})
          </p>
          <p className="note">
            <strong>{lang === "en" ? "Load:" : "Beban:"}</strong>{" "}
            {project.load_profile.mode === "csv"
              ? lang === "en"
                ? `Uploaded CSV (${project.load_profile.csv_filename || "not selected"})`
                : `CSV unggahan (${project.load_profile.csv_filename || "belum dipilih"})`
              : lang === "en"
                ? `Synthetic ${formatNumber(project.load_profile.base_load_kw, lang, 0)} to ${formatNumber(project.load_profile.peak_load_kw, lang, 0)} kW`
                : `Sintetis ${formatNumber(project.load_profile.base_load_kw, lang, 0)} - ${formatNumber(project.load_profile.peak_load_kw, lang, 0)} kW`}
          </p>
          <p className="note">
            <strong>PV:</strong> {formatNumber(project.components.pv.capacity_kwp, lang, 0)} kWp ({project.components.pv.model})
          </p>
          <p className="note">
            <strong>BESS:</strong>{" "}
            {project.components.bess.enabled
              ? `${formatNumber(project.components.bess.nominal_capacity_kwh, lang, 0)} kWh (${formatNumber(project.components.bess.max_charge_kw, lang, 0)} kW)`
              : lang === "en"
                ? "Disabled"
                : "Nonaktif"}
          </p>
          <p className="note">
            <strong>Biomass:</strong>{" "}
            {project.components.biomass.enabled
              ? `${formatNumber(project.components.biomass.rated_capacity_kw, lang, 0)} kW (${project.components.biomass.fuel_preset})`
              : lang === "en"
                ? "Disabled"
                : "Nonaktif"}
          </p>
          <p className="note">
            <strong>Diesel Generator:</strong>{" "}
            {project.components.diesel?.enabled
              ? `${formatNumber(project.components.diesel.rated_capacity_kw, lang, 0)} kW (${lang === "en" ? "non-renewable" : "non-terbarukan"})`
              : lang === "en"
                ? "Disabled"
                : "Nonaktif"}
          </p>
          <p className="note">
            <strong>{lang === "en" ? "EMS Strategy:" : "Strategi EMS:"}</strong> {project.simulation.dispatch_strategy}
          </p>
          <p className="note">
            <strong>{lang === "en" ? "Economics:" : "Ekonomi:"}</strong>{" "}
            {lang === "en"
              ? `${project.simulation.project_lifetime_years}-year lifetime, WACC ${formatPercent(project.finance.discount_rate, lang, 1)}, tariff ${formatNumber(project.finance.electricity_tariff_per_kwh, lang, 0)} ${project.project.currency_code}/kWh`
              : `Umur ${project.simulation.project_lifetime_years} tahun, WACC ${formatPercent(project.finance.discount_rate, lang, 1)}, tarif ${formatNumber(project.finance.electricity_tariff_per_kwh, lang, 0)} ${project.project.currency_code}/kWh`}
          </p>

          <fieldset>
            <legend>{lang === "en" ? "Multi-Year Simulation Mode" : "Mode Simulasi Multi-Tahun"}</legend>
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
                {lang === "en" ? (
                  <>
                    Fast Scaled Year 1 Mode (<code>scaled_year_1</code>, Default)
                  </>
                ) : (
                  <>
                    Mode Cepat Tahun 1 Terskalakan (<code>scaled_year_1</code>, Bawaan)
                  </>
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
                {lang === "en" ? (
                  <>
                    Full {project.simulation.project_lifetime_years}-Year Hourly Simulation via Async Job (<code>full_hourly</code>)
                  </>
                ) : (
                  <>
                    Simulasi Penuh {project.simulation.project_lifetime_years} Tahun via Job Asinkron (<code>full_hourly</code>)
                  </>
                )}
              </span>
            </label>
          </fieldset>

          <div className="row">
            <button type="button" className="btn primary" disabled={running || !validation.valid} onClick={() => void handleRun()}>
              {running
                ? lang === "en"
                  ? "Calculating..."
                  : "Sedang Menghitung..."
                : lang === "en"
                  ? "Run Simulation"
                  : "Jalankan Simulasi"}
            </button>
            {result && (
              <Link href={`/hybrid/${project.id}/results`} className="btn ghost">
                {lang === "en" ? "Open Last Results Dashboard" : "Buka Dasbor Hasil Terakhir"}
              </Link>
            )}
          </div>
        </section>

        <section aria-labelledby="h-run-status">
          <h2 id="h-run-status" style={{ marginTop: 0 }}>
            {lang === "en" ? "Simulation Execution Status" : "Status Eksekusi Simulasi"}
          </h2>

          {running && (
            <div className="state" role="status">
              <h3>{lang === "en" ? "Processing Hybrid Simulation" : "Memproses Simulasi Hybrid"}</h3>
              <p>{stepLabel}</p>
              <div className="progress-track" aria-label={lang === "en" ? "Simulation progress" : "Progres simulasi"}>
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="note tabular-nums">
                {progress}% {lang === "en" ? "completed" : "selesai"}
              </p>
              {slow && (
                <div style={{ marginTop: "1rem", padding: "0.875rem", background: "var(--surface-subtle)", borderRadius: "var(--radius-md)" }}>
                  <p className="note" style={{ color: "var(--text)", fontWeight: 600 }}>
                    {lang === "en"
                      ? "The calculation engine may be waking up from sleep mode."
                      : "Mesin hitung mungkin sedang bangun dari mode tidur."}
                  </p>
                  <p className="note">{SLOW_ENGINE_NOTE}</p>
                </div>
              )}
            </div>
          )}

          {!running && errors.length > 0 && (
            <div className="state bad" role="alert">
              <h3>{lang === "en" ? "Simulation did not succeed" : "Simulasi belum berhasil"}</h3>
              <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              <p>
                {lang === "en"
                  ? 'Fix the related parameters, then press "Run Simulation" again.'
                  : 'Perbaiki parameter terkait, lalu tekan "Jalankan Simulasi" kembali.'}
              </p>
            </div>
          )}

          {!running && errors.length === 0 && (
            <div className="state">
              <h3>{lang === "en" ? "Ready to run" : "Siap dijalankan"}</h3>
              <p>
                {lang === "en" ? (
                  <>
                    Press <strong>&ldquo;Run Simulation&rdquo;</strong> to execute the Python hybrid calculation engine (8,760-hour power balance and multi-year cash flow). Once finished, you will be redirected to the Results Dashboard.
                  </>
                ) : (
                  <>
                    Tekan tombol <strong>&ldquo;Jalankan Simulasi&rdquo;</strong> untuk menjalankan mesin hitung hybrid Python (neraca daya 8.760 jam dan arus kas multi-tahun). Setelah selesai, Anda akan diarahkan ke Dasbor Hasil.
                  </>
                )}
              </p>
            </div>
          )}
        </section>
      </div>
    </HybridShell>
  );
}
