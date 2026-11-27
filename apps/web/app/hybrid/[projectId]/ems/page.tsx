"use client";

import { use, useEffect, useState } from "react";
import HybridShell from "@/components/hybrid/HybridShell";
import { fetchHybridPresets } from "@/lib/hybrid-api";
import type { DispatchStrategyId, HybridPresetsResponse } from "@/lib/hybrid-types";
import { tr, usePreferences } from "@/lib/preferences";
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

  if (!ready) {
    return (
      <div className="state">
        <p>{tr(lang, "Loading project...", "Lagi memuat proyek...", "プロジェクトを読み込み中...")}</p>
      </div>
    );
  }
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
      title={tr(
        lang,
        "Energy Management System (EMS)",
        "Strategi Pengaturan Operasi (EMS)",
        "エネルギーマネジメントシステム (EMS) 運用戦略",
      )}
      subtitle={tr(
        lang,
        "Choose one of the 5 built-in dispatch strategies along with utility grid transaction rules and operating thresholds.",
        "Pilih 1 dari 5 strategi dispatch bawaan beserta aturan impor/ekspor jaringan grid dan batas operasinya.",
        "5種類の標準ディスパッチ戦略から1つを選択し、系統買電・売電の許可や運用しきい値を設定します。",
      )}
      result={result}
    >
      <div className="grid-hybrid">
        <section aria-labelledby="h-ems-strat">
          <h2 id="h-ems-strat" style={{ marginTop: 0 }}>
            {tr(lang, "Built-in Dispatch Strategies", "Pilihan Strategi Dispatch", "標準ディスパッチ戦略")}
          </h2>
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
                  <strong style={{ color: "var(--navytext)" }}>{lang === "id" ? s.name_id : s.name_en}</strong>
                  <span className="chip">{s.id}</span>
                </div>
                <p className="note">{lang === "id" ? s.description_id : s.description_en}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="card" aria-labelledby="h-ems-params">
          <div className="card-header">
            <h2 id="h-ems-params">
              {tr(lang, "Operating & Grid Parameters", "Parameter Operasi & Grid", "運用および系統連系パラメータ")}
            </h2>
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
            <>
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

              <fieldset style={{ marginTop: "1rem" }}>
                <legend>Jadwal Jam Tarif Puncak (Peak Hours, 00:00 sampai 23:00)</legend>
                <p className="note" style={{ marginTop: "0.25rem" }}>
                  Klik tombol jam untuk mengaktifkan atau menonaktifkan jam tarif puncak (discharge baterai diprioritaskan). Jam tidak boleh tumpang tindih dengan jam luar puncak.
                </p>
                <div
                  role="group"
                  aria-label="Pemilih jam tarif puncak"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(3.25rem, 1fr))",
                    gap: "0.375rem",
                    marginTop: "0.5rem",
                  }}
                >
                  {Array.from({ length: 24 }, (_, hr) => {
                    const isPeak = dp.peak_hours.includes(hr);
                    const isOffPeak = dp.off_peak_hours.includes(hr);
                    return (
                      <button
                        key={`peak-hr-${hr}`}
                        type="button"
                        className="seg-btn tabular-nums"
                        aria-pressed={isPeak}
                        style={{
                          border: "1px solid var(--border)",
                          opacity: isOffPeak && !isPeak ? 0.55 : 1,
                        }}
                        title={
                          isOffPeak && !isPeak
                            ? `Jam ${String(hr).padStart(2, "0")}:00 saat ini terdaftar sebagai Jam Luar Puncak (klik untuk memindahkan ke Jam Puncak)`
                            : `Toggle jam puncak ${String(hr).padStart(2, "0")}:00`
                        }
                        onClick={() => {
                          updateProject((p) => {
                            const curPeak = p.simulation.dispatch_params.peak_hours;
                            const curOff = p.simulation.dispatch_params.off_peak_hours;
                            const nextPeak = curPeak.includes(hr)
                              ? curPeak.filter((h) => h !== hr)
                              : [...curPeak, hr].sort((a, b) => a - b);
                            const nextOff = curPeak.includes(hr) ? curOff : curOff.filter((h) => h !== hr);
                            return {
                              ...p,
                              simulation: {
                                ...p.simulation,
                                dispatch_params: {
                                  ...p.simulation.dispatch_params,
                                  peak_hours: nextPeak,
                                  off_peak_hours: nextOff,
                                },
                              },
                            };
                          });
                        }}
                      >
                        {String(hr).padStart(2, "0")}:00
                      </button>
                    );
                  })}
                </div>
                <p className="note tabular-nums" style={{ marginTop: "0.375rem" }}>
                  Jam Puncak aktif: <strong>{dp.peak_hours.length > 0 ? dp.peak_hours.join(", ") : "Tidak ada"}</strong>
                </p>
              </fieldset>

              <fieldset style={{ marginTop: "1rem" }}>
                <legend>Jadwal Jam Luar Puncak (Off-Peak Hours, 00:00 sampai 23:00)</legend>
                <p className="note" style={{ marginTop: "0.25rem" }}>
                  Klik tombol jam untuk memilih jadwal pengisian baterai saat tarif murah luar puncak.
                </p>
                <div
                  role="group"
                  aria-label="Pemilih jam luar puncak"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(3.25rem, 1fr))",
                    gap: "0.375rem",
                    marginTop: "0.5rem",
                  }}
                >
                  {Array.from({ length: 24 }, (_, hr) => {
                    const isOffPeak = dp.off_peak_hours.includes(hr);
                    const isPeak = dp.peak_hours.includes(hr);
                    return (
                      <button
                        key={`offpeak-hr-${hr}`}
                        type="button"
                        className="seg-btn tabular-nums"
                        aria-pressed={isOffPeak}
                        style={{
                          border: "1px solid var(--border)",
                          opacity: isPeak && !isOffPeak ? 0.55 : 1,
                        }}
                        title={
                          isPeak && !isOffPeak
                            ? `Jam ${String(hr).padStart(2, "0")}:00 saat ini terdaftar sebagai Jam Puncak (klik untuk memindahkan ke Jam Luar Puncak)`
                            : `Toggle jam luar puncak ${String(hr).padStart(2, "0")}:00`
                        }
                        onClick={() => {
                          updateProject((p) => {
                            const curOff = p.simulation.dispatch_params.off_peak_hours;
                            const curPeak = p.simulation.dispatch_params.peak_hours;
                            const nextOff = curOff.includes(hr)
                              ? curOff.filter((h) => h !== hr)
                              : [...curOff, hr].sort((a, b) => a - b);
                            const nextPeak = curOff.includes(hr) ? curPeak : curPeak.filter((h) => h !== hr);
                            return {
                              ...p,
                              simulation: {
                                ...p.simulation,
                                dispatch_params: {
                                  ...p.simulation.dispatch_params,
                                  off_peak_hours: nextOff,
                                  peak_hours: nextPeak,
                                },
                              },
                            };
                          });
                        }}
                      >
                        {String(hr).padStart(2, "0")}:00
                      </button>
                    );
                  })}
                </div>
                <div className="actions-inline" style={{ justifyContent: "space-between", marginTop: "0.375rem" }}>
                  <p className="note tabular-nums">
                    Jam Luar Puncak aktif: <strong>{dp.off_peak_hours.length > 0 ? dp.off_peak_hours.join(", ") : "Tidak ada"}</strong>
                  </p>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    onClick={() =>
                      updateProject((p) => ({
                        ...p,
                        simulation: {
                          ...p.simulation,
                          dispatch_params: {
                            ...p.simulation.dispatch_params,
                            peak_hours: [17, 18, 19, 20, 21],
                            off_peak_hours: [0, 1, 2, 3, 4, 5],
                          },
                        },
                      }))
                    }
                  >
                    Reset Jam Default
                  </button>
                </div>
              </fieldset>
            </>
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
