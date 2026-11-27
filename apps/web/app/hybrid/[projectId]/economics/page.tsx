"use client";

import { use } from "react";
import HybridShell from "@/components/hybrid/HybridShell";
import { usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

export default function HybridEconomicsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, ready, updateProject } = useHybridProject(projectId);
  const { lang } = usePreferences();

  if (!ready) return <div className="state"><p>Memuat proyek&hellip;</p></div>;
  if (!project) return <MissingProjectState />;

  const fin = project.finance;
  const sim = project.simulation;

  function patchFinance(patch: Partial<typeof fin>) {
    updateProject((p) => ({ ...p, finance: { ...p.finance, ...patch } }));
  }

  return (
    <HybridShell
      project={project}
      activeStep="economics"
      title={lang === "en" ? "Economics, Costs & Tariffs" : "Ekonomi, Biaya Investasi, dan Tarif"}
      subtitle="Seluruh metrik keuangan (NPV, IRR, LCOE, Payback, nilai sisa, dan emisi) dihitung oleh mesin backend dengan presisi penuh."
      result={result}
    >
      <div className="grid-2">
        <section className="card" aria-labelledby="h-econ-1">
          <div className="card-header">
            <h2 id="h-econ-1">Asumsi Proyek, Diskonto &amp; Tarif</h2>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="econ-curr">Mata Uang Proyek</label>
              <select
                id="econ-curr"
                value={project.project.currency_code}
                onChange={(e) =>
                  updateProject((p) => ({
                    ...p,
                    project: { ...p.project, currency_code: e.target.value as "IDR" | "USD" },
                  }))
                }
              >
                <option value="IDR">IDR (Rupiah)</option>
                <option value="USD">USD (Dolar AS)</option>
              </select>
            </div>
            <div className="fld">
              <label htmlFor="econ-life">Umur Proyek (Tahun, 1..40)</label>
              <input
                id="econ-life"
                type="number"
                min={1}
                max={40}
                value={sim.project_lifetime_years}
                onChange={(e) => {
                  const yrs = Math.max(1, Math.min(40, Math.trunc(Number(e.target.value) || 25)));
                  updateProject((p) => ({
                    ...p,
                    simulation: { ...p.simulation, project_lifetime_years: yrs },
                    finance: {
                      ...p.finance,
                      inverter_replacement_year:
                        p.finance.inverter_replacement_year !== null && p.finance.inverter_replacement_year > yrs
                          ? null
                          : p.finance.inverter_replacement_year,
                    },
                  }));
                }}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="econ-tax">Model Pajak</label>
              <select
                id="econ-tax"
                value={fin.tax_model}
                onChange={(e) => patchFinance({ tax_model: e.target.value as "pre_tax" | "after_tax" })}
              >
                <option value="pre_tax">Sebelum Pajak (Pre-Tax)</option>
                <option value="after_tax">Setelah Pajak (After-Tax)</option>
              </select>
            </div>
            <div className="fld">
              <label htmlFor="econ-rev">Mode Pendapatan</label>
              <select
                id="econ-rev"
                value={fin.revenue_mode}
                onChange={(e) => patchFinance({ revenue_mode: e.target.value as "avoided_cost" | "ppa_generation" })}
              >
                <option value="avoided_cost">Penghematan Biaya Listrik (Avoided Cost)</option>
                <option value="ppa_generation">Penjualan Listrik PPA</option>
              </select>
            </div>
          </div>

          {fin.tax_model === "after_tax" && (
            <div className="grid-2">
              <div className="fld">
                <label htmlFor="econ-corp-tax">Tarif PPh Badan (%) [REAL DATA]</label>
                <input
                  id="econ-corp-tax"
                  type="number"
                  step="0.5"
                  min={0}
                  max={60}
                  value={Number((fin.corporate_tax_rate * 100).toFixed(2))}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    if (Number.isFinite(v)) patchFinance({ corporate_tax_rate: v });
                  }}
                />
              </div>
              <div className="fld">
                <label htmlFor="econ-tax-credit">Kredit Pajak Investasi (%)</label>
                <input
                  id="econ-tax-credit"
                  type="number"
                  step="0.5"
                  min={0}
                  max={100}
                  value={Number((fin.tax_credit_fraction * 100).toFixed(2))}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    if (Number.isFinite(v)) patchFinance({ tax_credit_fraction: v });
                  }}
                />
              </div>
            </div>
          )}

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="econ-wacc">Tingkat Diskonto / WACC (%)</label>
              <input
                id="econ-wacc"
                type="number"
                step="0.1"
                value={Number((fin.discount_rate * 100).toFixed(2))}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  if (Number.isFinite(v)) patchFinance({ discount_rate: v });
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="econ-tariff">Tarif Listrik Acuan ({project.project.currency_code}/kWh)</label>
              <input
                id="econ-tariff"
                type="number"
                min={0}
                value={fin.electricity_tariff_per_kwh}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) patchFinance({ electricity_tariff_per_kwh: v });
                }}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="econ-grid-imp">Tarif Impor Grid ({project.project.currency_code}/kWh) [REAL DATA]</label>
              <input
                id="econ-grid-imp"
                type="number"
                min={0}
                value={fin.grid_import_tariff_per_kwh}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) patchFinance({ grid_import_tariff_per_kwh: v });
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="econ-grid-exp">Tarif Ekspor Grid ({project.project.currency_code}/kWh)</label>
              <input
                id="econ-grid-exp"
                type="number"
                min={0}
                value={fin.grid_export_tariff_per_kwh}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) patchFinance({ grid_export_tariff_per_kwh: v });
                }}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="econ-esc-tar">Eskalasi Tarif (%/thn)</label>
              <input
                id="econ-esc-tar"
                type="number"
                step="0.1"
                value={Number((fin.tariff_escalation_rate * 100).toFixed(2))}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  if (Number.isFinite(v)) patchFinance({ tariff_escalation_rate: v });
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="econ-esc-om">Inflasi O&amp;M (%/thn)</label>
              <input
                id="econ-esc-om"
                type="number"
                step="0.1"
                value={Number((fin.om_escalation_rate * 100).toFixed(2))}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  if (Number.isFinite(v)) patchFinance({ om_escalation_rate: v });
                }}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="econ-esc-fuel">Eskalasi Harga Bahan Bakar (%/thn) [REAL DATA]</label>
              <input
                id="econ-esc-fuel"
                type="number"
                step="0.1"
                value={Number((fin.fuel_escalation_rate * 100).toFixed(2))}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  if (Number.isFinite(v)) patchFinance({ fuel_escalation_rate: v });
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="econ-em">Faktor Emisi Grid (kg CO2e/kWh)</label>
              <input
                id="econ-em"
                type="number"
                step="0.01"
                min={0}
                value={fin.grid_emission_factor_kg_co2e_per_kwh}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) patchFinance({ grid_emission_factor_kg_co2e_per_kwh: v });
                }}
              />
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="h-econ-2">
          <div className="card-header">
            <h2 id="h-econ-2">CAPEX, O&amp;M, Penggantian &amp; Insentif [REAL DATA]</h2>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="econ-pv-capex">CAPEX PV ({project.project.currency_code}/kWp)</label>
              <input
                id="econ-pv-capex"
                type="number"
                min={0}
                value={fin.pv_capex_per_kwp}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) patchFinance({ pv_capex_per_kwp: v });
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="econ-pv-om">O&amp;M PV (% dari CAPEX/thn)</label>
              <input
                id="econ-pv-om"
                type="number"
                step="0.1"
                min={0}
                value={Number((fin.pv_om_fraction_of_capex * 100).toFixed(2))}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  if (Number.isFinite(v)) patchFinance({ pv_om_fraction_of_capex: v });
                }}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="econ-bess-capex">CAPEX BESS ({project.project.currency_code}/kWh)</label>
              <input
                id="econ-bess-capex"
                type="number"
                min={0}
                value={fin.bess_capex_per_kwh}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) patchFinance({ bess_capex_per_kwh: v });
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="econ-bess-om">O&amp;M BESS ({project.project.currency_code}/kWh/thn)</label>
              <input
                id="econ-bess-om"
                type="number"
                min={0}
                value={fin.bess_fixed_om_per_kwh_year}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) patchFinance({ bess_fixed_om_per_kwh_year: v });
                }}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="econ-bio-capex">CAPEX Biomass ({project.project.currency_code}/kW)</label>
              <input
                id="econ-bio-capex"
                type="number"
                min={0}
                value={fin.biomass_capex_per_kw}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) patchFinance({ biomass_capex_per_kw: v });
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="econ-diesel-capex">CAPEX Diesel Generator ({project.project.currency_code}/kW)</label>
              <input
                id="econ-diesel-capex"
                type="number"
                min={0}
                value={fin.diesel_capex_per_kw}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) patchFinance({ diesel_capex_per_kw: v });
                }}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="econ-bos-capex">Biaya BOS &amp; Lainnya Tahun 0 ({project.project.currency_code})</label>
              <input
                id="econ-bos-capex"
                type="number"
                min={0}
                value={fin.bos_and_other_capex}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) patchFinance({ bos_and_other_capex: v });
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="econ-grant">Hibah Modal / Grant Tahun 0 ({project.project.currency_code})</label>
              <input
                id="econ-grant"
                type="number"
                min={0}
                value={fin.capital_grant_amount}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) patchFinance({ capital_grant_amount: v });
                }}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="econ-inv-yr">Tahun Penggantian Inverter (kosongkan jika tidak ada)</label>
              <input
                id="econ-inv-yr"
                type="number"
                min={1}
                max={sim.project_lifetime_years}
                value={fin.inverter_replacement_year ?? ""}
                onChange={(e) => {
                  if (e.target.value === "") {
                    patchFinance({ inverter_replacement_year: null });
                    return;
                  }
                  const v = Math.trunc(Number(e.target.value));
                  if (Number.isFinite(v)) patchFinance({ inverter_replacement_year: v });
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="econ-inv-cost">Biaya Penggantian Inverter ({project.project.currency_code})</label>
              <input
                id="econ-inv-cost"
                type="number"
                min={0}
                value={fin.inverter_replacement_cost}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) patchFinance({ inverter_replacement_cost: v });
                }}
              />
            </div>
          </div>

          <fieldset style={{ marginTop: "1rem" }}>
            <legend>Umur Desain Acuan Nilai Sisa (Salvage Value) [REAL DATA]</legend>
            <div className="grid-2">
              <div className="fld">
                <label htmlFor="econ-bess-design-life">Umur Desain BESS (Tahun)</label>
                <input
                  id="econ-bess-design-life"
                  type="number"
                  min={0.5}
                  max={30}
                  step={0.5}
                  value={fin.bess_design_life_years}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) patchFinance({ bess_design_life_years: v });
                  }}
                />
              </div>
              <div className="fld">
                <label htmlFor="econ-inv-design-life">Umur Desain Inverter PV (Tahun)</label>
                <input
                  id="econ-inv-design-life"
                  type="number"
                  min={0.5}
                  max={30}
                  step={0.5}
                  value={fin.inverter_design_life_years}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) patchFinance({ inverter_design_life_years: v });
                  }}
                />
              </div>
            </div>
            <div className="grid-2">
              <div className="fld">
                <label htmlFor="econ-bio-overhaul-life">Umur Overhaul Biomass (Tahun)</label>
                <input
                  id="econ-bio-overhaul-life"
                  type="number"
                  min={0.5}
                  max={30}
                  step={0.5}
                  value={fin.biomass_overhaul_life_years}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) patchFinance({ biomass_overhaul_life_years: v });
                  }}
                />
              </div>
              <div className="fld">
                <label htmlFor="econ-diesel-overhaul-life">Umur Overhaul Diesel (Tahun)</label>
                <input
                  id="econ-diesel-overhaul-life"
                  type="number"
                  min={0.5}
                  max={30}
                  step={0.5}
                  value={fin.diesel_overhaul_life_years}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) patchFinance({ diesel_overhaul_life_years: v });
                  }}
                />
              </div>
            </div>
          </fieldset>
        </section>
      </div>
    </HybridShell>
  );
}
