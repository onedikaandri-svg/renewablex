"use client";

import { useEffect, useMemo, useState, use } from "react";
import ComponentInspector from "@/components/hybrid/ComponentInspector";
import HybridShell from "@/components/hybrid/HybridShell";
import SchematicCanvas from "@/components/hybrid/SchematicCanvas";
import { useToast } from "@/components/Toast";
import { fetchHybridPresets } from "@/lib/hybrid-api";
import { resolveProjectTopology, validateSystemTopology } from "@/lib/hybrid-topology";
import type { HybridPresetsResponse } from "@/lib/hybrid-types";
import { tr, usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

export default function HybridSystemPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, ready, updateProject } = useHybridProject(projectId);
  const { lang } = usePreferences();
  const { pushToast } = useToast();
  const [presets, setPresets] = useState<HybridPresetsResponse | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState("node-pv");

  useEffect(() => {
    fetchHybridPresets().then(setPresets).catch(() => {});
  }, []);

  const validation = useMemo(() => {
    if (!project) return { valid: true, errors: [], warnings: [] };
    return validateSystemTopology(project);
  }, [project]);

  const activeSelectedNodeId = useMemo(() => {
    if (!project) return selectedNodeId;
    const topo = resolveProjectTopology(project);
    if (topo.nodes.some((n) => n.id === selectedNodeId)) return selectedNodeId;
    return topo.nodes[0]?.id ?? "node-pv";
  }, [project, selectedNodeId]);

  if (!ready) {
    return (
      <div className="state">
        <p>{tr(lang, "Loading project...", "Lagi memuat proyek...", "プロジェクトを読み込み中...")}</p>
      </div>
    );
  }
  if (!project) return <MissingProjectState />;

  return (
    <HybridShell
      project={project}
      activeStep="system"
      title={tr(
        lang,
        "Interactive System Architecture",
        "Desain Skema & Parameter Komponen",
        "インタラクティブ・システム構成設計",
      )}
      subtitle={tr(
        lang,
        "Arrange components on the interactive canvas, connect them to the AC Bus, and click any component to tune its physical parameters.",
        "Susun komponen di kanvas interaktif, sambungkan ke AC Bus, terus klik komponennya buat atur kapasitas dan parameter teknis.",
        "キャンバス上にコンポーネントを配置してACバスへ接続し、各設備をクリックして物理パラメータを設定します。",
      )}
      result={result}
    >
      {validation.errors.length > 0 && (
        <div className="state bad" role="alert" style={{ marginBottom: "1rem" }}>
          <h3>
            {tr(
              lang,
              "Topology errors must be fixed",
              "Ada koneksi topologi yang perlu dibereskan",
              "トポロジーエラーの修正が必要です",
            )}
          </h3>
          <ul>
            {validation.errors.map((err, idx) => (
              <li key={idx}>{lang === "id" ? err.messageId : err.messageEn}</li>
            ))}
          </ul>
        </div>
      )}

      {validation.warnings.length > 0 && (
        <div className="warn" role="note">
          <h3>{tr(lang, "Topology notes", "Catatan topologi skema", "構成に関する注記")}</h3>
          <ul>
            {validation.warnings.map((w, idx) => (
              <li key={idx}>{lang === "id" ? w.messageId : w.messageEn}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid-canvas">
        <SchematicCanvas
          project={project}
          selectedNodeId={activeSelectedNodeId}
          validation={validation}
          onSelectNode={setSelectedNodeId}
          onChangeProject={(next) => updateProject(() => next)}
          onNotify={(msg, tone) => pushToast(msg, tone)}
        />

        <ComponentInspector
          project={project}
          selectedNodeId={activeSelectedNodeId}
          presets={presets}
          validation={validation}
          onChangeProject={(next) => updateProject(() => next)}
          onSelectNode={setSelectedNodeId}
          onNotify={(msg, tone) => pushToast(msg, tone)}
        />
      </div>
    </HybridShell>
  );
}
