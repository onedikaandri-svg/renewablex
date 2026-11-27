"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getProject,
  getSimulationResult,
  HYBRID_PROJECT_UPDATED_EVENT,
  saveProject,
} from "@/lib/hybrid-storage";
import { usePreferences } from "@/lib/preferences";
import type { HybridProjectConfig, HybridSimulateResponse } from "@/lib/hybrid-types";

export function useHybridProject(projectId: string) {
  const [project, setProject] = useState<HybridProjectConfig | null>(null);
  const [result, setResult] = useState<HybridSimulateResponse | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const loaded = getProject(projectId);
    setProject(loaded);
    setResult(loaded ? getSimulationResult(projectId) : null);
    setReady(true);

    function handleExternalUpdate(e: Event) {
      const detail = (e as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      const refreshed = getProject(projectId);
      setProject(refreshed);
      setResult(refreshed ? getSimulationResult(projectId) : null);
    }

    window.addEventListener(HYBRID_PROJECT_UPDATED_EVENT, handleExternalUpdate);
    return () => {
      window.removeEventListener(HYBRID_PROJECT_UPDATED_EVENT, handleExternalUpdate);
    };
  }, [projectId]);

  function updateProject(updater: (prev: HybridProjectConfig) => HybridProjectConfig) {
    setProject((prev) => {
      if (!prev) return prev;
      const next = saveProject(updater(prev));
      return next;
    });
  }

  return { project, result, setResult, ready, updateProject };
}

export function MissingProjectState() {
  const { lang } = usePreferences();
  return (
    <div className="sec state bad" role="alert">
      <h2>{lang === "en" ? "Project not found" : "Proyek tidak ditemukan"}</h2>
      <p>
        {lang === "en"
          ? "This project does not exist in this browser's storage or has been deleted."
          : "Proyek tidak ada di penyimpanan browser ini atau telah dihapus."}
      </p>
      <div className="row" style={{ borderTop: 0, paddingTop: "0.75rem", marginTop: "0.5rem" }}>
        <Link href="/hybrid" className="btn primary">
          {lang === "en" ? "Back to Projects List" : "Kembali ke Daftar Proyek"}
        </Link>
      </div>
    </div>
  );
}
