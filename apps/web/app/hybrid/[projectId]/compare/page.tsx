"use client";

import { use, useRef, useState } from "react";
import HybridShell from "@/components/hybrid/HybridShell";
import ScenarioCompareTab from "@/components/hybrid/ScenarioCompareTab";
import SensitivityTab from "@/components/hybrid/SensitivityTab";
import SweepTab from "@/components/hybrid/SweepTab";
import { tr, usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

type CompareTabKey = "sweep" | "scenarios" | "sensitivity";
const COMPARE_TABS: CompareTabKey[] = ["sweep", "scenarios", "sensitivity"];

export default function HybridComparePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, setResult, ready, updateProject } = useHybridProject(projectId);
  const { lang } = usePreferences();
  const [activeTab, setActiveTab] = useState<CompareTabKey>("sweep");
  const [scenarioRefresh, setScenarioRefresh] = useState(0);
  const tabRefs = useRef<Partial<Record<CompareTabKey, HTMLButtonElement | null>>>({});

  function handleTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, current: CompareTabKey) {
    const idx = COMPARE_TABS.indexOf(current);
    if (idx < 0) return;
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % COMPARE_TABS.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + COMPARE_TABS.length) % COMPARE_TABS.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = COMPARE_TABS.length - 1;
    if (nextIdx !== null) {
      e.preventDefault();
      const target = COMPARE_TABS[nextIdx];
      setActiveTab(target);
      tabRefs.current[target]?.focus();
    }
  }

  if (!ready) {
    return (
      <div className="state" role="status">
        <p>
          {tr(
            lang,
            "Loading comparison and sizing sweep page...",
            "Lagi memuat halaman perbandingan & sizing...",
            "比較・最適容量スイープ画面を読み込み中...",
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
      activeStep="compare"
      title={tr(
        lang,
        "Optimization Sweep, Scenarios & Sensitivity",
        "Cari Ukuran Optimal (Sweep), Bandingkan Skenario & Sensitivitas",
        "最適容量スイープ・シナリオ比較・感度分析",
      )}
      subtitle={tr(
        lang,
        "Search HOMER-style optimal component sizing, compare project scenarios side by side, and run hybrid parameter sensitivity.",
        "Cari kombinasi kapasitas komponen paling hemat ala HOMER, bandingkan beberapa skenario sekaligus, dan uji sensitivitas parameter.",
        "HOMER方式で最適な設備容量の組み合わせを探索し、複数シナリオの横並び比較とパラメータ感度分析を実行します。",
      )}
      result={result}
    >
      <div className="tabs" role="tablist" aria-label={tr(lang, "Comparison views", "Tab perbandingan sistem hybrid", "比較・分析タブ")}>
        <button
          ref={(el) => { tabRefs.current.sweep = el; }}
          type="button"
          role="tab"
          id="tab-sweep"
          tabIndex={activeTab === "sweep" ? 0 : -1}
          aria-selected={activeTab === "sweep"}
          aria-controls="panel-sweep"
          className="tab-btn"
          onClick={() => setActiveTab("sweep")}
          onKeyDown={(e) => handleTabKeyDown(e, "sweep")}
        >
          {tr(lang, "Component Sizing Sweep", "Cari Ukuran Optimal (Sweep)", "設備容量スイープ (HOMER方式)")}
        </button>
        <button
          ref={(el) => { tabRefs.current.scenarios = el; }}
          type="button"
          role="tab"
          id="tab-scenarios"
          tabIndex={activeTab === "scenarios" ? 0 : -1}
          aria-selected={activeTab === "scenarios"}
          aria-controls="panel-scenarios"
          className="tab-btn"
          onClick={() => setActiveTab("scenarios")}
          onKeyDown={(e) => handleTabKeyDown(e, "scenarios")}
        >
          {tr(lang, "Compare Scenarios", "Bandingkan Skenario", "シナリオ横並び比較")}
        </button>
        <button
          ref={(el) => { tabRefs.current.sensitivity = el; }}
          type="button"
          role="tab"
          id="tab-sensitivity"
          tabIndex={activeTab === "sensitivity" ? 0 : -1}
          aria-selected={activeTab === "sensitivity"}
          aria-controls="panel-sensitivity"
          className="tab-btn"
          onClick={() => setActiveTab("sensitivity")}
          onKeyDown={(e) => handleTabKeyDown(e, "sensitivity")}
        >
          {tr(lang, "Hybrid Sensitivity", "Sensitivitas (Tornado & 5x5)", "感度分析（トルネード＆5x5）")}
        </button>
      </div>

      {activeTab === "sweep" && (
        <div id="panel-sweep" role="tabpanel" aria-labelledby="tab-sweep">
          <SweepTab
            project={project}
            updateProject={updateProject}
            setResult={setResult}
            onScenarioSaved={() => setScenarioRefresh((n) => n + 1)}
          />
        </div>
      )}

      {activeTab === "scenarios" && (
        <div id="panel-scenarios" role="tabpanel" aria-labelledby="tab-scenarios">
          <ScenarioCompareTab activeProjectId={project.id} refreshToken={scenarioRefresh} />
        </div>
      )}

      {activeTab === "sensitivity" && (
        <div id="panel-sensitivity" role="tabpanel" aria-labelledby="tab-sensitivity">
          <SensitivityTab project={project} />
        </div>
      )}
    </HybridShell>
  );
}
