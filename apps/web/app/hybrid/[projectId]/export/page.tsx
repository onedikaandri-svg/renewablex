"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import HybridShell from "@/components/hybrid/HybridShell";
import PrintReportPreview, { type PrintReportSections } from "@/components/hybrid/PrintReportPreview";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import { slowEngineNoteFor, downloadFile } from "@/lib/format";
import { downloadHybridExcelReport } from "@/lib/hybrid-api";
import { buildCashflowCsv, buildExportFilenameSlug, buildHourlyCsv, buildSweepCsv, downloadBlob } from "@/lib/hybrid-export";
import { getSensitivityResult, getSweepResult } from "@/lib/hybrid-storage";
import type { HybridSensitivityResponse, HybridSweepResult } from "@/lib/hybrid-types";
import { tr, usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

export default function HybridExportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, ready } = useHybridProject(projectId);
  const { lang } = usePreferences();
  const { pushToast } = useToast();

  const [sweepResult, setSweepResult] = useState<HybridSweepResult | null>(null);
  const [sensitivityResult, setSensitivityResult] = useState<HybridSensitivityResponse | null>(null);
  const [sections, setSections] = useState<PrintReportSections>({
    executive: true,
    schematic: true,
    monthly: true,
    cashflow: true,
    assumptions: true,
    sweep: true,
  });
  const [includeSweepInExcel, setIncludeSweepInExcel] = useState(true);
  const [includeSensInExcel, setIncludeSensInExcel] = useState(true);

  const [excelLoading, setExcelLoading] = useState(false);
  const [excelSlow, setExcelSlow] = useState(false);
  const [excelError, setExcelError] = useState<string | null>(null);

  useEffect(() => {
    setSweepResult(getSweepResult(projectId));
    setSensitivityResult(getSensitivityResult(projectId));
  }, [projectId]);

  useEffect(() => {
    if (!excelLoading) {
      setExcelSlow(false);
      return;
    }
    const t = setTimeout(() => setExcelSlow(true), 3000);
    return () => clearTimeout(t);
  }, [excelLoading]);

  if (!ready) {
    return (
      <div className="state" role="status">
        <p>{tr(lang, "Loading report export page...", "Lagi memuat halaman ekspor laporan...", "レポート出力画面を読み込み中...")}</p>
      </div>
    );
  }

  if (!project) {
    return <MissingProjectState />;
  }

  const slug = buildExportFilenameSlug(project.project.project_name);

  async function handleDownloadExcel() {
    if (!project || !result) return;
    setExcelLoading(true);
    setExcelError(null);
    try {
      const { blob, filename } = await downloadHybridExcelReport({
        cfg: project,
        result,
        language: lang,
        sweepResult: includeSweepInExcel ? sweepResult : null,
        sensitivityResult: includeSensInExcel ? sensitivityResult : null,
      });
      downloadBlob(filename, blob);
      pushToast(
        tr(
          lang,
          `Excel workbook "${filename}" downloaded.`,
          `Mantap! File Excel "${filename}" sudah terunduh.`,
          `Excelブック「${filename}」をダウンロードしました。`,
        ),
        "success",
      );
    } catch (err) {
      if (err instanceof ApiError) {
        const msgs = [...err.problems.general, ...Object.values(err.problems.fields)];
        setExcelError(msgs[0] ?? err.message);
      } else {
        setExcelError(
          err instanceof Error
            ? err.message
            : tr(
                lang,
                "Failed to generate Excel workbook.",
                "Gagal menyusun file Excel.",
                "Excelファイルの生成に失敗しました。",
              ),
        );
      }
    } finally {
      setExcelLoading(false);
    }
  }

  function handleDownloadHourlyCsv() {
    if (!result) return;
    const csv = buildHourlyCsv(result);
    if (!csv) {
      pushToast(
        tr(
          lang,
          "8,760-hour data is not available in this simulation cache. Re-run the simulation from Step 7.",
          "Data 8.760 jam belum ada di cache browser ini. Yuk jalankan ulang simulasi dari Langkah 7!",
          "このキャッシュには8,760時間データが含まれていません。ステップ7から再計算を実行してください。",
        ),
        "error",
      );
      return;
    }
    downloadFile(`${slug}-hourly-8760.csv`, csv, "text/csv;charset=utf-8");
  }

  function handleDownloadCashflowCsv() {
    if (!result) return;
    downloadFile(`${slug}-arus-kas.csv`, buildCashflowCsv(result), "text/csv;charset=utf-8");
  }

  function handleDownloadSweepCsv() {
    if (!sweepResult) return;
    downloadFile(`${slug}-sapuan-kombinasi.csv`, buildSweepCsv(sweepResult), "text/csv;charset=utf-8");
  }

  function handleDownloadJson() {
    if (!project || !result) return;
    const bundle = {
      exported_at: new Date().toISOString(),
      project_config: { ...project, weatherPreview: null, loadPreview: null },
      simulation_result: result,
      sweep_result: sweepResult,
      sensitivity_result: sensitivityResult,
    };
    downloadFile(`${slug}-paket-data-hybrid.json`, JSON.stringify(bundle, null, 2), "application/json");
  }

  return (
    <HybridShell
      project={project}
      activeStep="export"
      title={tr(
        lang,
        "Export Reports & Raw Data",
        "Ekspor Laporan PDF, File Excel & Data Mentah",
        "レポート出力（PDF・Excel・CSV生データ）",
      )}
      subtitle={tr(
        lang,
        "Download presentation-ready engineering and financial reports in PDF format, multi-sheet Excel workbooks, or 8,760-hour CSV files.",
        "Unduh laporan teknis & keuangan siap presentasi dalam format PDF A4, file Excel multi-sheet, atau CSV deret 8.760 jam.",
        "プレゼン・提出用のA4技術・財務PDFレポート、マルチシートExcelブック (.xlsx)、8,760時間CSVをダウンロードできます。",
      )}
      result={result}
    >
      {!result ? (
        <div className="state">
          <h2>
            {tr(
              lang,
              "No simulation results to export yet",
              "Belum ada hasil simulasi buat diekspor nih",
              "出力可能なシミュレーション結果がまだありません",
            )}
          </h2>
          <p>
            {tr(
              lang,
              "PDF, Excel, and CSV reports require real simulation results from the backend calculation engine.",
              "Laporan PDF, Excel, dan CSV butuh hasil hitungan nyata dari mesin backend. Yuk jalankan dulu simulasinya!",
              "PDF・Excel・CSVレポートの出力には、バックエンド計算エンジンのシミュレーション結果が必要です。",
            )}
          </p>
          <div className="row" style={{ borderTop: 0, paddingTop: "0.75rem", marginTop: "0.5rem" }}>
            <Link href={`/hybrid/${project.id}/run`} className="btn primary">
              {tr(
                lang,
                "Go to Step 7: Run Simulation",
                "Ke Halaman 7: Gas Simulasi",
                "ステップ7へ: シミュレーションを実行",
              )}
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="grid-3 no-print">
            {/* Kartu 1: PDF Cetak A4 (Opsi P1) */}
            <section className="card" aria-labelledby="h-exp-pdf">
              <div className="card-header">
                <h2 id="h-exp-pdf">{tr(lang, "PDF Report (A4)", "Laporan PDF (A4)", "PDFレポート (A4)")}</h2>
                <span className="chip">{tr(lang, "Crisp Vector", "Vektor Tajam", "高精細ベクター")}</span>
              </div>
              <p className="note">
                {tr(
                  lang,
                  <>
                    Formats an A4 print document with a light-theme Year 1 SVG Flow Schematic. Choose <strong>&ldquo;Save as PDF&rdquo;</strong> in your browser print dialog.
                  </>,
                  <>
                    Menyiapkan dokumen A4 rapi lengkap dengan Skema Aliran SVG Tahun 1. Tinggal pilih <strong>&ldquo;Save as PDF / Simpan sebagai PDF&rdquo;</strong> di jendela print browser kamu.
                  </>,
                  <>
                    1年目のSVGエネルギー潮流図を含むA4印刷レイアウトを生成します。ブラウザの印刷ダイアログで<strong>「PDFに保存」</strong>を選択してください。
                  </>,
                )}
              </p>
              <div className="fld">
                <label className="check-row">
                  <input type="checkbox" checked={sections.executive} onChange={(e) => setSections((s) => ({ ...s, executive: e.target.checked }))} />
                  <span>{tr(lang, "Executive Summary & KPIs", "Ringkasan Eksekutif & KPI", "エグゼクティブサマリー＆主要KPI")}</span>
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={sections.schematic} onChange={(e) => setSections((s) => ({ ...s, schematic: e.target.checked }))} />
                  <span>{tr(lang, "Year 1 SVG Energy Schematic", "Skema Aliran Energi SVG (Tahun 1)", "1年目SVGエネルギー潮流図")}</span>
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={sections.monthly} onChange={(e) => setSections((s) => ({ ...s, monthly: e.target.checked }))} />
                  <span>{tr(lang, "Monthly Energy Table", "Tabel Energi Bulanan", "月別エネルギー収支表")}</span>
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={sections.cashflow} onChange={(e) => setSections((s) => ({ ...s, cashflow: e.target.checked }))} />
                  <span>{tr(lang, "Annual Cash Flow Table", "Tabel Arus Kas Tahunan", "年次キャッシュフロー表")}</span>
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={sections.assumptions} onChange={(e) => setSections((s) => ({ ...s, assumptions: e.target.checked }))} />
                  <span>{tr(lang, "Assumptions Appendix [REAL DATA]", "Lampiran Asumsi [REAL DATA]", "前提条件一覧 [REAL DATA]")}</span>
                </label>
                {sweepResult && (
                  <label className="check-row">
                    <input type="checkbox" checked={sections.sweep} onChange={(e) => setSections((s) => ({ ...s, sweep: e.target.checked }))} />
                    <span>{tr(lang, "Sweep Results Summary", "Ringkasan Hasil Sizing (Sweep)", "容量スイープ結果サマリー")}</span>
                  </label>
                )}
              </div>
              <div className="row">
                <button type="button" className="btn primary" onClick={() => window.print()}>
                  {tr(lang, "Print / Save as PDF", "Cetak / Simpan PDF", "印刷 / PDFとして保存")}
                </button>
              </div>
            </section>

            {/* Kartu 2: Buku Kerja Excel .xlsx (Opsi E1 Backend) */}
            <section className="card" aria-labelledby="h-exp-xlsx">
              <div className="card-header">
                <h2 id="h-exp-xlsx">{tr(lang, "Excel Workbook (.xlsx)", "File Excel (.xlsx)", "Excelブック (.xlsx)")}</h2>
                <span className="chip">Multi-Sheet</span>
              </div>
              <p className="note">
                {tr(
                  lang,
                  <>Generated directly by the Python backend (<code>openpyxl</code>) with ready-to-use number formatting:</>,
                  <>Disusun langsung oleh mesin Python (<code>openpyxl</code>) dengan format tabel & angka siap olah:</>,
                  <>Pythonバックエンド (<code>openpyxl</code>) で数値書式付きのマルチシートを生成します:</>,
                )}
              </p>
              <ul style={{ margin: "0.5rem 0", paddingLeft: "1.25rem", fontSize: "0.875rem", color: "var(--muted)" }}>
                <li><code>Ringkasan</code> ({tr(lang, "KPIs, LCOE, Emissions", "KPI, LCOE, Emisi", "主要KPI・LCOE・排出量")})</li>
                <li><code>Energi_Bulanan</code> ({tr(lang, "12 months + Total", "12 bulan + Total", "12ヶ月分＋合計")})</li>
                <li><code>Arus_Kas_Tahunan</code> ({tr(lang, "Year 0 to N", "Tahun 0 sampai N", "0年目〜N年目")})</li>
                <li><code>Asumsi_Konfigurasi</code> (<code>[REAL DATA]</code>)</li>
              </ul>
              {sweepResult && (
                <label className="check-row">
                  <input type="checkbox" checked={includeSweepInExcel} onChange={(e) => setIncludeSweepInExcel(e.target.checked)} />
                  <span>
                    {tr(
                      lang,
                      <>Include <code>Hasil_Sapuan</code> sheet</>,
                      <>Sertakan sheet <code>Hasil_Sapuan</code></>,
                      <><code>Hasil_Sapuan</code> シートを含める</>,
                    )}
                  </span>
                </label>
              )}
              {sensitivityResult && (
                <label className="check-row">
                  <input type="checkbox" checked={includeSensInExcel} onChange={(e) => setIncludeSensInExcel(e.target.checked)} />
                  <span>
                    {tr(
                      lang,
                      <>Include <code>Sensitivitas</code> sheet</>,
                      <>Sertakan sheet <code>Sensitivitas</code></>,
                      <><code>Sensitivitas</code> シートを含める</>,
                    )}
                  </span>
                </label>
              )}

              {excelLoading && excelSlow && (
                <p className="note" style={{ marginTop: "0.5rem" }}>{slowEngineNoteFor(lang)}</p>
              )}
              {excelError && (
                <div className="state bad" role="alert" style={{ marginTop: "0.5rem" }}>
                  <p>{excelError}</p>
                </div>
              )}

              <div className="row">
                <button type="button" className="btn primary" disabled={excelLoading} onClick={() => void handleDownloadExcel()}>
                  {excelLoading
                    ? tr(lang, "Generating Excel...", "Lagi Menyusun Excel...", "Excelファイルを生成中...")
                    : tr(lang, "Download Excel Workbook (.xlsx)", "Unduh File Excel (.xlsx)", "Excelブック (.xlsx) をダウンロード")}
                </button>
              </div>
            </section>

            {/* Kartu 3: CSV 8.760 Jam & JSON */}
            <section className="card" aria-labelledby="h-exp-csv">
              <div className="card-header">
                <h2 id="h-exp-csv">{tr(lang, "Raw CSV & JSON Data", "Data Mentah CSV & JSON", "CSV・JSON生データ")}</h2>
                <span className="chip">{tr(lang, "8,760 Hours", "8.760 Jam", "8,760時間")}</span>
              </div>
              <p className="note">
                {tr(
                  lang,
                  "CSV files include a UTF-8 BOM marker so numeric columns open cleanly in Excel.",
                  "File CSV sudah dilengkapi UTF-8 BOM supaya begitu dibuka di Excel kolomnya langsung rapi.",
                  "CSVファイルはUTF-8 BOM付きで出力されるため、Excelでそのまま文字化けせずに開けます。",
                )}
              </p>
              {!result.hourly_year_1 && (
                <p className="note" style={{ marginTop: "0.5rem", color: "var(--warntext)" }}>
                  {tr(
                    lang,
                    "The 8,760-hour series is not cached in this result (for example due to browser storage limits). Re-run the simulation in Step 7 if you need hourly CSV.",
                    "Deret 8.760 jam tidak tersimpan di cache ini (karena batas memori browser). Jalankan ulang simulasi di Langkah 7 kalau butuh CSV per jam ya.",
                    "ブラウザ容量制限のため8,760時間シリーズがキャッシュされていません。時間別CSVが必要な場合はステップ7で再計算してください。",
                  )}
                </p>
              )}
              <div className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!result.hourly_year_1}
                  onClick={handleDownloadHourlyCsv}
                >
                  {tr(lang, "Download 8,760-Hour Time Series CSV", "Unduh CSV 8.760 Jam", "8,760時間時系列CSVをダウンロード")}
                </button>
                <button type="button" className="btn ghost" onClick={handleDownloadCashflowCsv}>
                  {tr(lang, "Download Annual Cash Flow CSV", "Unduh CSV Arus Kas Tahunan", "年次キャッシュフローCSVをダウンロード")}
                </button>
                {sweepResult && (
                  <button type="button" className="btn ghost" onClick={handleDownloadSweepCsv}>
                    {tr(lang, "Download Sweep Combinations CSV", "Unduh CSV Hasil Sizing (Sweep)", "容量スイープ結果CSVをダウンロード")}
                  </button>
                )}
                <button type="button" className="btn ghost" onClick={handleDownloadJson}>
                  {tr(lang, "Download Project & Result JSON Bundle", "Unduh Paket JSON Proyek & Hasil", "プロジェクト＆結果JSONバンドルを保存")}
                </button>
              </div>
            </section>
          </div>

          <div className="sec">
            <h2 className="no-print">
              {tr(
                lang,
                "Print Report Layout Preview (A4)",
                "Pratinjau Laporan Cetak (A4)",
                "印刷レポートプレビュー (A4)",
              )}
            </h2>
            <PrintReportPreview
              project={project}
              result={result}
              sweepResult={sweepResult}
              sections={sections}
            />
          </div>
        </>
      )}
    </HybridShell>
  );
}
