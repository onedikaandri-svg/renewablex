"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import EChart, { getChartThemeColors, type EChartsOption } from "@/components/hybrid/EChart";
import { ViabilityChip } from "@/components/hybrid/HybridShell";
import { formatCompactCurrency, formatCurrency, formatNumber, formatPercent } from "@/lib/format";
import { getSimulationResult, listProjects } from "@/lib/hybrid-storage";
import type { HybridProjectConfig, HybridSimulateResponse } from "@/lib/hybrid-types";
import { usePreferences } from "@/lib/preferences";

interface ScenarioEntry {
  project: HybridProjectConfig;
  result: HybridSimulateResponse | null;
}

export default function ScenarioCompareTab({
  activeProjectId,
  refreshToken,
}: {
  activeProjectId: string;
  refreshToken: number;
}) {
  const { theme, lang } = usePreferences();
  const colors = useMemo(() => getChartThemeColors(theme), [theme]);
  const [entries, setEntries] = useState<ScenarioEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    const all = listProjects().map((p) => ({
      project: p,
      result: getSimulationResult(p.id),
    }));
    setEntries(all);
    const simulatedIds = all.filter((e) => e.result !== null).map((e) => e.project.id);
    setSelectedIds((prev) => {
      const stillValid = prev.filter((id) => simulatedIds.includes(id));
      if (stillValid.length >= 2) return stillValid.slice(0, 4);
      const defaults = simulatedIds.includes(activeProjectId)
        ? [activeProjectId, ...simulatedIds.filter((id) => id !== activeProjectId)]
        : simulatedIds;
      return defaults.slice(0, 4);
    });
  }, [activeProjectId, refreshToken]);

  const simulatedEntries = useMemo(() => entries.filter((e) => e.result !== null), [entries]);
  const unsimulatedEntries = useMemo(() => entries.filter((e) => e.result === null), [entries]);

  const selected = useMemo(
    () =>
      selectedIds
        .map((id) => simulatedEntries.find((e) => e.project.id === id))
        .filter((e): e is { project: HybridProjectConfig; result: HybridSimulateResponse } => Boolean(e && e.result)),
    [selectedIds, simulatedEntries],
  );

  function toggleScenario(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  }

  const bestMetrics = useMemo(() => {
    if (selected.length === 0) return { minLcoe: null, minNpc: null, maxNpv: null, maxRen: null };
    const lcoes = selected.map((s) => s.result.finance_summary?.lcoe ?? Infinity);
    const npcs = selected.map((s) => s.result.finance_summary?.total_npc ?? Infinity);
    const npvs = selected.map((s) => s.result.finance_summary?.npv ?? -Infinity);
    const rens = selected.map((s) => s.result.summary.renewable_fraction);
    return {
      minLcoe: Math.min(...lcoes),
      minNpc: Math.min(...npcs),
      maxNpv: Math.max(...npvs),
      maxRen: Math.max(...rens),
    };
  }, [selected]);

  const energyMixOption = useMemo<EChartsOption>(() => {
    if (selected.length < 2) return {};
    const names = selected.map((s) => s.project.project.project_name);
    const pv = selected.map((s) => Math.round(s.result.summary.pv_generation_kwh / 1000));
    const bio = selected.map((s) => Math.round(s.result.summary.biomass_generation_kwh / 1000));
    const grid = selected.map((s) =>
      Math.round((s.result.lifetime_summary.yearly?.[0]?.grid_import_kwh ?? 0) / 1000),
    );
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      legend: { top: 0, textStyle: { color: colors.text } },
      grid: { left: 56, right: 20, top: 44, bottom: 48 },
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { color: colors.muted, interval: 0, width: 110, overflow: "truncate" },
      },
      yAxis: {
        type: "value",
        name: "MWh/thn",
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      series: [
        { name: "PV", type: "bar", color: colors.pv, data: pv },
        { name: "Biomass", type: "bar", color: colors.biomass, data: bio },
        { name: "Grid Import", type: "bar", color: colors.grid, data: grid },
      ],
    };
  }, [selected, colors]);

  const lcoeCompareOption = useMemo<EChartsOption>(() => {
    if (selected.length < 2) return {};
    const names = selected.map((s) => s.project.project.project_name);
    const curr = selected[0].result.finance_summary?.currency_code ?? "IDR";
    const lcoes = selected.map((s) => Math.round(s.result.finance_summary?.lcoe ?? 0));
    return {
      tooltip: { trigger: "axis" },
      grid: { left: 72, right: 20, top: 28, bottom: 48 },
      xAxis: {
        type: "category",
        data: names,
        axisLabel: { color: colors.muted, interval: 0, width: 110, overflow: "truncate" },
      },
      yAxis: {
        type: "value",
        name: `${curr}/kWh`,
        nameTextStyle: { color: colors.muted },
        axisLabel: { color: colors.muted },
        splitLine: { lineStyle: { color: colors.border } },
      },
      series: [
        {
          name: "LCOE",
          type: "bar",
          color: colors.accent,
          data: lcoes,
        },
      ],
    };
  }, [selected, colors]);

  return (
    <div>
      <div className="card" style={{ marginBottom: "1rem" }}>
        <div className="card-header">
          <div>
            <h2>Pilih Skenario Proyek untuk Dibandingkan (2 sampai 4 Skenario)</h2>
            <p className="note">Hanya proyek yang sudah dijalankan simulasinya di Halaman 7 yang dapat dibandingkan.</p>
          </div>
          <Link href="/hybrid" className="btn btn-sm ghost">
            Kelola Daftar Proyek
          </Link>
        </div>

        {simulatedEntries.length === 0 ? (
          <div className="state">
            <h3>Belum ada skenario tersimulasikan</h3>
            <p>Jalankan simulasi pada minimal dua proyek (atau simpan pemenang sapuan sebagai skenario baru lalu jalankan simulasinya).</p>
          </div>
        ) : (
          <div className="grid-2">
            {simulatedEntries.map(({ project, result }) => {
              const checked = selectedIds.includes(project.id);
              const disabled = !checked && selectedIds.length >= 4;
              return (
                <label
                  key={project.id}
                  className="strategy-card"
                  style={{
                    borderColor: checked ? "var(--accent)" : undefined,
                    borderWidth: checked ? "2px" : "1px",
                    opacity: disabled ? 0.65 : 1,
                  }}
                >
                  <div className="actions-inline" style={{ justifyContent: "space-between" }}>
                    <span className="actions-inline">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleScenario(project.id)}
                      />
                      <strong>{project.project.project_name}</strong>
                    </span>
                    <ViabilityChip status={result?.finance_summary?.viability_status ?? null} />
                  </div>
                  <p className="note" style={{ marginTop: "0.35rem" }}>
                    PV {project.components.pv.capacity_kwp} kWp |{" "}
                    BESS {project.components.bess.enabled ? `${project.components.bess.nominal_capacity_kwh} kWh` : "Nonaktif"} |{" "}
                    Biomass {project.components.biomass.enabled ? `${project.components.biomass.rated_capacity_kw} kW` : "Nonaktif"}
                  </p>
                </label>
              );
            })}
          </div>
        )}

        {unsimulatedEntries.length > 0 && (
          <div style={{ marginTop: "0.875rem" }}>
            <p className="note">
              Skenario belum disimulasikan ({unsimulatedEntries.length}):{" "}
              {unsimulatedEntries.map((u, idx) => (
                <span key={u.project.id}>
                  {idx > 0 ? ", " : ""}
                  <Link href={`/hybrid/${u.project.id}/run`}>{u.project.project.project_name}</Link>
                </span>
              ))}
            </p>
          </div>
        )}
      </div>

      {selected.length < 2 ? (
        <div className="state">
          <h3>Pilih minimal 2 skenario tersimulasikan</h3>
          <p>
            Simpan kombinasi lain sebagai skenario baru pada Tab Sapuan Kombinasi lalu jalankan simulasinya di Halaman 7, atau pilih 2 proyek yang sudah disimulasikan di atas.
          </p>
        </div>
      ) : (
        <>
          <div className="tw" tabIndex={0} role="region" aria-label="Tabel perbandingan skenario hybrid, bisa digulir">
            <table>
              <caption>Perbandingan metrik teknis, keuangan, dan emisi antar skenario proyek.</caption>
              <thead>
                <tr>
                  <th scope="col">Metrik</th>
                  {selected.map(({ project }) => (
                    <th scope="col" key={project.id}>{project.project.project_name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Strategi EMS</th>
                  {selected.map(({ project }) => (
                    <td key={project.id}>{project.simulation.dispatch_strategy}</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Ukuran Komponen</th>
                  {selected.map(({ project }) => (
                    <td key={project.id}>
                      {formatNumber(project.components.pv.capacity_kwp, lang, 0)} kWp |{" "}
                      {project.components.bess.enabled ? `${formatNumber(project.components.bess.nominal_capacity_kwh, lang, 0)} kWh` : "0 kWh"} |{" "}
                      {project.components.biomass.enabled ? `${formatNumber(project.components.biomass.rated_capacity_kw, lang, 0)} kW` : "0 kW"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Status Kelayakan</th>
                  {selected.map(({ project, result }) => (
                    <td key={project.id}><ViabilityChip status={result.finance_summary?.viability_status ?? null} /></td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">LCOE</th>
                  {selected.map(({ project, result }) => {
                    const f = result.finance_summary;
                    const isBest = f && bestMetrics.minLcoe !== null && Math.abs(f.lcoe - bestMetrics.minLcoe) < 1e-6;
                    return (
                      <td key={project.id}>
                        {f ? `${formatCurrency(f.lcoe, f.currency_code, lang, 0)}/kWh` : "-"}
                        {isBest && <span className="chip chip-viable" style={{ marginLeft: "0.35rem" }}>Terbaik</span>}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <th scope="row">Total NPC</th>
                  {selected.map(({ project, result }) => {
                    const f = result.finance_summary;
                    const isBest = f && bestMetrics.minNpc !== null && Math.abs(f.total_npc - bestMetrics.minNpc) < 1e-2;
                    return (
                      <td key={project.id}>
                        {f ? formatCompactCurrency(f.total_npc, f.currency_code, lang) : "-"}
                        {isBest && <span className="chip chip-viable" style={{ marginLeft: "0.35rem" }}>Terbaik</span>}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <th scope="row">NPV</th>
                  {selected.map(({ project, result }) => {
                    const f = result.finance_summary;
                    const isBest = f && bestMetrics.maxNpv !== null && Math.abs(f.npv - bestMetrics.maxNpv) < 1e-2;
                    return (
                      <td key={project.id} className={f && f.npv >= 0 ? "num-pos" : "num-neg"}>
                        {f ? formatCompactCurrency(f.npv, f.currency_code, lang) : "-"}
                        {isBest && <span className="chip chip-viable" style={{ marginLeft: "0.35rem" }}>Terbaik</span>}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <th scope="row">IRR</th>
                  {selected.map(({ project, result }) => (
                    <td key={project.id}>
                      {result.finance_summary?.irr !== null && result.finance_summary?.irr !== undefined
                        ? formatPercent(result.finance_summary.irr, lang, 2)
                        : "-"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Payback (Sederhana / Terdiskonto)</th>
                  {selected.map(({ project, result }) => {
                    const f = result.finance_summary;
                    return (
                      <td key={project.id}>
                        {f?.simple_payback_years !== null && f?.simple_payback_years !== undefined
                          ? `${formatNumber(f.simple_payback_years, lang, 1)} thn`
                          : "-"}{" "}
                        /{" "}
                        {f?.discounted_payback_years !== null && f?.discounted_payback_years !== undefined
                          ? `${formatNumber(f.discounted_payback_years, lang, 1)} thn`
                          : "-"}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <th scope="row">Pangsa Energi Terbarukan</th>
                  {selected.map(({ project, result }) => {
                    const ren = result.summary.renewable_fraction;
                    const isBest = bestMetrics.maxRen !== null && Math.abs(ren - bestMetrics.maxRen) < 1e-6;
                    return (
                      <td key={project.id}>
                        {formatPercent(ren, lang, 1)}
                        {isBest && <span className="chip chip-viable" style={{ marginLeft: "0.35rem" }}>Terbaik</span>}
                      </td>
                    );
                  })}
                </tr>
                <tr>
                  <th scope="row">Unmet Load (Tahun 1)</th>
                  {selected.map(({ project, result }) => (
                    <td key={project.id}>{formatNumber(result.summary.unmet_load_kwh / 1000, lang, 1)} MWh</td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Emisi Dihindari</th>
                  {selected.map(({ project, result }) => (
                    <td key={project.id}>
                      {result.emissions_summary
                        ? `${formatNumber(result.emissions_summary.avoided_emissions_tons_co2e, lang, 0)} ton CO2e`
                        : "-"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="sec grid-2">
            <div className="chart-card">
              <div className="chart-head">
                <h3>Bauran Pembangkitan Energi (Tahun 1)</h3>
                <span className="chip">MWh / thn</span>
              </div>
              <EChart
                option={energyMixOption}
                height={300}
                ariaLabel="Grafik batang perbandingan bauran energi PV, Biomass, dan Grid antar skenario."
              />
            </div>

            <div className="chart-card">
              <div className="chart-head">
                <h3>Perbandingan LCOE Antar Skenario</h3>
                <span className="chip">per kWh</span>
              </div>
              <EChart
                option={lcoeCompareOption}
                height={300}
                ariaLabel="Grafik batang perbandingan LCOE antar skenario."
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
