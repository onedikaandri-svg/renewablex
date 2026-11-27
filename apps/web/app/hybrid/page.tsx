"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  IconBarChart,
  IconBookOpen,
  IconCopy,
  IconDownload,
  IconPlus,
  IconSliders,
  IconTrash,
  IconUpload,
} from "@/components/Icons";
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
  isSimulationResultStale,
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
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

  useEffect(() => {
    if (!confirmDeleteId) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setConfirmDeleteId(null);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmDeleteId]);

  function handleCreateSample() {
    const created = createSampleProject();
    pushToast(
      lang === "en"
        ? "Sample hybrid project [REAL DATA] loaded."
        : "Contoh proyek hybrid [REAL DATA] berhasil dimuat.",
      "success",
    );
    router.push(`/hybrid/${created.id}/location`);
  }

  function handleCreateBlank() {
    const created = createBlankProject(lang === "en" ? "New Hybrid Project" : "Proyek Hybrid Baru");
    pushToast(
      lang === "en" ? "New hybrid project created." : "Proyek hybrid baru dibuat.",
      "success",
    );
    router.push(`/hybrid/${created.id}/location`);
  }

  function handleDuplicate(id: string) {
    const copy = duplicateProject(id);
    if (copy) {
      refresh();
      pushToast(
        lang === "en"
          ? `Project "${copy.project.project_name}" duplicated.`
          : `Proyek "${copy.project.project_name}" berhasil diduplikat.`,
        "success",
      );
    }
  }

  function handleConfirmDelete(id: string, name: string) {
    deleteProject(id);
    setConfirmDeleteId(null);
    refresh();
    pushToast(
      lang === "en"
        ? `Project "${name}" deleted from browser storage.`
        : `Proyek "${name}" dihapus dari browser.`,
      "info",
    );
  }

  function handleExport(p: HybridProjectConfig) {
    const filename = `${p.project.project_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.hybrid.json`;
    downloadFile(filename, exportProjectJson(p), "application/json");
    pushToast(
      lang === "en" ? "Project JSON file downloaded." : "Berkas JSON proyek diunduh.",
      "success",
    );
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      const imported = importProjectJson(text);
      refresh();
      pushToast(
        lang === "en"
          ? `Project "${imported.project.project_name}" imported.`
          : `Proyek "${imported.project.project_name}" berhasil diimpor.`,
        "success",
      );
    } catch (err) {
      pushToast(
        err instanceof Error
          ? err.message
          : lang === "en"
            ? "Failed to import project JSON."
            : "Gagal mengimpor JSON proyek.",
        "error",
      );
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{lang === "en" ? "Step 1 of 10" : "Langkah 1 dari 10"}</p>
          <h1>{lang === "en" ? "Hybrid Energy System Projects" : "Proyek Sistem Energi Hybrid"}</h1>
          <p className="lead">
            {lang === "en"
              ? "Compose, simulate, and analyze hybrid energy systems (PV, BESS, Biomass, Diesel, and EMS) from hourly steps to a 25-year project lifetime. Projects are saved locally in your browser and can be exported or imported as JSON."
              : "Susun, simulasikan, dan analisis sistem energi hybrid (PV, BESS, Biomass, dan EMS) dari skala jam hingga 25 tahun. Data proyek disimpan secara lokal di browser Anda dan dapat diekspor atau diimpor sebagai JSON."}
          </p>
        </div>
        <div className="actions-inline">
          <button type="button" className="btn primary" onClick={handleCreateSample}>
            {lang === "en" ? "Load Sample Project [REAL DATA]" : "Muat Contoh Proyek [REAL DATA]"}
          </button>
          <button type="button" className="btn ghost" onClick={handleCreateBlank}>
            <IconPlus size={15} />
            {lang === "en" ? "Create New Project" : "Buat Proyek Baru"}
          </button>
          <button type="button" className="btn ghost" onClick={() => fileInputRef.current?.click()}>
            <IconUpload size={15} />
            {lang === "en" ? "Import JSON" : "Impor JSON"}
          </button>
          <Link href="/hybrid/guide" className="btn ghost">
            <IconBookOpen size={15} />
            {lang === "en" ? "Open Guide" : "Buka Panduan"}
          </Link>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            aria-label={lang === "en" ? "Choose project JSON file" : "Pilih berkas JSON proyek"}
            onChange={(e) => {
              void handleImportFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {!ready ? (
        <div className="state" role="status">
          <p>
            {lang === "en"
              ? "Loading projects from local storage..."
              : "Memuat daftar proyek dari penyimpanan lokal..."}
          </p>
        </div>
      ) : projects.length === 0 ? (
        <div className="state">
          <h2>{lang === "en" ? "No saved hybrid projects yet" : "Belum ada proyek hybrid tersimpan"}</h2>
          <p>
            {lang === "en" ? (
              <>
                Get started quickly by loading the complete sample hybrid project (500 kWp PV + 600 kWh BESS + 250 kW Biomass labeled{" "}
                <code>[REAL DATA]</code>), or create a blank project from scratch.
              </>
            ) : (
              <>
                Mulai cepat dengan memuat contoh proyek hybrid lengkap (PV 500 kWp + BESS 600 kWh + Biomass 250 kW berlabel{" "}
                <code>[REAL DATA]</code>), atau buat proyek baru dari awal.
              </>
            )}
          </p>
          <div className="row" style={{ borderTop: 0, paddingTop: "0.75rem", marginTop: "0.5rem" }}>
            <button type="button" className="btn primary" onClick={handleCreateSample}>
              {lang === "en" ? "Load Sample Project [REAL DATA]" : "Muat Contoh Proyek [REAL DATA]"}
            </button>
            <button type="button" className="btn ghost" onClick={handleCreateBlank}>
              {lang === "en" ? "Create New Project" : "Buat Proyek Baru"}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid-3">
          {projects.map((p) => {
            const res = resultsMap[p.id];
            const isStale = Boolean(res && isSimulationResultStale(p, res));
            const isConfirmingDelete = confirmDeleteId === p.id;
            return (
              <article key={p.id} className="project-card">
                <div>
                  <div className="actions-inline" style={{ justifyContent: "space-between", marginBottom: "0.5rem" }}>
                    <span className="chip">{p.project.currency_code}</span>
                    <ViabilityChip status={res?.finance_summary?.viability_status ?? null} stale={isStale} />
                  </div>
                  <h3>{p.project.project_name}</h3>
                  <p className="note tabular-nums">
                    {lang === "en" ? "Coordinates" : "Koordinat"}: {p.project.latitude.toFixed(2)}, {p.project.longitude.toFixed(2)} ({p.project.timezone})
                  </p>
                  <p className="note tabular-nums">
                    PV {formatNumber(p.components.pv.capacity_kwp, lang, 0)} kWp
                    {p.components.bess.enabled ? ` | BESS ${formatNumber(p.components.bess.nominal_capacity_kwh, lang, 0)} kWh` : ""}
                    {p.components.biomass.enabled ? ` | Biomass ${formatNumber(p.components.biomass.rated_capacity_kw, lang, 0)} kW` : ""}
                    {p.components.diesel?.enabled ? ` | Diesel ${formatNumber(p.components.diesel.rated_capacity_kw, lang, 0)} kW` : ""}
                  </p>
                  <p className="note">
                    {lang === "en" ? "Updated" : "Diperbarui"}: {new Date(p.updatedAt).toLocaleString(lang === "en" ? "en-US" : "id-ID")}
                  </p>
                </div>

                <div className="actions-inline">
                  <Link href={`/hybrid/${p.id}/location`} className="btn btn-sm primary">
                    <IconSliders size={14} />
                    {lang === "en" ? "Open Configuration" : "Buka Konfigurasi"}
                  </Link>
                  {res && (
                    <Link href={`/hybrid/${p.id}/results`} className="btn btn-sm ghost">
                      <IconBarChart size={14} />
                      {lang === "en" ? "View Results" : "Lihat Hasil"}
                    </Link>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-icon ghost"
                    aria-label={
                      lang === "en"
                        ? `Duplicate project ${p.project.project_name}`
                        : `Duplikat proyek ${p.project.project_name}`
                    }
                    title={lang === "en" ? "Duplicate project" : "Duplikat proyek"}
                    onClick={() => handleDuplicate(p.id)}
                  >
                    <IconCopy size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-icon ghost"
                    aria-label={
                      lang === "en"
                        ? `Export JSON for project ${p.project.project_name}`
                        : `Ekspor JSON proyek ${p.project.project_name}`
                    }
                    title={lang === "en" ? "Export JSON" : "Ekspor JSON"}
                    onClick={() => handleExport(p)}
                  >
                    <IconDownload size={15} />
                  </button>

                  {isConfirmingDelete ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm danger-ghost"
                        aria-label={
                          lang === "en"
                            ? `Confirm delete project ${p.project.project_name}`
                            : `Yakin hapus proyek ${p.project.project_name}`
                        }
                        onClick={() => handleConfirmDelete(p.id, p.project.project_name)}
                      >
                        {lang === "en" ? "Confirm Delete" : "Yakin Hapus"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm ghost"
                        aria-label={
                          lang === "en"
                            ? `Cancel delete project ${p.project.project_name}`
                            : `Batal hapus proyek ${p.project.project_name}`
                        }
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        {lang === "en" ? "Cancel" : "Batal"}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-icon danger-ghost"
                      aria-label={
                        lang === "en"
                          ? `Delete project ${p.project.project_name}`
                          : `Hapus proyek ${p.project.project_name}`
                      }
                      title={lang === "en" ? "Delete project" : "Hapus proyek"}
                      onClick={() => setConfirmDeleteId(p.id)}
                    >
                      <IconTrash size={15} />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
