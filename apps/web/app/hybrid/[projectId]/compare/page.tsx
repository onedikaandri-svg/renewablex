"use client";

import { use, useState } from "react";
import HybridShell from "@/components/hybrid/HybridShell";
import ScenarioCompareTab from "@/components/hybrid/ScenarioCompareTab";
import SensitivityTab from "@/components/hybrid/SensitivityTab";
import SweepTab from "@/components/hybrid/SweepTab";
import { usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

type CompareTabKey = "sweep" | "scenarios" | "sensitivity";

export default function HybridComparePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, setResult, ready, updateProject } = useHybridProject(projectId);
  const { lang } = usePreferences();
  const [activeTab, setActiveTab] = useState<CompareTabKey>("sweep");
  const [scenarioRefresh, setScenarioRefresh] = useState(0);

  if (!ready) {
    return (
      <div className="state" role="status">
        <p>Memuat halaman perbandingan dan sapuan&hellip;</p>
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
      title={lang === "en" ? "Optimization Sweep, Scenarios & Sensitivity" : "Sapuan Kombinasi, Perbandingan Skenario & Sensitivitas"}
      subtitle="Cari ukuran komponen optimal gaya HOMER, bandingkan skenario proyek berdampingan, dan uji sensitivitas parameter hybrid."
      result={result}
    >
      <div className="tabs" role="tablist" aria-label={lang === "en" ? "Comparison views" : "Tab perbandingan sistem hybrid"}>
        <button
          type="button"
          role="tab"
          id="tab-sweep"
          aria-selected={activeTab === "sweep"}
          aria-controls="panel-sweep"
          className="tab-btn"
          onClick={() => setActiveTab("sweep")}
        >
          {lang === "en" ? "Component Sweep" : "Sapuan Kombinasi HOMER"}
        </button>
        <button
          type="button"
          role="tab"
          id="tab-scenarios"
          aria-selected={activeTab === "scenarios"}
          aria-controls="panel-scenarios"
          className="tab-btn"
          onClick={() => setActiveTab("scenarios")}
        >
          {lang === "en" ? "Compare Scenarios" : "Bandingkan Skenario Proyek"}
        </button>
        <button
          type="button"
          role="tab"
          id="tab-sensitivity"
          aria-selected={activeTab === "sensitivity"}
          aria-controls="panel-sensitivity"
          className="tab-btn"
          onClick={() => setActiveTab("sensitivity")}
        >
          {lang === "en" ? "Hybrid Sensitivity" : "Sensitivitas Hybrid (Tornado & 5x5)"}
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
