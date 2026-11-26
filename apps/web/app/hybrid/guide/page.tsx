"use client";

import Link from "next/link";
import { usePreferences } from "@/lib/preferences";

const STEPS_GUIDE = [
  { num: 1, titleId: "Proyek", titleEn: "Projects", descId: "Buat proyek baru, muat contoh [REAL DATA], duplikat skenario, atau impor/ekspor berkas .hybrid.json.", descEn: "Create a project, load the [REAL DATA] sample, duplicate scenarios, or import/export .hybrid.json." },
  { num: 2, titleId: "Lokasi & Cuaca", titleEn: "Location & Weather", descId: "Isi koordinat dan zona waktu, lalu ambil data radiasi surya dan suhu per jam dari PVGIS v5.3 TMY.", descEn: "Set coordinates and timezone, then fetch hourly solar irradiance and temperature from PVGIS v5.3 TMY." },
  { num: 3, titleId: "Profil Beban", titleEn: "Load Profile", descId: "Bangun beban sintetis deterministik atau unggah CSV 8.760 jam untuk memeriksa profil harian dan peta panas.", descEn: "Build a deterministic synthetic load or upload an 8,760-hour CSV to preview daily profile and heatmap." },
  { num: 4, titleId: "Desain Sistem (Kanvas)", titleEn: "System Design (Canvas)", descId: "Susun PV, BESS, Biomass, dan Grid pada kanvas interaktif yang terhubung ke AC Bus dan atur parameternya.", descEn: "Arrange PV, BESS, Biomass, and Grid on the interactive canvas connected to AC Bus and tune parameters." },
  { num: 5, titleId: "Strategi EMS", titleEn: "EMS Strategy", descId: "Pilih 1 dari 5 strategi dispatch bawaan (Self-Consumption, Load Following, Cycle Charging, Peak Shaving, TOU).", descEn: "Choose 1 of 5 built-in dispatch strategies and set grid import/export permissions." },
  { num: 6, titleId: "Ekonomi & Tarif", titleEn: "Economics & Tariffs", descId: "Tetapkan mata uang (IDR/USD), umur proyek, WACC, CAPEX, O&M, penggantian komponen, dan tarif listrik.", descEn: "Configure currency, lifetime, WACC, CAPEX, O&M, replacements, and electricity tariffs." },
  { num: 7, titleId: "Jalankan Simulasi", titleEn: "Run Simulation", descId: "Pilih mode cepat scaled_year_1 atau full_hourly via job asinkron di mesin hitung Python.", descEn: "Choose fast scaled_year_1 or full_hourly via async jobs on the Python calculation engine." },
  { num: 8, titleId: "Dasbor Hasil", titleEn: "Results Dashboard", descId: "Analisis energi bulanan, Sankey aliran energi, waterfall rugi PV, dispatch per jam, kurva durasi, peta panas 8.760 jam, arus kas, dan degradasi kapasitas.", descEn: "Inspect monthly energy, Sankey flow, PV loss waterfall, hourly dispatch, duration curve, 8760h heatmaps, cash flows, and degradation." },
  { num: 9, titleId: "Bandingkan & Sapuan", titleEn: "Compare & Sweep", descId: "Jalankan sapuan kombinasi gaya HOMER (hingga 64 kombinasi), bandingkan hingga 4 skenario, dan uji Tornado serta Matriks 5x5.", descEn: "Run HOMER-style sweeps (up to 64 combos), compare up to 4 scenarios, and run Tornado + 5x5 sensitivity." },
  { num: 10, titleId: "Ekspor Laporan", titleEn: "Export Reports", descId: "Cetak/simpan Laporan PDF (A4) dengan skema SVG, unduh Excel (.xlsx) multi-sheet, CSV 8.760 jam, dan JSON.", descEn: "Print/save A4 PDF report with vector SVG schematic, download multi-sheet Excel (.xlsx), 8760h CSV, and JSON." },
];

