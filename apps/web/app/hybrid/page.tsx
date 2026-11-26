"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ViabilityChip } from "@/components/hybrid/HybridShell";
import { useToast } from "@/components/Toast";
import { downloadFile, formatNumber } from "@/lib/format";
import {
  createBlankProject,
  createSampleProject,
  deleteProject,
  duplicateProject,
  exportProjectJson,
  getSimulationResult,
  importProjectJson,
  listProjects,
} from "@/lib/hybrid-storage";
import type { HybridProjectConfig, HybridSimulateResponse } from "@/lib/hybrid-types";
import { usePreferences } from "@/lib/preferences";

export default function HybridProjectsPage() {
  const router = useRouter();
  const { pushToast } = useToast();
  const { lang } = usePreferences();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [projects, setProjects] = useState<HybridProjectConfig[]>([]);
  const [resultsMap, setResultsMap] = useState<Record<string, HybridSimulateResponse | null>>({});
  const [ready, setReady] = useState(false);

  function refresh() {
    const items = listProjects();
    setProjects(items);
    const map: Record<string, HybridSimulateResponse | null> = {};
    for (const p of items) {
      map[p.id] = getSimulationResult(p.id);
    }
    setResultsMap(map);
    setReady(true);
  }

  useEffect(() => {
    refresh();
  }, []);

  function handleCreateSample() {
    const created = createSampleProject();
    pushToast("Contoh proyek hybrid [REAL DATA] berhasil dimuat.", "success");
    router.push(`/hybrid/${created.id}/location`);
  }

  function handleCreateBlank() {
    const created = createBlankProject();
    pushToast("Proyek hybrid baru dibuat.", "success");
    router.push(`/hybrid/${created.id}/location`);
  }

  function handleDuplicate(id: string) {
    const copy = duplicateProject(id);
    if (copy) {
      refresh();
      pushToast(`Proyek "${copy.project.project_name}" berhasil diduplikat.`, "success");
    }
  }

  function handleDelete(id: string, name: string) {
    deleteProject(id);
    refresh();
    pushToast(`Proyek "${name}" dihapus dari browser.`, "info");
  }

  function handleExport(p: HybridProjectConfig) {
    const filename = `${p.project.project_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.hybrid.json`;
    downloadFile(filename, exportProjectJson(p), "application/json");
    pushToast("Berkas JSON proyek diunduh.", "success");
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = importProjectJson(text);
      refresh();
      pushToast(`Proyek "${imported.project.project_name}" berhasil diimpor.`, "success");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Gagal mengimpor JSON proyek.", "error");
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Langkah 1 dari 8</p>
          <h1>{lang === "en" ? "Hybrid Energy System Projects" : "Proyek Sistem Energi Hybrid"}</h1>
          <p className="lead">
            Susun, simulasikan, dan analisis sistem energi hybrid (PV, BESS, Biomass, dan EMS) dari skala jam hingga 25 tahun.
            Data proyek disimpan secara lokal di browser Anda dan dapat diekspor atau diimpor sebagai JSON.
          </p>
        </div>
        <div className="actions-inline">
          <button type="button" className="btn primary" onClick={handleCreateSample}>
            Muat Contoh Proyek [REAL DATA]
          </button>
          <button type="button" className="btn ghost" onClick={handleCreateBlank}>
            Buat Proyek Baru
          </button>
          <button type="button" className="btn ghost" onClick={() => fileInputRef.current?.click()}>
            Impor JSON
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            aria-label="Pilih berkas JSON proyek"
            onChange={(e) => {
              void handleImportFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {!ready ? (
        <div className="state" role="status">
          <p>Memuat daftar proyek dari penyimpanan lokal&hellip;</p>
        </div>
      ) : projects.length === 0 ? (
        <div className="state">
          <h2>Belum ada proyek hybrid tersimpan</h2>
          <p>
            Mulai cepat dengan memuat contoh proyek hybrid lengkap (PV 500 kWp + BESS 600 kWh + Biomass 250 kW berlabel{" "}
            <code>[REAL DATA]</code>), atau buat proyek baru dari awal.
          </p>
          <div className="row" style={{ borderTop: 0, paddingTop: "0.75rem", marginTop: "0.5rem" }}>
            <button type="button" className="btn primary" onClick={handleCreateSample}>
              Muat Contoh Proyek [REAL DATA]
            </button>
            <button type="button" className="btn ghost" onClick={handleCreateBlank}>
              Buat Proyek Baru
            </button>
          </div>
        </div>
      ) : (
        <div className="grid-3">
          {projects.map((p) => {
            const res = resultsMap[p.id];
            return (
              <article key={p.id} className="project-card">
                <div>
                  <div className="actions-inline" style={{ justifyContent: "space-between", marginBottom: "0.5rem" }}>
                    <span className="chip">{p.project.currency_code}</span>
                    <ViabilityChip status={res?.finance_summary?.viability_status ?? null} />
                  </div>
                  <h3>{p.project.project_name}</h3>
                  <p className="note tabular-nums">
                    Koordinat: {p.project.latitude.toFixed(2)}, {p.project.longitude.toFixed(2)} ({p.project.timezone})
                  </p>
                  <p className="note tabular-nums">
                    PV {formatNumber(p.components.pv.capacity_kwp, lang, 0)} kWp
                    {p.components.bess.enabled ? ` | BESS ${formatNumber(p.components.bess.nominal_capacity_kwh, lang, 0)} kWh` : ""}
                    {p.components.biomass.enabled ? ` | Biomass ${formatNumber(p.components.biomass.rated_capacity_kw, lang, 0)} kW` : ""}
                  </p>
                  <p className="note">Diperbarui: {new Date(p.updatedAt).toLocaleString("id-ID")}</p>
                </div>

                <div className="actions-inline">
                  <Link href={`/hybrid/${p.id}/location`} className="btn btn-sm primary">
                    Buka Konfigurasi
                  </Link>
                  {res && (
                    <Link href={`/hybrid/${p.id}/results`} className="btn btn-sm ghost">
                      Lihat Hasil
                    </Link>
                  )}
                  <button type="button" className="btn btn-sm ghost" onClick={() => handleDuplicate(p.id)}>
                    Duplikat
                  </button>
                  <button type="button" className="btn btn-sm ghost" onClick={() => handleExport(p)}>
                    Ekspor
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm danger-ghost"
                    onClick={() => handleDelete(p.id, p.project.project_name)}
                  >
                    Hapus
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
