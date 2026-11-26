"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getProject, getSimulationResult, saveProject } from "@/lib/hybrid-storage";
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
  return (
    <div className="sec state bad" role="alert">
      <h2>Proyek tidak ditemukan</h2>
      <p>Proyek tidak ada di penyimpanan browser ini atau telah dihapus.</p>
      <div className="row" style={{ borderTop: 0, paddingTop: "0.75rem", marginTop: "0.5rem" }}>
        <Link href="/hybrid" className="btn primary">
          Kembali ke Daftar Proyek
        </Link>
      </div>
    </div>
  );
}