const METRICS_GUIDE = [
  { term: "LCOE", descId: "Biaya rata-rata per kWh listrik sepanjang umur proyek (CAPEX, O&M, bahan bakar, penggantian, dikurangi nilai sisa/ekspor). Makin kecil makin hemat.", descEn: "Levelized cost per kWh over the project lifetime. Lower is more cost-effective." },
  { term: "Total NPC", descId: "Total biaya bersih proyek saat ini (terdiskonto WACC) sepanjang umur proyek.", descEn: "Total discounted Net Present Cost over the project lifetime." },
  { term: "NPV & IRR", descId: "NPV > 0 menandakan nilai tambah finansial di atas tingkat diskonto. Proyek Layak bila NPV > 0 dan IRR >= WACC + margin kelayakan (2%).", descEn: "NPV > 0 indicates net financial value above discount rate. Viable when NPV > 0 and IRR >= WACC + margin." },
  { term: "Payback Sederhana / Terdiskonto", descId: "Waktu kembali modal investasi. Payback terdiskonto menghitung nilai waktu uang sehingga lebih konservatif.", descEn: "Years to recover net capital. Discounted payback accounts for time value of money." },
  { term: "Pangsa Terbarukan", descId: "Persentase beban terlayani oleh sumber terbarukan (PV dan Biomass terbarukan), di luar impor grid fosil.", descEn: "Share of served load met by renewable sources excluding fossil grid import." },
  { term: "Unmet Load & Curtailment", descId: "Unmet Load adalah beban gagal terlayani karena pasokan/baterai kurang; Curtailment adalah surplus pembangkit yang terpaksa dibuang.", descEn: "Unmet Load is unserved demand; Curtailment is excess generation spilled when storage/export is full." },
];

