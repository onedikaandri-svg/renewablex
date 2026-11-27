"use client";

import Link from "next/link";
import { tr, usePreferences } from "@/lib/preferences";

const STEPS_GUIDE = [
  {
    num: 1,
    titleId: "Proyek",
    titleEn: "Projects",
    titleJa: "プロジェクト一覧",
    descId: "Bikin proyek baru, muat contoh [REAL DATA], duplikat skenario, atau simpan/buka file .hybrid.json.",
    descEn: "Create a project, load the [REAL DATA] sample, duplicate scenarios, or import/export .hybrid.json.",
    descJa: "新規作成、[REAL DATA]サンプル読込、シナリオ複製、または .hybrid.json の保存・読込を行います。",
  },
  {
    num: 2,
    titleId: "Lokasi & Cuaca",
    titleEn: "Location & Weather",
    titleJa: "地点・気象データ",
    descId: "Pilih titik di peta atau cari kota, lalu tarik data radiasi surya dan suhu 8.760 jam dari PVGIS v5.3 TMY.",
    descEn: "Set coordinates and timezone, then fetch hourly solar irradiance and temperature from PVGIS v5.3 TMY.",
    descJa: "地図や都市検索から座標・タイムゾーンを設定し、PVGIS v5.3 TMYから8,760時間の日射量・気温を取得します。",
  },
  {
    num: 3,
    titleId: "Profil Beban",
    titleEn: "Load Profile",
    titleJa: "電力負荷プロファイル",
    descId: "Atur profil beban harian atau unggah CSV 8.760 jam buat cek kurva beban dan heatmap tahunan.",
    descEn: "Build a deterministic synthetic load or upload an 8,760-hour CSV to preview daily profile and heatmap.",
    descJa: "パラメータから負荷曲線を生成するか、8,760時間CSVをアップロードして日負荷曲線とヒートマップを確認します。",
  },
  {
    num: 4,
    titleId: "Desain Sistem (Kanvas)",
    titleEn: "System Design (Canvas)",
    titleJa: "システム構成キャンバス",
    descId: "Susun PV, BESS, Biomass, Diesel Generator, dan Grid di kanvas interaktif yang nyambung ke AC Bus.",
    descEn: "Arrange PV, BESS, Biomass, Diesel Generator, and Grid on the interactive canvas connected to AC Bus and tune parameters.",
    descJa: "太陽光 (PV)、蓄電池 (BESS)、バイオマス、ディーゼル発電、電力系統をACバスへ接続し詳細仕様を設定します。",
  },
  {
    num: 5,
    titleId: "Strategi EMS",
    titleEn: "EMS Strategy",
    titleJa: "EMS運用戦略",
    descId: "Pilih 1 dari 5 strategi dispatch bawaan (Self-Consumption, Load Following, Cycle Charging, Peak Shaving, TOU).",
    descEn: "Choose 1 of 5 built-in dispatch strategies and set grid import/export permissions.",
    descJa: "5種類の標準ディスパッチ戦略（自家消費、負荷追従、サイクル充電、ピークカット、時間帯別料金）から選択します。",
  },
  {
    num: 6,
    titleId: "Ekonomi & Tarif",
    titleEn: "Economics & Tariffs",
    titleJa: "経済性・電力料金",
    descId: "Atur mata uang (IDR/USD), umur proyek, WACC, CAPEX, O&M, jadwal ganti komponen, dan tarif listrik.",
    descEn: "Configure currency, lifetime, WACC, CAPEX, O&M, replacements, and electricity tariffs.",
    descJa: "通貨 (IDR/USD)、事業期間、割引率 (WACC)、CAPEX、O&M、機器更新費用、電力単価を設定します。",
  },
  {
    num: 7,
    titleId: "Jalankan Simulasi",
    titleEn: "Run Simulation",
    titleJa: "シミュレーション実行",
    descId: "Gas jalankan mode cepat scaled_year_1 atau simulasi penuh multi-tahun full_hourly di mesin Python.",
    descEn: "Choose fast scaled_year_1 or full_hourly via async jobs on the Python calculation engine.",
    descJa: "高速な1年目スケールモード (scaled_year_1) または全期間時間別モード (full_hourly) をPythonエンジンで実行します。",
  },
  {
    num: 8,
    titleId: "Dasbor Hasil",
    titleEn: "Results Dashboard",
    titleJa: "結果ダッシュボード",
    descId: "Cek grafik energi bulanan, Sankey aliran energi, waterfall rugi PV, dispatch per jam, heatmap 8.760 jam, dan arus kas.",
    descEn: "Inspect monthly energy, Sankey flow, PV loss waterfall, hourly dispatch, duration curve, 8760h heatmaps, cash flows, and degradation.",
    descJa: "月別発電量、Sankeyエネルギーフロー、PV損失内訳、時間別ディスパッチ、8,760時間ヒートマップ、キャッシュフローを分析します。",
  },
  {
    num: 9,
    titleId: "Bandingkan & Sizing",
    titleEn: "Compare & Sweep",
    titleJa: "最適容量探索・比較",
    descId: "Cari ukuran komponen paling hemat gaya HOMER (hingga 64 kombinasi), bandingkan skenario, dan uji sensitivitas Tornado & 5x5.",
    descEn: "Run HOMER-style sweeps (up to 64 combos), compare up to 4 scenarios, and run Tornado + 5x5 sensitivity.",
    descJa: "HOMER方式の容量スイープ（最大64通り）、最大4シナリオの横並び比較、トルネード＆5x5感度分析を行います。",
  },
  {
    num: 10,
    titleId: "Ekspor Laporan",
    titleEn: "Export Reports",
    titleJa: "レポート・データ出力",
    descId: "Cetak/simpan Laporan PDF (A4) lengkap dengan skema SVG, unduh file Excel (.xlsx) multi-sheet, CSV 8.760 jam, dan JSON.",
    descEn: "Print/save A4 PDF report with vector SVG schematic, download multi-sheet Excel (.xlsx), 8760h CSV, and JSON.",
    descJa: "ベクターSVG構成図付きA4 PDFレポートの印刷・保存、マルチシートExcel (.xlsx)、8,760時間CSV、JSONを出力します。",
  },
];

