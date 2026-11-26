"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { IconChevronLeft, IconChevronRight } from "@/components/Icons";
import { usePreferences } from "@/lib/preferences";
import type { HybridProjectConfig, HybridSimulateResponse } from "@/lib/hybrid-types";

const STEPS = [
  { key: "projects", num: 1, href: () => "/hybrid", id: "Proyek", en: "Projects" },
  { key: "location", num: 2, href: (id: string) => `/hybrid/${id}/location`, id: "Lokasi & Cuaca", en: "Location & Weather" },
  { key: "load", num: 3, href: (id: string) => `/hybrid/${id}/load`, id: "Beban", en: "Load" },
  { key: "system", num: 4, href: (id: string) => `/hybrid/${id}/system`, id: "Desain Sistem", en: "System Design" },
  { key: "ems", num: 5, href: (id: string) => `/hybrid/${id}/ems`, id: "EMS", en: "EMS" },
  { key: "economics", num: 6, href: (id: string) => `/hybrid/${id}/economics`, id: "Ekonomi", en: "Economics" },
  { key: "run", num: 7, href: (id: string) => `/hybrid/${id}/run`, id: "Jalankan", en: "Run" },
  { key: "results", num: 8, href: (id: string) => `/hybrid/${id}/results`, id: "Hasil", en: "Results" },
  { key: "compare", num: 9, href: (id: string) => `/hybrid/${id}/compare`, id: "Bandingkan", en: "Compare" },
  { key: "export", num: 10, href: (id: string) => `/hybrid/${id}/export`, id: "Ekspor", en: "Export" },
] as const;

export type HybridStepKey = (typeof STEPS)[number]["key"];

export function ViabilityChip({ status }: { status?: "viable" | "marginal" | "unviable" | null }) {
  const { lang } = usePreferences();
  if (!status) {
    return <span className="chip">{lang === "en" ? "Not simulated" : "Belum disimulasikan"}</span>;
  }
  const labels = {
    viable: lang === "en" ? "Viable" : "Layak",
    marginal: lang === "en" ? "Marginal" : "Marjinal",
    unviable: lang === "en" ? "Unviable" : "Tidak Layak",
  };
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

  return (
    <>
      <nav className="stepper no-print" aria-label={lang === "en" ? "Hybrid design steps" : "Tahapan desain hybrid"}>
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
              <span>{lang === "en" ? s.en : s.id}</span>
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
          <ViabilityChip status={result?.finance_summary?.viability_status ?? null} />
        </div>
      </div>

      {children}

      <div className="row no-print" style={{ justifyContent: "space-between", marginTop: "2rem" }}>
        <div>
          {prevStep && (
            <Link href={prevStep.href(project.id)} className="btn ghost">
              <IconChevronLeft size={15} />
              {lang === "en" ? `Previous: ${prevStep.en}` : `Sebelumnya: ${prevStep.id}`}
            </Link>
          )}
        </div>
        <div>
          {nextStep && (
            <Link href={nextStep.href(project.id)} className="btn primary">
              {lang === "en" ? `Next: ${nextStep.en}` : `Lanjut: ${nextStep.id}`}
              <IconChevronRight size={15} />
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
