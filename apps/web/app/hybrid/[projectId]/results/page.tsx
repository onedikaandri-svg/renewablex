"use client";

import Link from "next/link";
import { use } from "react";
import HybridDashboard from "@/components/hybrid/HybridDashboard";
import HybridShell from "@/components/hybrid/HybridShell";
import { tr, usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

export default function HybridResultsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, ready } = useHybridProject(projectId);
  const { lang } = usePreferences();

  if (!ready) {
    return (
      <div className="state" role="status">
        <p>
          {tr(
            lang,
            "Loading project simulation results...",
            "Lagi memuat hasil simulasi proyek...",
            "シミュレーション結果を読み込み中...",
          )}
        </p>
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
      title={tr(
        lang,
        "Simulation Results Dashboard",
        "Dasbor Hasil Simulasi Hybrid",
        "ハイブリッド・シミュレーション結果ダッシュボード",
      )}
      subtitle={tr(
        lang,
        "All metrics and charts below come directly from the RenewableX backend calculation engine.",
        "Semua angka dan grafik di bawah ini murni hasil hitungan mesin backend RenewableX.",
        "以下のすべての指標およびグラフは、RenewableX バックエンド計算エンジンから直接出力されたものです。",
      )}
      result={result}
    >
      {!result ? (
        <div className="state">
          <h2>
            {tr(
              lang,
              "No simulation results for this project yet",
              "Proyek ini belum ada hasil simulasinya nih",
              "このプロジェクトのシミュレーション結果がまだありません",
            )}
          </h2>
          <p>
            {tr(
              lang,
              "Open Step 7 (Run) to execute the hybrid simulation and display its charts and financial analysis here.",
              "Yuk mampir ke Langkah 7 (Jalankan) buat gas simulasi hybrid supaya grafik dan analisis keuangannya tampil di sini!",
              "ステップ7（計算実行）を開いてハイブリッドシミュレーションを実行すると、グラフと財務分析がここに表示されます。",
            )}
          </p>
          <div className="row" style={{ borderTop: 0, paddingTop: "0.75rem", marginTop: "0.5rem" }}>
            <Link href={`/hybrid/${project.id}/run`} className="btn primary">
              {tr(
                lang,
                "Go to Step 7: Run Simulation",
                "Ke Halaman 7: Gas Simulasi",
                "ステップ7へ: シミュレーションを実行",
              )}
            </Link>
          </div>
        </div>
      ) : (
        <HybridDashboard config={project} result={result} />
      )}
    </HybridShell>
  );
}