const METRICS_GUIDE = [
  {
    term: "LCOE",
    descId: "Biaya rata-rata per kWh listrik sepanjang umur proyek (CAPEX, O&M, bahan bakar, penggantian, dikurangi nilai sisa/ekspor). Makin kecil makin hemat.",
    descEn: "Levelized cost per kWh over the project lifetime. Lower is more cost-effective.",
    descJa: "事業期間全体の均等化発電原価（1kWhあたりの平均コスト）。値が小さいほど経済的です。",
  },
  {
    term: "Total NPC",
    descId: "Total biaya bersih proyek saat ini (terdiskonto WACC) sepanjang umur proyek.",
    descEn: "Total discounted Net Present Cost over the project lifetime.",
    descJa: "割引率 (WACC) で現在価値に換算した事業期間全体の総正味現在コストです。",
  },
  {
    term: "NPV & IRR",
    descId: "NPV > 0 artinya proyek memberi nilai tambah di atas bunga diskonto. Proyek Layak bila NPV > 0 dan IRR >= WACC + margin 2%.",
    descEn: "NPV > 0 indicates net financial value above discount rate. Viable when NPV > 0 and IRR >= WACC + margin.",
    descJa: "NPV > 0 は割引率を上回る投資価値を示します。NPV > 0 かつ IRR >= WACC + 2% で「採算性あり」と判定されます。",
  },
  {
    term: "Simple / Discounted Payback",
    descId: "Berapa tahun modal investasi balik. Payback terdiskonto ikut menghitung nilai waktu uang jadi lebih realistis.",
    descEn: "Years to recover net capital. Discounted payback accounts for time value of money.",
    descJa: "初期投資の回収年数です。割引回収期間は資金の時間価値を考慮したより保守的な指標です。",
  },
  {
    term: "Renewable Share",
    descId: "Persentase beban yang dipasok energi bersih (PV dan Biomass terbarukan), di luar impor grid fosil dan genset Diesel.",
    descEn: "Share of served load met by renewable sources (PV and Biomass), excluding fossil grid import and non-renewable Diesel Generator.",
    descJa: "供給負荷のうち再生可能エネルギー（太陽光・バイオマス）で賄われた割合（系統買電・ディーゼル発電を除く）。",
  },
  {
    term: "Unmet Load & Curtailment",
    descId: "Unmet Load adalah beban yang tidak terlayani karena daya/baterai kurang; Curtailment adalah sisa energi PV yang terpaksa dibuang saat baterai penuh.",
    descEn: "Unmet Load is unserved demand; Curtailment is excess generation spilled when storage/export is full.",
    descJa: "Unmet Load は供給不足電力量、Curtailment は蓄電池満充電かつ売電不可時に抑制された余剰発電量です。",
  },
];

