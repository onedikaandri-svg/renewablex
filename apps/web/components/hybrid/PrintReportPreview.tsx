"use client";

import { useEffect, useRef, useState } from "react";
import { ViabilityChip } from "@/components/hybrid/HybridShell";
import SystemSchematicSvg from "@/components/hybrid/SystemSchematicSvg";
import { formatCompactCurrency, formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { serializeSchematicSvgWithLightTheme } from "@/lib/hybrid-topology";
import type { HybridProjectConfig, HybridSimulateResponse, HybridSweepResult } from "@/lib/hybrid-types";
import { tr, usePreferences } from "@/lib/preferences";

export interface PrintReportSections {
  executive: boolean;
  schematic: boolean;
  monthly: boolean;
  cashflow: boolean;
  assumptions: boolean;
  sweep: boolean;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export default function PrintReportPreview({
  project,
  result,
  sweepResult,
  sections,
}: {
  project: HybridProjectConfig;
  result: HybridSimulateResponse;
  sweepResult: HybridSweepResult | null;
  sections: PrintReportSections;
}) {
  const { lang } = usePreferences();
  const schematicHostRef = useRef<HTMLDivElement | null>(null);
  const [lightSchematicSvg, setLightSchematicSvg] = useState<string>("");

  const fin = result.finance_summary;
  const em = result.emissions_summary;
  const curr = fin?.currency_code ?? project.project.currency_code;

  // Bangun salinan SVG bertema cetak terang agar tajam saat dicetak meskipun UI aktif memakai Mode Gelap.
  useEffect(() => {
    if (!sections.schematic || !schematicHostRef.current) return;
    const svgEl = schematicHostRef.current.querySelector("svg");
    if (svgEl) {
      setLightSchematicSvg(serializeSchematicSvgWithLightTheme(svgEl));
    }
  }, [sections.schematic, project, result]);

  return (
    <div className="print-report-sheet" aria-label="Pratinjau laporan cetak A4">
      {/* Elemen tersembunyi untuk menyalin SVG murni bertema terang lewat serializeSchematicSvgWithLightTheme */}
      <div ref={schematicHostRef} className="no-print" style={{ position: "absolute", left: "-9999px", width: "680px", pointerEvents: "none" }} aria-hidden="true">
        <SystemSchematicSvg config={project} result={result} />
      </div>

      <div className="print-header">
        <div>
          <p className="print-eyebrow">RenewableX Hybrid Engineering Report</p>
          <h2 style={{ margin: "0.2rem 0 0.25rem", color: "#061B31" }}>{project.project.project_name}</h2>
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "#5A687D" }}>
            {tr(lang, "Location", "Lokasi", "地点")}: {project.project.latitude}, {project.project.longitude} ({project.project.timezone}) | {tr(lang, "Weather", "Cuaca", "気象データ")}: {result.weather_source.provider} ({result.weather_source.dataset ?? "TMY"}) | Engine v{result.engine_version}
          </p>
        </div>
        <div>
          <ViabilityChip status={fin?.viability_status ?? null} />
        </div>
      </div>

      {sections.executive && (
        <section className="print-block">
          <h3>
            {tr(
              lang,
              "1. Executive Summary (Technical, Financial & Emissions)",
              "1. Ringkasan Eksekutif (Teknis, Keuangan, dan Emisi)",
              "1. エグゼクティブサマリー（技術・財務・CO2削減）",
            )}
          </h3>
          <div className="print-kpi-grid">
            <div className="print-kpi">
              <span>NPV ({fin?.project_lifetime_years ?? 25} {tr(lang, "yrs", "thn", "年")})</span>
              <strong>{fin ? formatCompactCurrency(fin.npv, curr, lang) : "-"}</strong>
            </div>
            <div className="print-kpi">
              <span>{tr(lang, "Project IRR", "IRR Proyek", "プロジェクトIRR")}</span>
              <strong>{fin && fin.irr !== null ? formatPercent(fin.irr, lang, 2) : tr(lang, "N/A", "Tidak tersedia", "該当なし")}</strong>
            </div>
            <div className="print-kpi">
              <span>LCOE</span>
              <strong>{fin ? `${formatCurrency(fin.lcoe, curr, lang, 0)}/kWh` : "-"}</strong>
            </div>
            <div className="print-kpi">
              <span>{tr(lang, "Simple / Disc. Payback", "Payback Sederhana / Terdiskonto", "回収期間（単純／割引）")}</span>
              <strong>
                {fin && fin.simple_payback_years !== null ? `${formatNumber(fin.simple_payback_years, lang, 1)} ${tr(lang, "yrs", "thn", "年")}` : "-"} /{" "}
                {fin && fin.discounted_payback_years !== null ? `${formatNumber(fin.discounted_payback_years, lang, 1)} ${tr(lang, "yrs", "thn", "年")}` : "-"}
              </strong>
            </div>
            <div className="print-kpi">
              <span>{tr(lang, "Renewable Share", "Porsi Terbarukan", "再エネ比率")}</span>
              <strong>{formatPercent(result.summary.renewable_fraction, lang, 1)}</strong>
            </div>
            <div className="print-kpi">
              <span>{tr(lang, "Avoided Emissions", "Emisi Dihindari", "CO2削減量")}</span>
              <strong>{em ? `${formatNumber(em.avoided_emissions_tons_co2e, lang, 0)} ${tr(lang, "tCO2e", "ton CO2e", "t-CO2e")}` : "-"}</strong>
            </div>
          </div>

          <p className="print-note">
            <strong>{tr(lang, "Year 1 Performance:", "Kinerja Tahun 1:", "1年目実績:")}</strong>{" "}
            {tr(
              lang,
              `Total load ${formatNumber(result.summary.total_load_kwh / 1000, lang, 1)} MWh, PV generation ${formatNumber(result.summary.pv_generation_kwh / 1000, lang, 1)} MWh, Biomass generation ${formatNumber(result.summary.biomass_generation_kwh / 1000, lang, 1)} MWh, Diesel generation ${formatNumber((result.summary.diesel_generation_kwh ?? 0) / 1000, lang, 1)} MWh, served load ${formatNumber(result.summary.served_load_kwh / 1000, lang, 1)} MWh, unmet load ${formatNumber(result.summary.unmet_load_kwh / 1000, lang, 1)} MWh, max power balance error ${result.summary.max_balance_error_kw.toExponential(2)} kW.`,
              `Total beban ${formatNumber(result.summary.total_load_kwh / 1000, lang, 1)} MWh, produksi PV ${formatNumber(result.summary.pv_generation_kwh / 1000, lang, 1)} MWh, produksi Biomass ${formatNumber(result.summary.biomass_generation_kwh / 1000, lang, 1)} MWh, produksi Diesel ${formatNumber((result.summary.diesel_generation_kwh ?? 0) / 1000, lang, 1)} MWh, beban terpenuhi ${formatNumber(result.summary.served_load_kwh / 1000, lang, 1)} MWh, unmet load ${formatNumber(result.summary.unmet_load_kwh / 1000, lang, 1)} MWh, selisih neraca daya maks ${result.summary.max_balance_error_kw.toExponential(2)} kW.`,
              `総負荷 ${formatNumber(result.summary.total_load_kwh / 1000, lang, 1)} MWh、PV発電量 ${formatNumber(result.summary.pv_generation_kwh / 1000, lang, 1)} MWh、バイオマス発電量 ${formatNumber(result.summary.biomass_generation_kwh / 1000, lang, 1)} MWh、ディーゼル発電量 ${formatNumber((result.summary.diesel_generation_kwh ?? 0) / 1000, lang, 1)} MWh、供給済負荷 ${formatNumber(result.summary.served_load_kwh / 1000, lang, 1)} MWh、未供給負荷 ${formatNumber(result.summary.unmet_load_kwh / 1000, lang, 1)} MWh、電力収支最大誤差 ${result.summary.max_balance_error_kw.toExponential(2)} kW。`,
            )}
          </p>
        </section>
      )}

      {sections.schematic && (
        <section className="print-block">
          <h3>
            {tr(
              lang,
              "2. Hybrid System Energy Flow Schematic (Year 1)",
              "2. Skema Aliran Energi Sistem Hybrid (Tahun 1)",
              "2. ハイブリッドシステム・エネルギー潮流図（1年目）",
            )}
          </h3>
          {lightSchematicSvg ? (
            <div
              className="print-svg-frame"
              dangerouslySetInnerHTML={{ __html: lightSchematicSvg }}
            />
          ) : (
            <SystemSchematicSvg config={project} result={result} />
          )}
        </section>
      )}

      {sections.monthly && (
        <section className="print-block">
          <h3>
            {tr(
              lang,
              "3. Monthly Energy Summary (MWh)",
              "3. Ringkasan Energi Bulanan (MWh)",
              "3. 月別エネルギー収支サマリー (MWh)",
            )}
          </h3>
          <table className="print-table">
            <thead>
              <tr>
                <th>Bulan</th>
                <th>Beban</th>
                <th>PV</th>
                <th>Biomass</th>
                <th>Diesel</th>
                <th>BESS Dis.</th>
                <th>Grid Imp.</th>
                <th>Unmet</th>
              </tr>
            </thead>
            <tbody>
              {result.monthly.map((m) => (
                <tr key={m.month}>
                  <td>{MONTH_NAMES[m.month - 1] ?? m.month}</td>
                  <td>{formatNumber(m.load_kwh / 1000, lang, 1)}</td>
                  <td>{formatNumber(m.pv_generation_kwh / 1000, lang, 1)}</td>
                  <td>{formatNumber(m.biomass_generation_kwh / 1000, lang, 1)}</td>
                  <td>{formatNumber((m.diesel_generation_kwh ?? 0) / 1000, lang, 1)}</td>
                  <td>{formatNumber(m.bess_discharge_kwh / 1000, lang, 1)}</td>
                  <td>{formatNumber(m.grid_import_kwh / 1000, lang, 1)}</td>
                  <td>{formatNumber(m.unmet_load_kwh / 1000, lang, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {sections.cashflow && (
        <section className="print-block">
          <h3>4. Ringkasan Arus Kas Tahunan ({curr})</h3>
          <table className="print-table">
            <thead>
              <tr>
                <th>Thn</th>
                <th>CAPEX</th>
                <th>Pendapatan</th>
                <th>O&amp;M + BB</th>
                <th>Penggantian</th>
                <th>Arus Kas Bersih</th>
                <th>Kumulatif</th>
              </tr>
            </thead>
            <tbody>
              {result.cashflow_schedule.map((row) => (
                <tr key={row.year}>
                  <td>{row.year}</td>
                  <td>{formatCompactCurrency(row.capex_outflow, curr, lang)}</td>
                  <td>{formatCompactCurrency(row.gross_revenue_or_savings + row.export_revenue, curr, lang)}</td>
                  <td>{formatCompactCurrency(row.om_cost + row.fuel_and_logistics_cost + row.grid_import_cost, curr, lang)}</td>
                  <td>{formatCompactCurrency(row.replacement_and_overhaul_cost, curr, lang)}</td>
                  <td>{formatCompactCurrency(row.net_cash_flow, curr, lang)}</td>
                  <td>{formatCompactCurrency(row.cumulative_cash_flow, curr, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {sections.assumptions && (
        <section className="print-block">
          <h3>5. Lampiran Asumsi dan Parameter Desain [REAL DATA]</h3>
          <p className="print-note">
            <strong>Solar PV:</strong> {project.components.pv.capacity_kwp} kWp, inverter {project.components.pv.inverter_ac_kw} kW, model {project.components.pv.model}, degradasi {formatPercent(project.components.pv.annual_degradation_fraction, lang, 2)}/thn [REAL DATA].
          </p>
          <p className="print-note">
            <strong>BESS:</strong> {project.components.bess.enabled ? `${project.components.bess.nominal_capacity_kwh} kWh (${project.components.bess.max_charge_kw}/${project.components.bess.max_discharge_kw} kW, SOC ${Math.round(project.components.bess.soc_min_fraction * 100)}% - ${Math.round(project.components.bess.soc_max_fraction * 100)}%)` : "Nonaktif"} [REAL DATA].
          </p>
          <p className="print-note">
            <strong>Biomass:</strong> {project.components.biomass.enabled ? `${project.components.biomass.rated_capacity_kw} kW, bahan bakar ${project.components.biomass.fuel_preset}, pasokan ${project.components.biomass.supply_period}` : "Nonaktif"} [REAL DATA].
          </p>
          <p className="print-note">
            <strong>Diesel Generator:</strong> {project.components.diesel?.enabled ? `${project.components.diesel.rated_capacity_kw} kW, kurva ${project.components.diesel.fuel_curve_model}, bahan bakar ${formatCurrency(project.components.diesel.fuel_price_per_liter, curr, lang, 0)}/L, emisi ${project.components.diesel.emission_factor_kg_co2e_per_liter} kg CO2e/L (non-terbarukan)` : "Nonaktif"} [REAL DATA].
          </p>
          <p className="print-note">
            <strong>EMS &amp; Ekonomi:</strong> Strategi {project.simulation.dispatch_strategy}, umur {project.simulation.project_lifetime_years} tahun ({project.simulation.multi_year_mode}), WACC {formatPercent(project.finance.discount_rate, lang, 1)}, tarif {formatCurrency(project.finance.electricity_tariff_per_kwh, curr, lang, 0)}/kWh, faktor emisi grid {project.finance.grid_emission_factor_kg_co2e_per_kwh} kg CO2e/kWh [REAL DATA].
          </p>
        </section>
      )}

      {sections.sweep && sweepResult && sweepResult.combinations.length > 0 && (
        <section className="print-block">
          <h3>6. Ringkasan Peringkat Teratas Sapuan Kombinasi</h3>
          <table className="print-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Kombinasi</th>
                <th>LCOE</th>
                <th>Total NPC</th>
                <th>NPV</th>
                <th>Terbarukan</th>
              </tr>
            </thead>
            <tbody>
              {sweepResult.combinations.slice(0, 8).map((c) => (
                <tr key={c.combination_id}>
                  <td>{c.rank}</td>
                  <td>{c.combination_id}</td>
                  <td>{formatCurrency(c.finance.lcoe, curr, lang, 0)}</td>
                  <td>{formatCompactCurrency(c.finance.total_npc, curr, lang)}</td>
                  <td>{formatCompactCurrency(c.finance.npv, curr, lang)}</td>
                  <td>{formatPercent(c.technical.renewable_fraction, lang, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
