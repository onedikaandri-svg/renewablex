"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { IconChevronLeft, IconChevronRight } from "@/components/Icons";
import { isSimulationResultStale } from "@/lib/hybrid-storage";
import { tr, usePreferences } from "@/lib/preferences";
import type { HybridProjectConfig, HybridSimulateResponse } from "@/lib/hybrid-types";

const STEPS = [
  { key: "projects", num: 1, href: () => "/hybrid", id: "Proyek", en: "Projects", ja: "プロジェクト" },
  { key: "location", num: 2, href: (id: string) => `/hybrid/${id}/location`, id: "Lokasi & Cuaca", en: "Location & Weather", ja: "地点・気象" },
  { key: "load", num: 3, href: (id: string) => `/hybrid/${id}/load`, id: "Profil Beban", en: "Load Profile", ja: "負荷プロファイル" },
  { key: "system", num: 4, href: (id: string) => `/hybrid/${id}/system`, id: "Desain Sistem", en: "System Design", ja: "システム設計" },
  { key: "ems", num: 5, href: (id: string) => `/hybrid/${id}/ems`, id: "EMS", en: "EMS", ja: "EMS戦略" },
  { key: "economics", num: 6, href: (id: string) => `/hybrid/${id}/economics`, id: "Ekonomi", en: "Economics", ja: "経済性・料金" },
  { key: "run", num: 7, href: (id: string) => `/hybrid/${id}/run`, id: "Jalankan", en: "Run", ja: "計算実行" },
  { key: "results", num: 8, href: (id: string) => `/hybrid/${id}/results`, id: "Hasil", en: "Results", ja: "結果分析" },
  { key: "compare", num: 9, href: (id: string) => `/hybrid/${id}/compare`, id: "Bandingkan", en: "Compare", ja: "比較・感度" },
  { key: "export", num: 10, href: (id: string) => `/hybrid/${id}/export`, id: "Ekspor", en: "Export", ja: "レポート出力" },
] as const;

export type HybridStepKey = (typeof STEPS)[number]["key"];

export function ViabilityChip({
  status,
  stale = false,
}: {
  status?: "viable" | "marginal" | "unviable" | null;
  stale?: boolean;
}) {
  const { lang } = usePreferences();
  if (!status) {
    return <span className="chip">{tr(lang, "Not simulated", "Belum disimulasikan", "未計算")}</span>;
  }
  const labels = {
    viable: tr(lang, "Viable", "Layak", "採算性あり"),
    marginal: tr(lang, "Marginal", "Marjinal", "境界水準"),
    unviable: tr(lang, "Unviable", "Belum Layak", "採算性なし"),
  };
  if (stale) {
    return (
      <span className="chip chip-marginal">
        {tr(
          lang,
          `${labels[status]} (Needs Re-run)`,
          `${labels[status]} (Perlu Hitung Ulang)`,
          `${labels[status]} (再計算が必要)`,
        )}
      </span>
    );
  }
  return <span className={`chip chip-${status}`}>{labels[status]}</span>;
}

export default function HybridShell({
  project,
  activeStep,
  title,
  subtitle,
  result,
  children,
}: {
  project: HybridProjectConfig;
  activeStep: HybridStepKey;
  title: string;
  subtitle: string;
  result?: HybridSimulateResponse | null;
  children: ReactNode;
}) {
  const { lang } = usePreferences();
  const currentIdx = STEPS.findIndex((s) => s.key === activeStep);
  const prevStep = currentIdx > 0 ? STEPS[currentIdx - 1] : null;
  const nextStep = currentIdx >= 0 && currentIdx < STEPS.length - 1 ? STEPS[currentIdx + 1] : null;
  const isStale = Boolean(result && isSimulationResultStale(project, result));

  return (
    <>
      <nav className="stepper no-print" aria-label={tr(lang, "Hybrid design steps", "Tahapan desain hybrid", "ハイブリッド設計ステップ")}>
        {STEPS.map((s) => {
          const isCurrent = s.key === activeStep;
          return (
            <Link
              key={s.key}
              href={s.href(project.id)}
              className="step-pill"
              aria-current={isCurrent ? "step" : undefined}
            >
              <span className="step-num">{s.num}</span>
              <span>{tr(lang, s.en, s.id, s.ja)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="page-head no-print">
        <div>
          <p className="eyebrow">
            {project.project.project_name} ({project.project.currency_code})
          </p>
          <h1>{title}</h1>
          <p className="lead">{subtitle}</p>
        </div>
        <div className="actions-inline">
          <ViabilityChip status={result?.finance_summary?.viability_status ?? null} stale={isStale} />
        </div>
      </div>

      {isStale && (
        <div className="warn no-print" role="status">
          <div className="actions-inline" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ margin: 0 }}>
              {tr(
                lang,
                "Project configuration has changed since the last simulation run. Re-run the simulation to refresh dashboard charts and export reports.",
                "Settingan proyek berubah sejak simulasi terakhir. Yuk gas jalankan ulang simulasi biar angka grafik dan laporan ekspor ikut ter-update!",
                "前回のシミュレーション実行後にプロジェクト設定が変更されました。ダッシュボードのグラフや出力レポートを最新の状態にするため、再計算を実行してください。",
              )}
            </p>
            <Link href={`/hybrid/${project.id}/run`} className="btn btn-sm primary">
              {tr(
                lang,
                "Go to Step 7: Re-run Simulation",
                "Ke Halaman 7: Hitung Ulang",
                "ステップ7へ: 再計算を実行",
              )}
            </Link>
          </div>
        </div>
      )}

      {children}

      <div className="row no-print" style={{ justifyContent: "space-between", marginTop: "2rem" }}>
        <div>
          {prevStep && (
            <Link href={prevStep.href(project.id)} className="btn ghost">
              <IconChevronLeft size={15} />
              {tr(
                lang,
                `Previous: ${prevStep.en}`,
                `Sebelumnya: ${prevStep.id}`,
                `前へ: ${prevStep.ja}`,
              )}
            </Link>
          )}
        </div>
        <div>
          {nextStep && (
            <Link href={nextStep.href(project.id)} className="btn primary">
              {tr(
                lang,
                `Next: ${nextStep.en}`,
                `Lanjut: ${nextStep.id}`,
                `次へ: ${nextStep.ja}`,
              )}
              <IconChevronRight size={15} />
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