export default function HybridGuidePage() {
  const { lang } = usePreferences();

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {tr(lang, "User Documentation", "Panduan Singkat RenewableX", "ユーザーガイド・ドキュメント")}
          </p>
          <h1>
            {tr(
              lang,
              "How to Design & Analyze Hybrid Energy Systems",
              "Cara Rancang & Simulasi Sistem Energi Hybrid",
              "ハイブリッドエネルギーシステム設計・分析ガイド",
            )}
          </h1>
          <p className="lead">
            {tr(
              lang,
              "Step-by-step reference covering Quick PV mode vs Hybrid Studio, 8760-hour load CSV format, metrics glossary, and [REAL DATA] assumptions.",
              "Panduan praktis dari Mode Cepat PV sampai ekspor laporan hybrid, format CSV beban 8.760 jam, plus kamus metrik yang gampang dipahami.",
              "太陽光簡易試算とハイブリッド設計の違い、8,760時間CSVフォーマット、技術・財務指標の解説をまとめています。",
            )}
          </p>
        </div>
        <div className="actions-inline">
          <Link href="/hybrid" className="btn primary">
            {tr(lang, "Open Hybrid Projects", "Ke Daftar Proyek Hybrid", "プロジェクト一覧を開く")}
          </Link>
          <Link href="/" className="btn ghost">
            {tr(lang, "Quick PV Mode", "Coba Mode Cepat PV", "太陽光簡易試算へ")}
          </Link>
        </div>
      </div>

      <div className="grid-2">
        <section className="card" aria-labelledby="h-guide-modes">
          <div className="card-header">
            <h2 id="h-guide-modes">
              {tr(
                lang,
                "1. Quick PV vs Hybrid Studio",
                "1. Bedanya Mode Cepat PV vs Desain Hybrid",
                "1. 太陽光簡易試算とハイブリッド設計の使い分け",
              )}
            </h2>
          </div>
          <p className="note">
            <strong>{tr(lang, "Quick PV (/):", "Mode Cepat PV (/):", "太陽光簡易試算 (/):")}</strong>{" "}
            {tr(
              lang,
              "Best for rapid annual PV-only feasibility checks using annual yield without hourly dispatch or battery storage.",
              "Pas buat hitungan cepat kelayakan PLTS atap/lahan tanpa baterai, cukup pakai angka yield tahunan.",
              "蓄電池や時間別運用を含まない、年間発電量ベースの迅速な太陽光単独採算チェックに最適です。",
            )}
          </p>
          <p className="note" style={{ marginTop: "0.5rem" }}>
            <strong>{tr(lang, "Hybrid Studio (/hybrid):", "Desain Hybrid (/hybrid):", "ハイブリッド設計 (/hybrid):")}</strong>{" "}
            {tr(
              lang,
              "Runs full 8,760-step hourly energy balance (PV + BESS + Biomass + Diesel + EMS) up to 40 years, HOMER-style sweeps, and multi-sheet Excel/PDF reports.",
              "Menghitung simulasi detail 8.760 jam/tahun sampai 40 tahun untuk kombinasi PV, BESS, Biomass, Diesel, dan EMS, lengkap dengan sizing otomatis & laporan PDF/Excel.",
              "PV・蓄電池・バイオマス・ディーゼル・EMSの8,760時間エネルギー収支（最大40年）、最適容量スイープ、Excel/PDFレポート出力に対応します。",
            )}
          </p>
          <div className="warn" role="note" style={{ marginTop: "1rem", marginBottom: 0 }}>
            <h3>
              {tr(
                lang,
                "Server Cold Start Note & Local Backup",
                "Info Server Tidur (Cold Start) & Backup Data",
                "サーバー起動時間とローカルバックアップについて",
              )}
            </h3>
            <p className="note" style={{ color: "var(--warntext)" }}>
              {tr(
                lang,
                "If the free Render calculation engine has been idle for 15 minutes, the first request takes 30 to 60 seconds to wake up. Projects are saved in browser localStorage; export .hybrid.json regularly as a backup.",
                "Kalau server hitung gratis lagi tidur setelah 15 menit tidak dipakai, klik pertama butuh 30-50 detik buat bangun. Data proyek disimpan di browser, jadi jangan lupa ekspor file .hybrid.json buat cadangan ya!",
                "無料Renderサーバーが15分間アイドル状態の場合、初回リクエスト時に起動まで30〜60秒かかります。データはブラウザに保存されるため、定期的に .hybrid.json をエクスポートしてバックアップしてください。",
              )}
            </p>
          </div>
        </section>

        <section className="card" aria-labelledby="h-guide-csv">
          <div className="card-header">
            <h2 id="h-guide-csv">
              {tr(
                lang,
                "2. 8,760-Hour Load CSV Format",
                "2. Format File CSV Beban 8.760 Jam",
                "2. 8,760時間 電力負荷CSVフォーマット",
              )}
            </h2>
            <span className="chip">UTF-8 CSV</span>
          </div>
          <p className="note">
            {tr(
              lang,
              "Upload exactly 8,760 hourly load rows (non-leap year, excluding Feb 29). Single-column (kW) or two-column (waktu,load_kw) formats are supported, with non-negative finite numbers.",
              "Unggah file CSV berisi tepat 8.760 baris beban per jam (365 hari, tanpa 29 Feb). Bisa pakai 1 kolom (angka kW langsung) atau 2 kolom (waktu,load_kw) tanpa nilai minus atau kosong.",
              "平年365日分（2月29日を除く）の8,760行の時間別負荷データをアップロードできます。1列（kW値のみ）または2列（waktu,load_kw）形式に対応しています。",
            )}
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
              {tr(
                lang,
                "Download Sample 8,760h CSV",
                "Unduh Contoh CSV 8.760 Jam",
                "8,760時間サンプルCSVをダウンロード",
              )}
            </a>
          </div>
        </section>
      </div>

      <section className="sec card" aria-labelledby="h-guide-flow">
        <div className="card-header">
          <h2 id="h-guide-flow">
            {tr(
              lang,
              "3. 10-Step Hybrid Design Workflow",
              "3. Alur 10 Langkah Desain Hybrid",
              "3. ハイブリッド設計の10ステップ",
            )}
          </h2>
          <span className="chip">{tr(lang, "Steps 1 to 10", "Langkah 1 sampai 10", "ステップ 1 〜 10")}</span>
        </div>
        <div className="grid-2">
          {STEPS_GUIDE.map((st) => (
            <div key={st.num} className="project-card">
              <div>
                <div className="actions-inline" style={{ marginBottom: "0.35rem" }}>
                  <span className="step-num">{st.num}</span>
                  <strong style={{ color: "var(--navytext)" }}>{tr(lang, st.titleEn, st.titleId, st.titleJa)}</strong>
                </div>
                <p className="note">{tr(lang, st.descEn, st.descId, st.descJa)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="sec card" aria-labelledby="h-guide-metrics">
        <div className="card-header">
          <h2 id="h-guide-metrics">
            {tr(
              lang,
              "4. Technical & Financial Metrics Glossary",
              "4. Kamus Istilah Teknis & Keuangan",
              "4. 技術・財務指標の用語集",
            )}
          </h2>
        </div>
        <div className="tw tw-auto" tabIndex={0} role="region" aria-label={tr(lang, "Metrics glossary table", "Tabel kamus metrik", "用語集テーブル")}>
          <table className="sens-main">
            <caption>
              {tr(
                lang,
                "Definitions of main outputs calculated by the Python engine.",
                "Arti metrik utama yang dihitung mesin backend Python.",
                "Python計算エンジンが出力する主要指標の定義。",
              )}
            </caption>
            <thead>
              <tr>
                <th scope="col">{tr(lang, "Metric", "Metrik", "指標")}</th>
                <th scope="col">{tr(lang, "Meaning", "Arti & Cara Baca", "意味・見方")}</th>
              </tr>
            </thead>
            <tbody>
              {METRICS_GUIDE.map((item) => (
                <tr key={item.term}>
                  <th scope="row">{item.term}</th>
                  <td style={{ textAlign: "left" }}>{tr(lang, item.descEn, item.descId, item.descJa)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="sec card" aria-labelledby="h-guide-realdata">
        <div className="card-header">
          <h2 id="h-guide-realdata">
            {tr(
              lang,
              "5. [REAL DATA] Tag & Switching to Real Datasheets",
              "5. Arti Label [REAL DATA] & Kapan Diganti Data Vendor",
              "5. [REAL DATA] ラベルと実機データシートへの置き換え",
            )}
          </h2>
        </div>
        <p className="note">
          {tr(
            lang,
            "Sample defaults marked [REAL DATA] (such as PV/BESS CAPEX, fuel presets, and Indonesian grid emission factor 0.78 kg CO2e/kWh) are illustrative placeholders documented in docs/assumptions.md. Replace them in Pages 4 and 6 with your vendor datasheets and EPC quotes before investment decisions.",
            "Angka bawaan berlabel [REAL DATA] (seperti CAPEX PV/BESS, preset bahan bakar biomassa, dan faktor emisi grid 0,78 kg CO2e/kWh) adalah nilai referensi dari docs/assumptions.md supaya kamu bisa langsung simulasi. Sebelum dipakai buat keputusan investasi nyata, ganti angka di Halaman 4 dan Halaman 6 sesuai datasheet vendor dan penawaran EPC proyekmu.",
            "[REAL DATA] と記された初期値（PV/蓄電池のCAPEX、バイオマス燃料プリセット、系統排出係数 0.78 kg-CO2e/kWh など）は docs/assumptions.md に記載された参照値です。実際の投資判断を行う際は、ステップ4およびステップ6でメーカー仕様書やEPC見積値に置き換えてください。",
          )}
        </p>
      </section>
    </>
  );
}
