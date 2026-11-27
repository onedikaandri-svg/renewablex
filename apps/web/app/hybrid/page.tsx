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
import { tr, usePreferences } from "@/lib/preferences";

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
      tr(
        lang,
        "Sample hybrid project [REAL DATA] loaded.",
        "Mantap! Contoh proyek hybrid [REAL DATA] sudah siap.",
        "サンプルハイブリッドプロジェクト [REAL DATA] を読み込みました。",
      ),
      "success",
    );
    router.push(`/hybrid/${created.id}/location`);
  }

  function handleCreateBlank() {
    const created = createBlankProject(
      tr(lang, "New Hybrid Project", "Proyek Hybrid Baru", "新規ハイブリッドプロジェクト"),
    );
    pushToast(
      tr(
        lang,
        "New hybrid project created.",
        "Sip! Proyek hybrid baru berhasil dibuat.",
        "新しいハイブリッドプロジェクトを作成しました。",
      ),
      "success",
    );
    router.push(`/hybrid/${created.id}/location`);
  }

  function handleDuplicate(id: string) {
    const copy = duplicateProject(id);
    if (copy) {
      refresh();
      pushToast(
        tr(
          lang,
          `Project "${copy.project.project_name}" duplicated.`,
          `Beres! Proyek "${copy.project.project_name}" sudah diduplikat.`,
          `プロジェクト「${copy.project.project_name}」を複製しました。`,
        ),
        "success",
      );
    }
  }

  function handleConfirmDelete(id: string, name: string) {
    deleteProject(id);
    setConfirmDeleteId(null);
    refresh();
    pushToast(
      tr(
        lang,
        `Project "${name}" deleted from browser storage.`,
        `Proyek "${name}" sudah dihapus dari browser.`,
        `プロジェクト「${name}」をブラウザの保存領域から削除しました。`,
      ),
      "info",
    );
  }

  function handleExport(p: HybridProjectConfig) {
    const filename = `${p.project.project_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.hybrid.json`;
    downloadFile(filename, exportProjectJson(p), "application/json");
    pushToast(
      tr(
        lang,
        "Project JSON file downloaded.",
        "Sip, file JSON proyek sudah terunduh.",
        "プロジェクトのJSONファイルをダウンロードしました。",
      ),
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
        tr(
          lang,
          `Project "${imported.project.project_name}" imported.`,
          `Mantap! Proyek "${imported.project.project_name}" berhasil diimpor.`,
          `プロジェクト「${imported.project.project_name}」をインポートしました。`,
        ),
        "success",
      );
    } catch (err) {
      pushToast(
        err instanceof Error
          ? err.message
          : tr(
              lang,
              "Failed to import project JSON.",
              "Gagal mengimpor file JSON proyek.",
              "プロジェクトJSONのインポートに失敗しました。",
            ),
        "error",
      );
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{tr(lang, "Step 1 of 10", "Langkah 1 dari 10", "ステップ 1 / 10")}</p>
          <h1>
            {tr(
              lang,
              "Hybrid Energy System Projects",
              "Proyek Sistem Energi Hybrid",
              "ハイブリッドエネルギーシステム・プロジェクト一覧",
            )}
          </h1>
          <p className="lead">
            {tr(
              lang,
              "Compose, simulate, and analyze hybrid energy systems (PV, BESS, Biomass, Diesel, and EMS) from hourly steps to a 25-year project lifetime. Projects are saved locally in your browser and can be exported or imported as JSON.",
              "Rancang, simulasikan, dan analisis sistem energi hybrid (PV, BESS, Biomass, Diesel, dan EMS) dari skala per jam sampai 25 tahun. Semua proyek tersimpan aman di browser kamu dan bisa diekspor/impor lewat file JSON.",
              "太陽光 (PV)、蓄電池 (BESS)、バイオマス、ディーゼル発電、およびEMSを組み合わせたハイブリッド電源システムを、1時間単位から25年間の事業期間まで設計・シミュレーションします。",
            )}
          </p>
        </div>
        <div className="actions-inline">
          <button type="button" className="btn primary" onClick={handleCreateSample}>
            {tr(
              lang,
              "Load Sample Project [REAL DATA]",
              "Muat Proyek Contoh [REAL DATA]",
              "サンプルプロジェクト読込 [REAL DATA]",
            )}
          </button>
          <button type="button" className="btn ghost" onClick={handleCreateBlank}>
            <IconPlus size={15} />
            {tr(lang, "Create New Project", "Buat Proyek Baru", "新規プロジェクト作成")}
          </button>
          <button type="button" className="btn ghost" onClick={() => fileInputRef.current?.click()}>
            <IconUpload size={15} />
            {tr(lang, "Import JSON", "Impor JSON", "JSONインポート")}
          </button>
          <Link href="/hybrid/guide" className="btn ghost">
            <IconBookOpen size={15} />
            {tr(lang, "Open Guide", "Buka Panduan", "利用ガイド")}
          </Link>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            aria-label={tr(
              lang,
              "Choose project JSON file",
              "Pilih file JSON proyek",
              "プロジェクトJSONファイルを選択",
            )}
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
            {tr(
              lang,
              "Loading projects from local storage...",
              "Lagi memuat daftar proyek dari browser...",
              "ローカルストレージからプロジェクトを読み込み中...",
            )}
          </p>
        </div>
      ) : projects.length === 0 ? (
        <div className="state">
          <h2>
            {tr(
              lang,
              "No saved hybrid projects yet",
              "Belum ada proyek hybrid tersimpan nih",
              "保存されたハイブリッドプロジェクトがありません",
            )}
          </h2>
          <p>
            {tr(
              lang,
              <>
                Get started quickly by loading the complete sample hybrid project (500 kWp PV + 600 kWh BESS + 250 kW Biomass labeled{" "}
                <code>[REAL DATA]</code>), or create a blank project from scratch.
              </>,
              <>
                Yuk mulai cepat dengan memuat contoh proyek hybrid lengkap (PV 500 kWp + BESS 600 kWh + Biomass 250 kW berlabel{" "}
                <code>[REAL DATA]</code>), atau langsung bikin proyek baru dari nol!
              </>,
              <>
                <code>[REAL DATA]</code> 付きサンプルプロジェクト（PV 500 kWp + 蓄電池 600 kWh + バイオマス 250 kW）を読み込んで今すぐ始めるか、新規プロジェクトを作成してください。
              </>,
            )}
          </p>
          <div className="row" style={{ borderTop: 0, paddingTop: "0.75rem", marginTop: "0.5rem" }}>
            <button type="button" className="btn primary" onClick={handleCreateSample}>
              {tr(
                lang,
                "Load Sample Project [REAL DATA]",
                "Muat Proyek Contoh [REAL DATA]",
                "サンプルプロジェクト読込 [REAL DATA]",
              )}
            </button>
            <button type="button" className="btn ghost" onClick={handleCreateBlank}>
              {tr(lang, "Create New Project", "Buat Proyek Baru", "新規プロジェクト作成")}
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
                    {tr(lang, "Coordinates", "Koordinat", "座標")}: {p.project.latitude.toFixed(2)}, {p.project.longitude.toFixed(2)} ({p.project.timezone})
                  </p>
                  <p className="note tabular-nums">
                    PV {formatNumber(p.components.pv.capacity_kwp, lang, 0)} kWp
                    {p.components.bess.enabled ? ` | BESS ${formatNumber(p.components.bess.nominal_capacity_kwh, lang, 0)} kWh` : ""}
                    {p.components.biomass.enabled ? ` | Biomass ${formatNumber(p.components.biomass.rated_capacity_kw, lang, 0)} kW` : ""}
                    {p.components.diesel?.enabled ? ` | Diesel ${formatNumber(p.components.diesel.rated_capacity_kw, lang, 0)} kW` : ""}
                  </p>
                  <p className="note">
                    {tr(lang, "Updated", "Diperbarui", "最終更新")}:{" "}
                    {new Date(p.updatedAt).toLocaleString(tr(lang, "en-US", "id-ID", "ja-JP"))}
                  </p>
                </div>

                <div className="actions-inline">
                  <Link href={`/hybrid/${p.id}/location`} className="btn btn-sm primary">
                    <IconSliders size={14} />
                    {tr(lang, "Open Configuration", "Atur Proyek", "設定を開く")}
                  </Link>
                  {res && (
                    <Link href={`/hybrid/${p.id}/results`} className="btn btn-sm ghost">
                      <IconBarChart size={14} />
                      {tr(lang, "View Results", "Lihat Hasil", "結果を見る")}
                    </Link>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-icon ghost"
                    aria-label={tr(
                      lang,
                      `Duplicate project ${p.project.project_name}`,
                      `Duplikat proyek ${p.project.project_name}`,
                      `プロジェクト ${p.project.project_name} を複製`,
                    )}
                    title={tr(lang, "Duplicate project", "Duplikat proyek", "プロジェクトを複製")}
                    onClick={() => handleDuplicate(p.id)}
                  >
                    <IconCopy size={15} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-icon ghost"
                    aria-label={tr(
                      lang,
                      `Export JSON for project ${p.project.project_name}`,
                      `Ekspor JSON proyek ${p.project.project_name}`,
                      `プロジェクト ${p.project.project_name} のJSONを出力`,
                    )}
                    title={tr(lang, "Export JSON", "Ekspor JSON", "JSON出力")}
                    onClick={() => handleExport(p)}
                  >
                    <IconDownload size={15} />
                  </button>

                  {isConfirmingDelete ? (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm danger-ghost"
                        aria-label={tr(
                          lang,
                          `Confirm delete project ${p.project.project_name}`,
                          `Yakin hapus proyek ${p.project.project_name}`,
                          `プロジェクト ${p.project.project_name} の削除を確定`,
                        )}
                        onClick={() => handleConfirmDelete(p.id, p.project.project_name)}
                      >
                        {tr(lang, "Confirm Delete", "Yakin Hapus", "削除を確定")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm ghost"
                        aria-label={tr(
                          lang,
                          `Cancel delete project ${p.project.project_name}`,
                          `Batal hapus proyek ${p.project.project_name}`,
                          `プロジェクト ${p.project.project_name} の削除をキャンセル`,
                        )}
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        {tr(lang, "Cancel", "Batal", "キャンセル")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-icon danger-ghost"
                      aria-label={tr(
                        lang,
                        `Delete project ${p.project.project_name}`,
                        `Hapus proyek ${p.project.project_name}`,
                        `プロジェクト ${p.project.project_name} を削除`,
                      )}
                      title={tr(lang, "Delete project", "Hapus proyek", "プロジェクトを削除")}
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
