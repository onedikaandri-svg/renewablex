"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useRef, useState } from "react";
import HybridShell from "@/components/hybrid/HybridShell";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import { translateDetailText } from "@/lib/errors-id";
import { SLOW_ENGINE_NOTE, formatNumber, formatPercent } from "@/lib/format";
import { getHybridJob, runHybridSimulate, submitHybridJob } from "@/lib/hybrid-api";
import { saveSimulationResult } from "@/lib/hybrid-storage";
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

  if (!ready) return <div className="state"><p>Memuat proyek&hellip;</p></div>;
  if (!project) return <MissingProjectState />;

  async function handleRun() {
    if (!project) return;
    setRunning(true);
    setErrors([]);
    setProgress(5);
    setStepLabel("Mengirim konfigurasi ke mesin hitung...");

    try {
      if (project.simulation.multi_year_mode === "scaled_year_1") {
        setStepLabel("Menjalankan simulasi 8.760 jam Tahun 1 dan analisis keuangan...");
        setProgress(35);
        const res = await runHybridSimulate(project);
        if (cancelledRef.current) return;
        saveSimulationResult(project.id, res);
        setResult(res);
        setProgress(100);
        setStepLabel("Simulasi selesai.");
        pushToast("Simulasi hybrid berhasil diselesaikan.", "success");
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
            saveSimulationResult(project.id, job.result);
            setResult(job.result);
            pushToast("Simulasi multi-tahun penuh selesai.", "success");
            router.push(`/hybrid/${project.id}/results`);
            return;
          }
          if (job.status === "failed") {
            const msg = job.error ? translateDetailText(job.error.msg) : "Simulasi gagal di mesin hitung.";
            setErrors([msg]);
            return;
          }
        }
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors([...err.problems.general, ...Object.values(err.problems.fields)]);
      } else {
        setErrors([err instanceof Error ? err.message : "Terjadi kesalahan saat menjalankan simulasi."]);
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
      subtitle="Periksa ringkasan konfigurasi proyek, pilih mode kalkulasi multi-tahun, lalu jalankan simulasi pada mesin hitung."
      result={result}
    >
      <div className="grid-hybrid">
        <section className="card" aria-labelledby="h-run-cfg">
          <div className="card-header">
            <h2 id="h-run-cfg">Ringkasan Konfigurasi</h2>
          </div>

          <p className="note"><strong>Lokasi:</strong> {project.project.latitude}, {project.project.longitude} ({project.project.timezone})</p>
          <p className="note">
            <strong>Beban:</strong>{" "}
            {project.load_profile.mode === "csv"
              ? `CSV unggahan (${project.load_profile.csv_filename || "belum dipilih"})`
              : `Sintetis ${formatNumber(project.load_profile.base_load_kw, lang, 0)} - ${formatNumber(project.load_profile.peak_load_kw, lang, 0)} kW`}
          </p>
          <p className="note">
            <strong>PV:</strong> {formatNumber(project.components.pv.capacity_kwp, lang, 0)} kWp ({project.components.pv.model})
          </p>
          <p className="note">
            <strong>BESS:</strong>{" "}
            {project.components.bess.enabled
              ? `${formatNumber(project.components.bess.nominal_capacity_kwh, lang, 0)} kWh (${formatNumber(project.components.bess.max_charge_kw, lang, 0)} kW)`
              : "Nonaktif"}
          </p>
          <p className="note">
            <strong>Biomass:</strong>{" "}
            {project.components.biomass.enabled
              ? `${formatNumber(project.components.biomass.rated_capacity_kw, lang, 0)} kW (${project.components.biomass.fuel_preset})`
              : "Nonaktif"}
          </p>
          <p className="note"><strong>Strategi EMS:</strong> {project.simulation.dispatch_strategy}</p>
          <p className="note">
            <strong>Ekonomi:</strong> Umur {project.simulation.project_lifetime_years} tahun, WACC {formatPercent(project.finance.discount_rate, lang, 1)}, tarif {formatNumber(project.finance.electricity_tariff_per_kwh, lang, 0)} {project.project.currency_code}/kWh
          </p>

          <fieldset>
            <legend>Mode Simulasi Multi-Tahun</legend>
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
              <span>Mode Cepat Tahun 1 Terskalakan (<code>scaled_year_1</code>, Bawaan)</span>
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
              <span>Simulasi Penuh {project.simulation.project_lifetime_years} Tahun via Job Asinkron (<code>full_hourly</code>)</span>
            </label>
          </fieldset>

          <div className="row">
            <button type="button" className="btn primary" disabled={running} onClick={() => void handleRun()}>
              {running ? "Sedang Menghitung..." : "Jalankan Simulasi"}
            </button>
            {result && (
              <Link href={`/hybrid/${project.id}/results`} className="btn ghost">
                Buka Dasbor Hasil Terakhir
              </Link>
            )}
          </div>
        </section>

        <section aria-labelledby="h-run-status">
          <h2 id="h-run-status" style={{ marginTop: 0 }}>Status Eksekusi Simulasi</h2>

          {running && (
            <div className="state" role="status">
              <h3>Memproses Simulasi Hybrid</h3>
              <p>{stepLabel}</p>
              <div className="progress-track" aria-label="Progres simulasi">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <p className="note tabular-nums">{progress}% selesai</p>
              {slow && (
                <div style={{ marginTop: "1rem", padding: "0.875rem", background: "var(--surface-subtle)", borderRadius: "var(--radius-md)" }}>
                  <p className="note" style={{ color: "var(--text)", fontWeight: 600 }}>Mesin hitung mungkin sedang bangun dari mode tidur.</p>
                  <p className="note">{SLOW_ENGINE_NOTE}</p>
                </div>
              )}
            </div>
          )}

          {!running && errors.length > 0 && (
            <div className="state bad" role="alert">
              <h3>Simulasi belum berhasil</h3>
              <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              <p>Perbaiki parameter terkait, lalu tekan &ldquo;Jalankan Simulasi&rdquo; kembali.</p>
            </div>
          )}

          {!running && errors.length === 0 && (
            <div className="state">
              <h3>Siap dijalankan</h3>
              <p>
                Tekan tombol <strong>&ldquo;Jalankan Simulasi&rdquo;</strong> untuk menjalankan mesin hitung hybrid Python (neraca daya 8.760 jam dan arus kas multi-tahun).
                Setelah selesai, Anda akan diarahkan ke Dasbor Hasil.
              </p>
            </div>
          )}
        </section>
      </div>
    </HybridShell>
  );
}