export default function HybridGuidePage() {
  const { lang } = usePreferences();
  const isEn = lang === "en";

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">{isEn ? "User Documentation" : "Panduan Pengguna RenewableX"}</p>
          <h1>{isEn ? "How to Design & Analyze Hybrid Energy Systems" : "Panduan Penggunaan Sistem Energi Hybrid"}</h1>
          <p className="lead">
            {isEn
              ? "Step-by-step reference covering Quick PV mode vs Hybrid Studio, 8760-hour load CSV format, metrics glossary, and [REAL DATA] assumptions."
              : "Panduan ringkas langkah demi langkah dari Mode Cepat PV sampai ekspor laporan sistem hybrid, format CSV beban 8.760 jam, dan arti metrik."}
          </p>
        </div>
        <div className="actions-inline">
          <Link href="/hybrid" className="btn primary">
            {isEn ? "Open Hybrid Projects" : "Buka Daftar Proyek Hybrid"}
          </Link>
          <Link href="/" className="btn ghost">
            {isEn ? "Quick PV Mode" : "Buka Mode Cepat PV"}
          </Link>
        </div>
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="h-guide-modes">
          <div className="card-header">
            <h2 id="h-guide-modes">{isEn ? "1. Quick PV vs Hybrid Studio" : "1. Mode Cepat PV vs Desain Hybrid"}</h2>
          </div>
          <p className="note">
            <strong>{isEn ? "Quick PV (/):" : "Mode Cepat PV (/):"}</strong>{" "}
            {isEn
              ? "Best for rapid annual PV-only feasibility checks using annual yield without hourly dispatch or battery storage."
              : "Cocok untuk perkiraan awal kelayakan PLTS tanpa baterai memakai yield tahunan dan arus kas cepat."}
          </p>
          <p className="note" style={{ marginTop: "0.5rem" }}>
            <strong>{isEn ? "Hybrid Studio (/hybrid):" : "Desain Sistem Hybrid (/hybrid):"}</strong>{" "}
            {isEn
              ? "Runs full 8,760-step hourly energy balance (PV + BESS + Biomass + EMS) up to 40 years, HOMER-style sweeps, and multi-sheet Excel/PDF reports."
              : "Menjalankan neraca daya per jam (8.760 langkah/tahun) hingga 40 tahun untuk PV, BESS, Biomass, dan EMS, lengkap dengan sapuan HOMER serta ekspor PDF/Excel."}
          </p>
          <div className="warn" role="note" style={{ marginTop: "1rem", marginBottom: 0 }}>
            <h3>{isEn ? "Server Cold Start Note & Local Backup" : "Catatan Cold Start Server & Cadangan Data"}</h3>
            <p className="note" style={{ color: "var(--warntext)" }}>
              {isEn
                ? "If the free Render calculation engine has been idle for 15 minutes, the first request takes 30 to 60 seconds to wake up. Projects are saved in browser localStorage; export .hybrid.json regularly as a backup."
                : "Jika mesin hitung Render gratis tidur setelah 15 menit tidak aktif, permintaan pertama membutuhkan 30 sampai 60 detik. Proyek tersimpan di localStorage browser; ekspor berkas .hybrid.json secara berkala sebagai cadangan."}
            </p>
          </div>
        </section>

        <section className="card" aria-labelledby="h-guide-csv">
          <div className="card-header">
            <h2 id="h-guide-csv">{isEn ? "2. 8,760-Hour Load CSV Format" : "2. Format CSV Beban 8.760 Jam"}</h2>
            <span className="chip">UTF-8 CSV</span>
          </div>
          <p className="note">
            {isEn
              ? "Upload exactly 8,760 hourly load rows (non-leap year, excluding Feb 29). Single-column (kW) or two-column (waktu,load_kw) formats are supported, with non-negative finite numbers."
              : "Unggah tepat 8.760 baris beban per jam (365 hari, tanpa 29 Februari). Mendukung 1 kolom (nilai kW) atau 2 kolom (waktu,load_kw) dengan pemisah koma atau titik koma tanpa nilai negatif/kosong."}
          </p>
          <pre
            style={{
              margin: "0.75rem 0",
              padding: "0.75rem",
              background: "var(--surface-subtle)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              fontSize: "0.8125rem",
              overflowX: "auto",
            }}
          >{`waktu,load_kw\n01-01 00:00,142.844\n01-01 01:00,129.023\n01-01 02:00,138.821\n01-01 03:00,142.501`}</pre>
          <div className="actions-inline">
            <a href="/sample-load-8760.csv" download="sample-load-8760.csv" className="btn primary">
              {isEn ? "Download Sample 8,760h CSV" : "Unduh Contoh CSV 8.760 Jam"}
            </a>
          </div>
        </section>
      </div>

      <section className="sec card" aria-labelledby="h-guide-flow">
        <div className="card-header">
          <h2 id="h-guide-flow">{isEn ? "3. 10-Step Hybrid Design Workflow" : "3. Alur Lengkap 10 Halaman Desain Hybrid"}</h2>
          <span className="chip">Halaman 1 sampai 10</span>
        </div>
        <div className="grid-2">
          {STEPS_GUIDE.map((st) => (
            <div key={st.num} className="project-card">
              <div>
                <div className="actions-inline" style={{ marginBottom: "0.35rem" }}>
                  <span className="step-num">{st.num}</span>
                  <strong style={{ color: "var(--navytext)" }}>{isEn ? st.titleEn : st.titleId}</strong>
                </div>
                <p className="note">{isEn ? st.descEn : st.descId}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="sec card" aria-labelledby="h-guide-metrics">
        <div className="card-header">
          <h2 id="h-guide-metrics">{isEn ? "4. Technical & Financial Metrics Glossary" : "4. Kamus Metrik Teknis & Keuangan"}</h2>
        </div>
        <div className="tw tw-auto" tabIndex={0} role="region" aria-label={isEn ? "Metrics glossary table" : "Tabel kamus metrik"}>
          <table className="sens-main">
            <caption>{isEn ? "Definitions of main outputs calculated by the Python engine." : "Penjelasan metrik utama yang dihitung mesin backend Python."}</caption>
            <thead>
              <tr>
                <th scope="col">{isEn ? "Metric" : "Metrik"}</th>
                <th scope="col">{isEn ? "Meaning" : "Arti & Cara Membaca"}</th>
              </tr>
            </thead>
            <tbody>
              {METRICS_GUIDE.map((item) => (
                <tr key={item.term}>
                  <th scope="row">{item.term}</th>
                  <td style={{ textAlign: "left" }}>{isEn ? item.descEn : item.descId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sec card" aria-labelledby="h-guide-realdata">
        <div className="card-header">
          <h2 id="h-guide-realdata">{isEn ? "5. [REAL DATA] Tag & Switching to Real Datasheets" : "5. Penanda [REAL DATA] & Penggantian ke Data Nyata"}</h2>
        </div>
        <p className="note">
          {isEn
            ? "Sample defaults marked [REAL DATA] (such as PV/BESS CAPEX, fuel presets, and Indonesian grid emission factor 0.78 kg CO2e/kWh) are illustrative placeholders documented in docs/assumptions.md. Replace them in Pages 4 and 6 with your vendor datasheets and EPC quotes before investment decisions."
            : "Nilai contoh berlabel [REAL DATA] (seperti CAPEX PV/BESS, 5 preset bahan bakar biomassa, dan faktor emisi grid 0,78 kg CO2e/kWh) adalah nilai acuan sementara yang tercatat di docs/assumptions.md. Ganti parameter di Halaman 4 dan Halaman 6 dengan datasheet komponen serta penawaran EPC proyek asli Anda sebelum keputusan investasi."}
        </p>
      </section>
    </>
  );
}
