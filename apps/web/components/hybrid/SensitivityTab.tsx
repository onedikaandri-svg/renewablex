"use client";

import { useEffect, useMemo, useState } from "react";
import EChart, { getChartThemeColors, type EChartsOption } from "@/components/hybrid/EChart";
import { ViabilityChip } from "@/components/hybrid/HybridShell";
import { useToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";
import { SLOW_ENGINE_NOTE, formatCompactCurrency, formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { runHybridSensitivity } from "@/lib/hybrid-api";
import { getSensitivityResult, saveSensitivityResult } from "@/lib/hybrid-storage";
import type {
  HybridProjectConfig,
  HybridSensitivityMatrixCell,
  HybridSensitivityResponse,
  HybridSensitivityVariableId,
} from "@/lib/hybrid-types";
import { usePreferences } from "@/lib/preferences";

const VARIABLE_LABELS: Record<HybridSensitivityVariableId, string> = {
  capex_total: "Total CAPEX Sistem",
  electricity_tariff: "Tarif Listrik",
  discount_rate: "Tingkat Diskonto (WACC)",
  biomass_fuel_price: "Harga Bahan Bakar Biomass",
  om_total: "Biaya O&M Tahunan",
  pv_degradation_rate: "Degradasi Tahunan PV",
  load_scale: "Skala Beban Listrik",
  pv_capacity: "Kapasitas Terpasang PV",
};

const ALL_VARS = Object.keys(VARIABLE_LABELS) as HybridSensitivityVariableId[];
const DEFAULT_VARS: HybridSensitivityVariableId[] = [
  "capex_total",
  "electricity_tariff",
  "discount_rate",
  "biomass_fuel_price",
  "om_total",
  "pv_degradation_rate",
];

export default function SensitivityTab({ project }: { project: HybridProjectConfig }) {
  const { theme, lang } = usePreferences();
  const { pushToast } = useToast();
  const colors = useMemo(() => getChartThemeColors(theme), [theme]);

  const [selectedVars, setSelectedVars] = useState<HybridSensitivityVariableId[]>(DEFAULT_VARS);
  const [shiftPreset, setShiftPreset] = useState<"20" | "30">("20");
  const [metric, setMetric] = useState<"npv" | "lcoe">("npv");
  const [enableMatrix, setEnableMatrix] = useState(true);
  const [xVar, setXVar] = useState<HybridSensitivityVariableId>("capex_total");
  const [yVar, setYVar] = useState<HybridSensitivityVariableId>("electricity_tariff");

  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [sensData, setSensData] = useState<HybridSensitivityResponse | null>(null);
  const [inspectedCell, setInspectedCell] = useState<HybridSensitivityMatrixCell | null>(null);

  useEffect(() => {
    const cached = getSensitivityResult(project.id);
    setSensData(cached);
    if (cached?.matrix_result?.cells?.length) {
      setInspectedCell(cached.matrix_result.cells[Math.floor(cached.matrix_result.cells.length / 2)]);
    }
  }, [project.id]);

  useEffect(() => {
    if (!loading) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [loading]);

  function toggleVar(v: HybridSensitivityVariableId) {
    setSelectedVars((prev) =>
      prev.includes(v) ? (prev.length > 1 ? prev.filter((x) => x !== v) : prev) : [...prev, v],
    );
  }

  async function handleRunSensitivity() {
    if (enableMatrix && xVar === yVar) {
      setErrors(["Sumbu X dan Sumbu Y Matriks 5x5 harus berbeda."]);
      return;
    }
    setLoading(true);
    setErrors([]);

    const shifts = shiftPreset === "20" ? [-0.20, -0.10, 0.10, 0.20] : [-0.30, -0.15, 0.15, 0.30];
    const matrixShifts = shiftPreset === "20" ? [-0.20, -0.10, 0.0, 0.10, 0.20] : [-0.30, -0.15, 0.0, 0.15, 0.30];

    try {
      const res = await runHybridSensitivity(project, {
        variables: selectedVars,
        shifts,
        matrix: enableMatrix
          ? {
              x_variable: xVar,
              x_shifts: matrixShifts,
              y_variable: yVar,
              y_shifts: matrixShifts,
            }
          : null,
      });
      saveSensitivityResult(project.id, res);
      setSensData(res);
      if (res.matrix_result?.cells?.length) {
        const mid = res.matrix_result.cells.find((c) => c.x_shift === 0 && c.y_shift === 0) ?? res.matrix_result.cells[0];
        setInspectedCell(mid);
      } else {
        setInspectedCell(null);
      }
      pushToast("Analisis sensitivitas hybrid selesai.", "success");
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors([...err.problems.general, ...Object.values(err.problems.fields)]);
      } else {
        setErrors([err instanceof Error ? err.message : "Gagal menghitung sensitivitas hybrid."]);
      }
    } finally {
      setLoading(false);
    }
  }

  const activeVars = useMemo(() => {
    if (!sensData) return [];
    const list = sensData.variables.filter((v) => !v.skipped);
    return [...list].sort((a, b) =>
      metric === "npv" ? b.max_abs_npv_delta - a.max_abs_npv_delta : b.max_abs_lcoe_delta - a.max_abs_lcoe_delta,
    );
  }, [sensData, metric]);

  const skippedVars = useMemo(() => (sensData ? sensData.variables.filter((v) => v.skipped) : []), [sensData]);

  const tornadoOption = useMemo<EChartsOption>(() => {
    if (!sensData || activeVars.length === 0) return {};
    const ordered = [...activeVars].reverse();
    const categories = ordered.map((v) => VARIABLE_LABELS[v.variable] ?? v.variable);
    const curr = sensData.currency_code;

    const minDeltas = ordered.map((v) => {
      const deltas = v.cases.map((c) => (metric === "npv" ? c.npv_delta / 1e6 : c.lcoe_delta));
      return Math.round(Math.min(...deltas, 0) * 100) / 100;
    });
    const maxDeltas = ordered.map((v) => {
      const deltas = v.cases.map((c) => (metric === "npv" ? c.npv_delta / 1e6 : c.lcoe_delta));
      return Math.round(Math.max(...deltas, 0) * 100) / 100;
    });

    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, textStyle: { color: colors.text } },
      grid: { left: 165, right: 24, top: 40, bottom: 36 },
      xAxis: {
        type: "value",
        name: metric === "npv" ? `Selisih NPV (Juta ${curr})` : `Selisih LCOE (${curr}/kWh)`,
        nameLocation: "middle",
        nameGap: 24,
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      yAxis: {
        type: "category",
        data: categories,
        axisLabel: { color: colors.text },
      },
      series: [
        {
          name: metric === "npv" ? "Dampak Penurunan NPV" : "Penurunan LCOE (Lebih Hemat)",
          type: "bar",
          stack: "tornado",
          color: metric === "npv" ? colors.unmet : colors.grid,
          data: minDeltas,
        },
        {
          name: metric === "npv" ? "Dampak Kenaikan NPV" : "Kenaikan LCOE (Lebih Mahal)",
          type: "bar",
          stack: "tornado",
          color: metric === "npv" ? colors.grid : colors.unmet,
          data: maxDeltas,
        },
      ],
    };
  }, [sensData, activeVars, metric, colors]);

  return (
    <div className="grid-hybrid">
      <section className="card" aria-labelledby="h-sens-cfg">
        <div className="card-header">
          <h2 id="h-sens-cfg">Parameter Sensitivitas Hybrid</h2>
        </div>

        <fieldset style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
          <legend>Variabel yang Diuji</legend>
          {ALL_VARS.map((v) => (
            <label key={v} className="check-row">
              <input type="checkbox" checked={selectedVars.includes(v)} onChange={() => toggleVar(v)} />
              <span>{VARIABLE_LABELS[v]}</span>
            </label>
          ))}
        </fieldset>

        <div className="fld">
          <label htmlFor="sens-shift">Rentang Pergeseran</label>
          <select id="sens-shift" value={shiftPreset} onChange={(e) => setShiftPreset(e.target.value as "20" | "30")}>
            <option value="20">-20%, -10%, +10%, +20% (Bawaan)</option>
            <option value="30">-30%, -15%, +15%, +30%</option>
          </select>
        </div>

        <fieldset>
          <legend>Matriks Sensitivitas 5 x 5</legend>
          <label className="check-row">
            <input type="checkbox" checked={enableMatrix} onChange={(e) => setEnableMatrix(e.target.checked)} />
            <span>Sertakan Matriks 2 Variabel (5 x 5)</span>
          </label>
          {enableMatrix && (
            <div className="grid-2">
              <div className="fld">
                <label htmlFor="mat-x">Sumbu X (Kolom)</label>
                <select id="mat-x" value={xVar} onChange={(e) => setXVar(e.target.value as HybridSensitivityVariableId)}>
                  {ALL_VARS.map((v) => <option key={v} value={v}>{VARIABLE_LABELS[v]}</option>)}
                </select>
              </div>
              <div className="fld">
                <label htmlFor="mat-y">Sumbu Y (Baris)</label>
                <select id="mat-y" value={yVar} onChange={(e) => setYVar(e.target.value as HybridSensitivityVariableId)}>
                  {ALL_VARS.map((v) => <option key={v} value={v}>{VARIABLE_LABELS[v]}</option>)}
                </select>
              </div>
            </div>
          )}
        </fieldset>

        <div className="row">
          <button type="button" className="btn primary" disabled={loading} onClick={() => void handleRunSensitivity()}>
            {loading ? "Menghitung..." : "Hitung Sensitivitas Hybrid"}
          </button>
        </div>
      </section>

      <section aria-labelledby="h-sens-out">
        <h2 id="h-sens-out" style={{ marginTop: 0 }}>Grafik Tornado & Matriks 5 x 5</h2>

        {loading && (
          <div className="state" role="status">
            <h3>Menghitung Sensitivitas Hybrid</h3>
            <p>Mengevaluasi pergeseran parameter teknis dan keuangan di mesin hitung Python&hellip;</p>
            {slow && <p className="note" style={{ marginTop: "0.75rem" }}>{SLOW_ENGINE_NOTE}</p>}
          </div>
        )}

        {!loading && errors.length > 0 && (
          <div className="state bad" role="alert">
            <h3>Sensitivitas belum bisa dihitung</h3>
            <ul>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}

        {!loading && errors.length === 0 && !sensData && (
          <div className="state">
            <h3>Belum ada hasil sensitivitas hybrid</h3>
            <p>Pilih variabel dan tekan <strong>&ldquo;Hitung Sensitivitas Hybrid&rdquo;</strong> untuk melihat grafik Tornado serta Matriks 5 x 5.</p>
          </div>
        )}

        {!loading && sensData && (
          <>
            <div className="chart-card" style={{ marginBottom: "1rem" }}>
              <div className="chart-head">
                <div>
                  <h3>Diagram Tornado Sensitivitas ({metric === "npv" ? "NPV" : "LCOE"})</h3>
                  <p className="note">
                    Kasus dasar: NPV {formatCompactCurrency(sensData.base.npv, sensData.currency_code, lang)} | LCOE {formatCurrency(sensData.base.lcoe, sensData.currency_code, lang, 0)}/kWh
                  </p>
                </div>
                <div className="seg-group" role="group" aria-label="Metrik target tornado">
                  <button type="button" className="seg-btn" aria-pressed={metric === "npv"} onClick={() => setMetric("npv")}>
                    NPV
                  </button>
                  <button type="button" className="seg-btn" aria-pressed={metric === "lcoe"} onClick={() => setMetric("lcoe")}>
                    LCOE
                  </button>
                </div>
              </div>
              <EChart
                option={tornadoOption}
                height={Math.max(260, activeVars.length * 44 + 80)}
                ariaLabel="Grafik Tornado menampilkan variabel yang paling menggeser NPV atau LCOE sistem hybrid."
              />
            </div>

            {skippedVars.length > 0 && (
              <div className="warn" role="note">
                <h3>Variabel Dilewati</h3>
                <ul>
                  {skippedVars.map((v) => (
                    <li key={v.variable}>
                      <strong>{VARIABLE_LABELS[v.variable]}</strong>: dilewati karena komponen tidak diaktifkan pada konfigurasi saat ini (<code>{v.skip_reason}</code>).
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {sensData.matrix_result && (
              <div className="card" style={{ marginBottom: "1rem" }}>
                <div className="card-header">
                  <div>
                    <h3>Matriks Sensitivitas 5 x 5</h3>
                    <p className="note">
                      Baris: {VARIABLE_LABELS[sensData.matrix_result.y_variable]} | Kolom: {VARIABLE_LABELS[sensData.matrix_result.x_variable]}
                    </p>
                  </div>
                  <span className="chip">Pilih sel untuk inspeksi</span>
                </div>

                <div className="tw" tabIndex={0} role="region" aria-label="Matriks sensitivitas 5 kali 5, bisa digulir">
                  <table className="sens-main">
                    <thead>
                      <tr>
                        <th scope="col">Y \ X</th>
                        {sensData.matrix_result.x_shifts.map((xs) => (
                          <th scope="col" key={xs}>{xs >= 0 ? `+${Math.round(xs * 100)}%` : `${Math.round(xs * 100)}%`}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sensData.matrix_result.y_shifts.map((ys, yi) => (
                        <tr key={ys}>
                          <th scope="row">{ys >= 0 ? `+${Math.round(ys * 100)}%` : `${Math.round(ys * 100)}%`}</th>
                          {sensData.matrix_result!.x_shifts.map((xs, xi) => {
                            const cell = sensData.matrix_result!.cells.find((c) => c.x_index === xi && c.y_index === yi);
                            if (!cell) return <td key={xs}>-</td>;
                            const isSelected = inspectedCell?.x_index === xi && inspectedCell?.y_index === yi;
                            const vLabel = cell.viability_status === "viable" ? "Layak" : cell.viability_status === "marginal" ? "Marjinal" : "Tidak Layak";
                            return (
                              <td key={xs} style={{ padding: "0.25rem" }}>
                                <button
                                  type="button"
                                  className={`matrix-cell matrix-${cell.viability_status}`}
                                  aria-pressed={isSelected}
                                  onClick={() => setInspectedCell(cell)}
                                >
                                  <span className="tabular-nums">{formatCompactCurrency(cell.npv, sensData.currency_code, lang)}</span>
                                  <span className="sub">{vLabel}</span>
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {inspectedCell && (
                  <div className="card" style={{ marginTop: "0.875rem", background: "var(--surface-subtle)" }}>
                    <div className="actions-inline" style={{ justifyContent: "space-between" }}>
                      <strong>
                        Inspeksi Sel (X: {Math.round(inspectedCell.x_shift * 100)}%, Y: {Math.round(inspectedCell.y_shift * 100)}%)
                      </strong>
                      <ViabilityChip status={inspectedCell.viability_status} />
                    </div>
                    <p className="note tabular-nums" style={{ marginTop: "0.35rem" }}>
                      NPV: {formatCurrency(inspectedCell.npv, sensData.currency_code, lang, 0)} (Selisih {formatCompactCurrency(inspectedCell.npv_delta, sensData.currency_code, lang)}) | LCOE: {formatCurrency(inspectedCell.lcoe, sensData.currency_code, lang, 0)}/kWh | IRR: {inspectedCell.irr !== null ? formatPercent(inspectedCell.irr, lang, 2) : "Tidak tersedia"}
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="tw" tabIndex={0} role="region" aria-label="Tabel rincian sensitivitas hybrid, bisa digulir">
              <table>
                <caption>Ringkasan sensitivitas NPV dan LCOE untuk setiap asumsi yang diuji.</caption>
                <thead>
                  <tr>
                    <th scope="col">Variabel</th>
                    <th scope="col">Pergeseran</th>
                    <th scope="col">Nilai Uji</th>
                    <th scope="col">NPV</th>
                    <th scope="col">Selisih NPV</th>
                    <th scope="col">LCOE</th>
                    <th scope="col">IRR</th>
                  </tr>
                </thead>
                <tbody>
                  {activeVars.flatMap((v) =>
                    v.cases.map((cs) => (
                      <tr key={`${v.variable}-${cs.shift_fraction}`}>
                        <th scope="row">{VARIABLE_LABELS[v.variable]}</th>
                        <td>{cs.shift_fraction >= 0 ? `+${Math.round(cs.shift_fraction * 100)}%` : `${Math.round(cs.shift_fraction * 100)}%`}</td>
                        <td>{formatNumber(cs.input_value, lang, 2)}</td>
                        <td>{formatCompactCurrency(cs.npv, sensData.currency_code, lang)}</td>
                        <td className={cs.npv_delta >= 0 ? "num-pos" : "num-neg"}>
                          {formatCompactCurrency(cs.npv_delta, sensData.currency_code, lang)}
                        </td>
                        <td>{formatCurrency(cs.lcoe, sensData.currency_code, lang, 0)}</td>
                        <td>{cs.irr !== null ? formatPercent(cs.irr, lang, 2) : "-"}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
