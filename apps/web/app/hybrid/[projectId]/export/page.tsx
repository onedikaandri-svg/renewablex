"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import HybridShell from "@/components/hybrid/HybridShell";
import PrintReportPreview, { type PrintReportSections } from "@/components/hybrid/PrintReportPreview";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import { SLOW_ENGINE_NOTE, downloadFile } from "@/lib/format";
import { downloadHybridExcelReport } from "@/lib/hybrid-api";
import { buildCashflowCsv, buildExportFilenameSlug, buildHourlyCsv, buildSweepCsv, downloadBlob } from "@/lib/hybrid-export";
import { getSensitivityResult, getSweepResult } from "@/lib/hybrid-storage";
import type { HybridSensitivityResponse, HybridSweepResult } from "@/lib/hybrid-types";
import { usePreferences } from "@/lib/preferences";
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
        <p>{lang === "en" ? "Loading report export page..." : "Memuat halaman ekspor laporan..."}</p>
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
        lang === "en"
          ? `Excel workbook "${filename}" downloaded.`
          : `Buku kerja Excel "${filename}" berhasil diunduh.`,
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
            : lang === "en"
              ? "Failed to generate Excel workbook."
              : "Gagal membuat berkas Excel.",
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
        lang === "en"
          ? "8,760-hour data is not available in this simulation cache. Re-run the simulation from Step 7."
          : "Data 8.760 jam tidak tersedia pada cache simulasi ini. Jalankan ulang simulasi dari Halaman 7.",
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
      title={lang === "en" ? "Export Reports & Raw Data" : "Ekspor Laporan PDF, Excel & Data Mentah"}
      subtitle={
        lang === "en"
          ? "Download presentation-ready engineering and financial reports in PDF format, multi-sheet Excel workbooks, or 8,760-hour CSV files."
          : "Unduh laporan teknik dan keuangan siap presentasi dalam format PDF, buku kerja Excel multi-sheet, maupun CSV 8.760 jam."
      }
      result={result}
    >
      {!result ? (
        <div className="state">
          <h2>
            {lang === "en"
              ? "No simulation results to export yet"
              : "Belum ada hasil simulasi untuk diekspor"}
          </h2>
          <p>
            {lang === "en"
              ? "PDF, Excel, and CSV reports require real simulation results from the backend calculation engine."
              : "Laporan PDF, Excel, dan CSV membutuhkan hasil simulasi nyata dari mesin hitung backend."}
          </p>
          <div className="row" style={{ borderTop: 0, paddingTop: "0.75rem", marginTop: "0.5rem" }}>
            <Link href={`/hybrid/${project.id}/run`} className="btn primary">
              {lang === "en" ? "Go to Step 7: Run Simulation" : "Ke Halaman 7: Jalankan Simulasi"}
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="grid-3 no-print">
            {/* Kartu 1: PDF Cetak A4 (Opsi P1) */}
            <section className="card" aria-labelledby="h-exp-pdf">
              <div className="card-header">
                <h2 id="h-exp-pdf">{lang === "en" ? "PDF Report (A4)" : "Laporan PDF (A4)"}</h2>
                <span className="chip">{lang === "en" ? "Crisp Vector" : "Vektor Tajam"}</span>
              </div>
              <p className="note">
                {lang === "en" ? (
                  <>
                    Formats an A4 print document with a light-theme Year 1 SVG Flow Schematic. Choose <strong>&ldquo;Save as PDF&rdquo;</strong> in your browser print dialog.
                  </>
                ) : (
                  <>
                    Menyusun dokumen cetak A4 dengan Skema Aliran SVG Tahun 1 bertema terang. Pilih <strong>&ldquo;Simpan sebagai PDF&rdquo;</strong> pada dialog cetak browser.
                  </>
                )}
              </p>
              <div className="fld">
                <label className="check-row">
                  <input type="checkbox" checked={sections.executive} onChange={(e) => setSections((s) => ({ ...s, executive: e.target.checked }))} />
                  <span>{lang === "en" ? "Executive Summary & KPIs" : "Ringkasan Eksekutif & KPI"}</span>
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={sections.schematic} onChange={(e) => setSections((s) => ({ ...s, schematic: e.target.checked }))} />
                  <span>{lang === "en" ? "Year 1 SVG Energy Schematic" : "Skema Aliran SVG Tahun 1"}</span>
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={sections.monthly} onChange={(e) => setSections((s) => ({ ...s, monthly: e.target.checked }))} />
                  <span>{lang === "en" ? "Monthly Energy Table" : "Tabel Energi Bulanan"}</span>
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={sections.cashflow} onChange={(e) => setSections((s) => ({ ...s, cashflow: e.target.checked }))} />
                  <span>{lang === "en" ? "Annual Cash Flow Table" : "Tabel Arus Kas Tahunan"}</span>
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={sections.assumptions} onChange={(e) => setSections((s) => ({ ...s, assumptions: e.target.checked }))} />
                  <span>{lang === "en" ? "Assumptions Appendix [REAL DATA]" : "Lampiran Asumsi [REAL DATA]"}</span>
                </label>
                {sweepResult && (
                  <label className="check-row">
                    <input type="checkbox" checked={sections.sweep} onChange={(e) => setSections((s) => ({ ...s, sweep: e.target.checked }))} />
                    <span>{lang === "en" ? "Sweep Results Summary" : "Ringkasan Hasil Sapuan"}</span>
                  </label>
                )}
              </div>
              <div className="row">
                <button type="button" className="btn primary" onClick={() => window.print()}>
                  {lang === "en" ? "Print / Save as PDF" : "Cetak / Simpan sebagai PDF"}
                </button>
              </div>
            </section>

            {/* Kartu 2: Buku Kerja Excel .xlsx (Opsi E1 Backend) */}
            <section className="card" aria-labelledby="h-exp-xlsx">
              <div className="card-header">
                <h2 id="h-exp-xlsx">{lang === "en" ? "Excel Workbook (.xlsx)" : "Buku Kerja Excel (.xlsx)"}</h2>
                <span className="chip">Multi-Sheet</span>
              </div>
              <p className="note">
                {lang === "en" ? (
                  <>
                    Generated directly by the Python backend (<code>openpyxl</code>) with ready-to-use number formatting:
                  </>
                ) : (
                  <>
                    Dibuat langsung oleh backend Python (<code>openpyxl</code>) dengan format angka siap pakai:
                  </>
                )}
              </p>
              <ul style={{ margin: "0.5rem 0", paddingLeft: "1.25rem", fontSize: "0.875rem", color: "var(--muted)" }}>
                <li><code>Ringkasan</code> ({lang === "en" ? "KPIs, LCOE, Emissions" : "KPI, LCOE, Emisi"})</li>
                <li><code>Energi_Bulanan</code> ({lang === "en" ? "12 months + Total" : "12 bulan + Total"})</li>
                <li><code>Arus_Kas_Tahunan</code> ({lang === "en" ? "Year 0 to N" : "Tahun 0 sampai N"})</li>
                <li><code>Asumsi_Konfigurasi</code> (<code>[REAL DATA]</code>)</li>
              </ul>
              {sweepResult && (
                <label className="check-row">
                  <input type="checkbox" checked={includeSweepInExcel} onChange={(e) => setIncludeSweepInExcel(e.target.checked)} />
                  <span>
                    {lang === "en" ? (
                      <>
                        Include <code>Hasil_Sapuan</code> sheet
                      </>
                    ) : (
                      <>
                        Sertakan sheet <code>Hasil_Sapuan</code>
                      </>
                    )}
                  </span>
                </label>
              )}
              {sensitivityResult && (
                <label className="check-row">
                  <input type="checkbox" checked={includeSensInExcel} onChange={(e) => setIncludeSensInExcel(e.target.checked)} />
                  <span>
                    {lang === "en" ? (
                      <>
                        Include <code>Sensitivitas</code> sheet
                      </>
                    ) : (
                      <>
                        Sertakan sheet <code>Sensitivitas</code>
                      </>
                    )}
                  </span>
                </label>
              )}

              {excelLoading && excelSlow && (
                <p className="note" style={{ marginTop: "0.5rem" }}>{SLOW_ENGINE_NOTE}</p>
              )}
              {excelError && (
                <div className="state bad" role="alert" style={{ marginTop: "0.5rem" }}>
                  <p>{excelError}</p>
                </div>
              )}

              <div className="row">
                <button type="button" className="btn primary" disabled={excelLoading} onClick={() => void handleDownloadExcel()}>
                  {excelLoading
                    ? lang === "en"
                      ? "Generating Excel..."
                      : "Menyusun Excel..."
                    : lang === "en"
                      ? "Download Excel Workbook (.xlsx)"
                      : "Unduh Buku Kerja Excel (.xlsx)"}
                </button>
              </div>
            </section>

            {/* Kartu 3: CSV 8.760 Jam & JSON */}
            <section className="card" aria-labelledby="h-exp-csv">
              <div className="card-header">
                <h2 id="h-exp-csv">{lang === "en" ? "Raw CSV & JSON Data" : "Data Mentah CSV & JSON"}</h2>
                <span className="chip">{lang === "en" ? "8,760 Hours" : "8.760 Jam"}</span>
              </div>
              <p className="note">
                {lang === "en"
                  ? "CSV files include a UTF-8 BOM marker so numeric columns open cleanly in Excel."
                  : "Berkas CSV sudah dilengkapi penanda UTF-8 BOM agar kolom angka langsung terbuka rapi di Excel."}
              </p>
              {!result.hourly_year_1 && (
                <p className="note" style={{ marginTop: "0.5rem", color: "var(--warntext)" }}>
                  {lang === "en"
                    ? "The 8,760-hour series is not cached in this result (for example due to browser storage limits). Re-run the simulation in Step 7 if you need hourly CSV."
                    : "Deret 8.760 jam tidak tersimpan di cache hasil ini (misalnya karena kuota browser). Jalankan ulang simulasi di Halaman 7 jika membutuhkan CSV per jam."}
                </p>
              )}
              <div className="row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={!result.hourly_year_1}
                  onClick={handleDownloadHourlyCsv}
                >
                  {lang === "en" ? "Download 8,760-Hour Time Series CSV" : "Unduh CSV Deret Waktu 8.760 Jam"}
                </button>
                <button type="button" className="btn ghost" onClick={handleDownloadCashflowCsv}>
                  {lang === "en" ? "Download Annual Cash Flow CSV" : "Unduh CSV Arus Kas Tahunan"}
                </button>
                {sweepResult && (
                  <button type="button" className="btn ghost" onClick={handleDownloadSweepCsv}>
                    {lang === "en" ? "Download Sweep Combinations CSV" : "Unduh CSV Hasil Sapuan Kombinasi"}
                  </button>
                )}
                <button type="button" className="btn ghost" onClick={handleDownloadJson}>
                  {lang === "en" ? "Download Project & Result JSON Bundle" : "Unduh Berkas Proyek & Hasil JSON"}
                </button>
              </div>
            </section>
          </div>

          <div className="sec">
            <h2 className="no-print">
              {lang === "en" ? "Print Report Layout Preview (A4)" : "Pratinjau Tata Letak Laporan Cetak (A4)"}
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
