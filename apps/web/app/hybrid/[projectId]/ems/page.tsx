"use client";

import { use, useEffect, useState } from "react";
import HybridShell from "@/components/hybrid/HybridShell";
import { fetchHybridPresets } from "@/lib/hybrid-api";
import type { DispatchStrategyId, HybridPresetsResponse } from "@/lib/hybrid-types";
import { usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

const FALLBACK_STRATEGIES: HybridPresetsResponse["dispatch_strategies"] = [
  {
    id: "self_consumption",
    name_id: "Konsumsi Sendiri (Self-Consumption)",
    name_en: "Self-Consumption",
    description_id: "Surplus PV mengisi baterai terlebih dahulu; kekurangan beban ditutup baterai lalu biomass bila aktif.",
    description_en: "PV surplus charges BESS first; load deficit is covered by BESS and then biomass.",
    default_params: {},
  },
  {
    id: "load_following",
    name_id: "Mengikuti Beban (Load Following)",
    name_en: "Load Following",
    description_id: "Baterai dan biomass menyesuaikan keluaran hanya untuk menutup sisa beban bersih setelah PV.",
    description_en: "BESS and biomass adjust output solely to cover residual net load after PV.",
    default_params: {},
  },
  {
    id: "cycle_charging",
    name_id: "Pengisian Siklus (Cycle Charging)",
    name_en: "Cycle Charging",
    description_id: "Saat pembangkit biomass atau sumber pengisi aktif, baterai ikut diisi sampai target SOC.",
    description_en: "When biomass or charging supply runs, it charges BESS toward target SOC.",
    default_params: {},
  },
  {
    id: "peak_shaving",
    name_id: "Pemangkasan Beban Puncak (Peak Shaving)",
    name_en: "Peak Shaving",
    description_id: "Baterai dan biomass memangkas beban di atas batas puncak agar daya sumber lain tetap terkendali.",
    description_en: "BESS and biomass shave peak load above the configured peak limit.",
    default_params: {},
  },
  {
    id: "time_of_use_arbitrage",
    name_id: "Arbitrase Tarif Waktu (Time-of-Use)",
    name_en: "Time-of-Use Arbitrage",
    description_id: "Baterai mengisi saat jam luar puncak atau surplus PV, lalu melepaskan energi pada jam tarif puncak.",
    description_en: "BESS charges during off-peak hours and discharges during peak tariff hours.",
    default_params: {},
  },
];

export default function HybridEmsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, ready, updateProject } = useHybridProject(projectId);
  const { lang } = usePreferences();
  const [presets, setPresets] = useState<HybridPresetsResponse | null>(null);

  useEffect(() => {
    fetchHybridPresets().then(setPresets).catch(() => {});
  }, []);

  if (!ready) return <div className="state"><p>Memuat proyek&hellip;</p></div>;
  if (!project) return <MissingProjectState />;

  const strategies = presets?.dispatch_strategies ?? FALLBACK_STRATEGIES;
  const activeStrategy = project.simulation.dispatch_strategy;
  const dp = project.simulation.dispatch_params;

  function selectStrategy(id: DispatchStrategyId) {
    updateProject((p) => ({
      ...p,
      simulation: {
        ...p.simulation,
        dispatch_strategy: id,
        dispatch_params: {
          ...p.simulation.dispatch_params,
          allow_grid_import:
            id === "peak_shaving" || id === "time_of_use_arbitrage" ? true : p.simulation.dispatch_params.allow_grid_import,
        },
      },
    }));
  }

  return (
    <HybridShell
      project={project}
      activeStep="ems"
      title={lang === "en" ? "Energy Management System (EMS)" : "Strategi Pengaturan Operasi (EMS)"}
      subtitle="Pilih salah satu dari 5 strategi dispatch bawaan beserta batas transaksi jaringan listrik dan parameter operasinya."
      result={result}
    >
      <div className="grid-hybrid">
        <section aria-labelledby="h-ems-strat">
          <h2 id="h-ems-strat" style={{ marginTop: 0 }}>Strategi Dispatch Bawaan</h2>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {strategies.map((s) => (
              <button
                key={s.id}
                type="button"
                className="strategy-card"
                aria-pressed={activeStrategy === s.id}
                onClick={() => selectStrategy(s.id)}
              >
                <div className="actions-inline" style={{ justifyContent: "space-between", marginBottom: "0.25rem" }}>
                  <strong style={{ color: "var(--navytext)" }}>{lang === "en" ? s.name_en : s.name_id}</strong>
                  <span className="chip">{s.id}</span>
                </div>
                <p className="note">{lang === "en" ? s.description_en : s.description_id}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="card" aria-labelledby="h-ems-params">
          <div className="card-header">
            <h2 id="h-ems-params">Parameter Operasi &amp; Grid</h2>
          </div>

          <label className="check-row">
            <input
              type="checkbox"
              checked={dp.allow_grid_import}
              onChange={(e) =>
                updateProject((p) => ({
                  ...p,
                  simulation: { ...p.simulation, dispatch_params: { ...p.simulation.dispatch_params, allow_grid_import: e.target.checked } },
                }))
              }
            />
            <span>Izinkan impor listrik dari jaringan PLN/Grid saat defisit</span>
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={dp.allow_grid_export}
              onChange={(e) =>
                updateProject((p) => ({
                  ...p,
                  simulation: { ...p.simulation, dispatch_params: { ...p.simulation.dispatch_params, allow_grid_export: e.target.checked } },
                }))
              }
            />
            <span>Izinkan ekspor surplus listrik ke jaringan PLN/Grid</span>
          </label>

          {activeStrategy === "cycle_charging" && (
            <div className="fld">
              <label htmlFor="ems-target-soc">Target SOC Pengisian Siklus (%)</label>
              <input
                id="ems-target-soc"
                type="number"
                min={20}
                max={100}
                value={Math.round(dp.target_soc_fraction * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  if (Number.isFinite(v)) {
                    updateProject((p) => ({
                      ...p,
                      simulation: { ...p.simulation, dispatch_params: { ...p.simulation.dispatch_params, target_soc_fraction: v } },
                    }));
                  }
                }}
              />
            </div>
          )}

          {activeStrategy === "peak_shaving" && (
            <div className="fld">
              <label htmlFor="ems-peak-limit">Batas Beban Puncak Grid (kW)</label>
              <input
                id="ems-peak-limit"
                type="number"
                min={1}
                value={dp.peak_limit_kw ?? 250}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    updateProject((p) => ({
                      ...p,
                      simulation: { ...p.simulation, dispatch_params: { ...p.simulation.dispatch_params, peak_limit_kw: v } },
                    }));
                  }
                }}
              />
            </div>
          )}

          {activeStrategy === "time_of_use_arbitrage" && (
            <div className="grid-2">
              <div className="fld">
                <label htmlFor="ems-tou-chg">Target Charge Luar Puncak (%)</label>
                <input
                  id="ems-tou-chg"
                  type="number"
                  min={20}
                  max={100}
                  value={Math.round(dp.tou_charge_soc_target * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    if (Number.isFinite(v)) {
                      updateProject((p) => ({
                        ...p,
                        simulation: { ...p.simulation, dispatch_params: { ...p.simulation.dispatch_params, tou_charge_soc_target: v } },
                      }));
                    }
                  }}
                />
              </div>
              <div className="fld">
                <label htmlFor="ems-tou-dis">Batas Bawah Discharge Puncak (%)</label>
                <input
                  id="ems-tou-dis"
                  type="number"
                  min={5}
                  max={90}
                  value={Math.round(dp.tou_discharge_soc_floor * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value) / 100;
                    if (Number.isFinite(v)) {
                      updateProject((p) => ({
                        ...p,
                        simulation: { ...p.simulation, dispatch_params: { ...p.simulation.dispatch_params, tou_discharge_soc_floor: v } },
                      }));
                    }
                  }}
                />
              </div>
            </div>
          )}

          <div className="warn sec" role="note" style={{ marginBottom: 0 }}>
            <h3>Kesiapan EMS Kustom (Tahap 3B &amp; 6)</h3>
            <p className="note" style={{ color: "var(--warntext)" }}>
              Interpreter aturan EMS berbasis skema JSON terversi dan editor aturan visual akan diaktifkan setelah berkas skema EMS resmi dari pemilik proyek digabungkan pada Tahap 3B dan Tahap 6.
            </p>
          </div>
        </section>
      </div>
    </HybridShell>
  );
}
