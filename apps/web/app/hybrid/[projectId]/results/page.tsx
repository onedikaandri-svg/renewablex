"use client";

import Link from "next/link";
import { use } from "react";
import HybridDashboard from "@/components/hybrid/HybridDashboard";
import HybridShell from "@/components/hybrid/HybridShell";
import { usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

export default function HybridResultsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, ready } = useHybridProject(projectId);
  const { lang } = usePreferences();

  if (!ready) {
    return (
      <div className="state" role="status">
        <p>{lang === "en" ? "Loading project simulation results..." : "Memuat hasil simulasi proyek..."}</p>
      </div>
    );
  }

  if (!project) {
    return <MissingProjectState />;
  }

  return (
    <HybridShell
      project={project}
      activeStep="results"
      title={lang === "en" ? "Simulation Results Dashboard" : "Dasbor Hasil Simulasi Hybrid"}
      subtitle={
        lang === "en"
          ? "All metrics and charts below come directly from the RenewableX backend calculation engine."
          : "Seluruh angka dan grafik di bawah berasal langsung dari mesin hitung backend RenewableX."
      }
      result={result}
    >
      {!result ? (
        <div className="state">
          <h2>
            {lang === "en"
              ? "No simulation results for this project yet"
              : "Belum ada hasil simulasi untuk proyek ini"}
          </h2>
          <p>
            {lang === "en"
              ? "Open Step 7 (Run) to execute the hybrid simulation and display its charts and financial analysis here."
              : "Buka Halaman 7 (Jalankan) untuk mengeksekusi simulasi hybrid dan menampilkan grafik serta analisis keuangannya di sini."}
          </p>
          <div className="row" style={{ borderTop: 0, paddingTop: "0.75rem", marginTop: "0.5rem" }}>
            <Link href={`/hybrid/${project.id}/run`} className="btn primary">
              {lang === "en" ? "Go to Step 7: Run Simulation" : "Ke Halaman Jalankan Simulasi"}
            </Link>
          </div>
        </div>
      ) : (
        <HybridDashboard config={project} result={result} />
      )}
    </HybridShell>
  );
}
