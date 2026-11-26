"use client";

import Link from "next/link";
import RangeNumberField from "@/components/hybrid/RangeNumberField";
import { formatNumber } from "@/lib/format";
import {
  connectTopologyNodes,
  disconnectNodeFromBus,
  isKindConnectedToBus,
  isRequiredNodeKind,
  removeTopologyNode,
  resolveProjectTopology,
} from "@/lib/hybrid-topology";
import type {
  BiomassPlantSampleId,
  BiomassPresetId,
  HybridPresetsResponse,
  HybridProjectConfig,
  TopologyNode,
  TopologyValidationResult,
} from "@/lib/hybrid-types";
import { usePreferences } from "@/lib/preferences";

export default function ComponentInspector({
  project,
  selectedNodeId,
  presets,
  validation,
  onChangeProject,
  onSelectNode,
  onNotify,
}: {
  project: HybridProjectConfig;
  selectedNodeId: string;
  presets: HybridPresetsResponse | null;
  validation: TopologyValidationResult;
  onChangeProject: (next: HybridProjectConfig) => void;
  onSelectNode: (nodeId: string) => void;
  onNotify?: (message: string, tone: "info" | "success" | "error") => void;
}) {
  const { lang } = usePreferences();
  const topology = resolveProjectTopology(project);
  const selectedNode: TopologyNode | undefined =
    topology.nodes.find((n) => n.id === selectedNodeId) ?? topology.nodes[0];

  if (!selectedNode) {
    return (
      <aside className="card">
        <p className="note">Pilih komponen di kanvas untuk mengatur parameternya.</p>
      </aside>
    );
  }

  const acBus = topology.nodes.find((n) => n.kind === "ac_bus");
  const isBus = selectedNode.kind === "ac_bus";
  const isRequired = isRequiredNodeKind(selectedNode.kind);
  const isConnected = isKindConnectedToBus(topology, selectedNode.kind);
  const { pv, bess, biomass, diesel } = project.components;

  const nodeIssues = [...validation.errors, ...validation.warnings].filter(
    (issue) => issue.nodeId === selectedNode.id,
  );

  function update(updater: (prev: HybridProjectConfig) => HybridProjectConfig) {
    onChangeProject(updater(project));
  }

  function handlePlantSampleChange(sampleId: string) {
    if (!sampleId) {
      update((p) => ({
        ...p,
        components: { ...p.components, biomass: { ...p.components.biomass, plant_sample: null } },
      }));
      return;
    }
    const typed = sampleId as BiomassPlantSampleId;
    const sample = presets?.plant_samples?.[typed];
    update((p) => ({
      ...p,
      components: {
        ...p.components,
        biomass: {
          ...p.components.biomass,
          plant_sample: typed,
          rated_capacity_kw: sample ? sample.rated_capacity_kw : typed === "sample_steam_turbine_1000kw" ? 1000 : 250,
          min_load_fraction: sample ? sample.min_load_fraction : typed === "sample_steam_turbine_1000kw" ? 0.45 : 0.4,
          overhaul_interval_operating_hours: sample
            ? sample.overhaul_interval_operating_hours
            : typed === "sample_steam_turbine_1000kw"
              ? 16000
              : 8000,
        },
      },
    }));
  }

  function handleConnect() {
    if (!acBus || !selectedNode) return;
    const res = connectTopologyNodes(project, selectedNode.id, acBus.id);
    if (res.error) {
      onNotify?.(res.error.messageId, "error");
    } else {
      onChangeProject(res.project);
      onNotify?.("Komponen berhasil dihubungkan ke AC Bus.", "success");
    }
  }

  function handleDisconnect() {
    if (!selectedNode) return;
    onChangeProject(disconnectNodeFromBus(project, selectedNode.id));
    onNotify?.("Koneksi komponen ke AC Bus diputuskan.", "info");
  }

  function handleRemove() {
    if (!selectedNode) return;
    const res = removeTopologyNode(project, selectedNode.id);
    if (!res.removed) {
      onNotify?.(res.reason || "Komponen wajib dikunci.", "error");
      return;
    }
    onChangeProject(res.project);
    onSelectNode("node-ac-bus");
    onNotify?.("Komponen opsional dihapus dari kanvas.", "info");
  }

  const titleByKind: Record<TopologyNode["kind"], string> = {
    pv: "Inspektor Solar PV",
    bess: "Inspektor BESS (Baterai)",
    biomass: "Inspektor Pembangkit Biomass",
    diesel: "Inspektor Diesel Generator",
    ac_bus: "Inspektor AC Bus & EMS",
    load: "Inspektor Beban Listrik",
    grid: "Inspektor Jaringan Listrik (Grid)",
  };

  return (
    <aside className="card" aria-labelledby="h-inspector">
      <div className="card-header">
        <div>
          <h2 id="h-inspector">{titleByKind[selectedNode.kind]}</h2>
          <p className="note tabular-nums">
            Posisi kanvas: X {selectedNode.x}, Y {selectedNode.y}
          </p>
        </div>
        <span className={`chip ${isConnected ? "chip-viable" : "chip-marginal"}`}>
          {isBus ? "Pusat Bus" : isConnected ? "Terhubung" : "Terputus"}
        </span>
      </div>

      {/* Kontrol koneksi & penghapusan komponen */}
      {!isBus && (
        <div className="actions-inline" style={{ marginBottom: "1rem" }}>
          {isConnected ? (
            <button type="button" className="btn btn-sm ghost" onClick={handleDisconnect}>
              Putuskan Koneksi
            </button>
          ) : (
            <button type="button" className="btn btn-sm primary" onClick={handleConnect}>
              Hubungkan ke AC Bus
            </button>
          )}

          {isRequired ? (
            <span className="chip">Komponen wajib terkunci</span>
          ) : (
            <button type="button" className="btn btn-sm danger-ghost" onClick={handleRemove}>
              Hapus dari Kanvas
            </button>
          )}
        </div>
      )}

      {nodeIssues.length > 0 && (
        <div className={nodeIssues.some((i) => i.severity === "error") ? "state bad" : "warn"} role="note" style={{ marginBottom: "1rem" }}>
          <ul>
            {nodeIssues.map((issue, i) => (
              <li key={i}>{lang === "en" ? issue.messageEn : issue.messageId}</li>
            ))}
          </ul>
        </div>
      )}

      {selectedNode.kind === "pv" && (
        <div>
          <div className="fld" style={{ marginTop: 0 }}>
            <label htmlFor="pv-model">Model Simulasi PV</label>
            <select
              id="pv-model"
              value={pv.model}
              onChange={(e) =>
                update((p) => ({
                  ...p,
                  components: { ...p.components, pv: { ...p.components.pv, model: e.target.value as "pvwatts_v1" | "detailed_v1" } },
                }))
              }
            >
              <option value="detailed_v1">Detail 8-Tahap Setara SAM (Perez + Faiman)</option>
              <option value="pvwatts_v1">PVWatts Cepat (Isotropik + NOCT)</option>
            </select>
          </div>

          <RangeNumberField
            id="pv-kwp"
            label="Kapasitas DC PV"
            unit="kWp"
            min={1}
            max={10000}
            step={10}
            value={pv.capacity_kwp}
            error={pv.capacity_kwp <= 0 ? "Kapasitas DC PV harus lebih besar dari 0 kWp." : undefined}
            onChange={(v) => update((p) => ({ ...p, components: { ...p.components, pv: { ...p.components.pv, capacity_kwp: v } } }))}
          />
          <RangeNumberField
            id="pv-inv"
            label="Kapasitas AC Inverter"
            unit="kW"
            min={1}
            max={10000}
            step={10}
            value={pv.inverter_ac_kw}
            error={pv.inverter_ac_kw <= 0 ? "Kapasitas AC inverter harus lebih besar dari 0 kW." : undefined}
            onChange={(v) => update((p) => ({ ...p, components: { ...p.components, pv: { ...p.components.pv, inverter_ac_kw: v } } }))}
          />

          <p className="note tabular-nums" style={{ marginTop: "0.5rem" }}>
            Rasio DC/AC: {pv.inverter_ac_kw > 0 ? formatNumber(pv.capacity_kwp / pv.inverter_ac_kw, lang, 2) : "Tidak sah"}
          </p>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="pv-tilt">Kemiringan (Tilt, derajat)</label>
              <input
                id="pv-tilt"
                type="number"
                min={0}
                max={90}
                value={pv.tilt_degrees}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) update((p) => ({ ...p, components: { ...p.components, pv: { ...p.components.pv, tilt_degrees: v } } }));
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="pv-az">Azimuth (0=Utara / 180=Selatan)</label>
              <input
                id="pv-az"
                type="number"
                min={-180}
                max={360}
                value={pv.azimuth_degrees}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) update((p) => ({ ...p, components: { ...p.components, pv: { ...p.components.pv, azimuth_degrees: v } } }));
                }}
              />
            </div>
          </div>

          {pv.model === "detailed_v1" && (
            <div className="grid-2">
              <div className="fld">
                <label htmlFor="pv-transp">Model Transposisi</label>
                <select
                  id="pv-transp"
                  value={pv.transposition_model}
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      components: {
                        ...p.components,
                        pv: { ...p.components.pv, transposition_model: e.target.value as "isotropic" | "hay_davies" | "perez" },
                      },
                    }))
                  }
                >
                  <option value="perez">Perez (1990)</option>
                  <option value="hay_davies">Hay-Davies</option>
                  <option value="isotropic">Isotropik</option>
                </select>
              </div>
              <div className="fld">
                <label htmlFor="pv-track">Mode Tracking</label>
                <select
                  id="pv-track"
                  value={pv.tracking_mode}
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      components: {
                        ...p.components,
                        pv: { ...p.components.pv, tracking_mode: e.target.value as "fixed" | "single_axis" | "two_axis" },
                      },
                    }))
                  }
                >
                  <option value="fixed">Tetap (Fixed Tilt)</option>
                  <option value="single_axis">1 Sumbu (Single Axis)</option>
                  <option value="two_axis">2 Sumbu (Two Axis)</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedNode.kind === "bess" && (
        <div>
          <RangeNumberField
            id="bess-kwh"
            label="Kapasitas Nominal BESS"
            unit="kWh"
            min={10}
            max={20000}
            step={20}
            value={bess.nominal_capacity_kwh}
            error={bess.nominal_capacity_kwh <= 0 ? "Kapasitas nominal BESS harus lebih besar dari 0 kWh." : undefined}
            onChange={(v) => update((p) => ({ ...p, components: { ...p.components, bess: { ...p.components.bess, nominal_capacity_kwh: v } } }))}
          />
          <div className="grid-2">
            <div className="fld">
              <label htmlFor="bess-chg">Daya Charge Maks (kW)</label>
              <input
                id="bess-chg"
                type="number"
                min={1}
                aria-invalid={bess.max_charge_kw <= 0 ? "true" : undefined}
                value={bess.max_charge_kw}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) update((p) => ({ ...p, components: { ...p.components, bess: { ...p.components.bess, max_charge_kw: v } } }));
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="bess-dis">Daya Discharge Maks (kW)</label>
              <input
                id="bess-dis"
                type="number"
                min={1}
                aria-invalid={bess.max_discharge_kw <= 0 ? "true" : undefined}
                value={bess.max_discharge_kw}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) update((p) => ({ ...p, components: { ...p.components, bess: { ...p.components.bess, max_discharge_kw: v } } }));
                }}
              />
            </div>
          </div>
          <div className="grid-2">
            <div className="fld">
              <label htmlFor="bess-soc-min">SOC Minimum (%)</label>
              <input
                id="bess-soc-min"
                type="number"
                min={0}
                max={95}
                aria-invalid={bess.soc_min_fraction >= bess.soc_max_fraction ? "true" : undefined}
                value={Math.round(bess.soc_min_fraction * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  if (Number.isFinite(v)) update((p) => ({ ...p, components: { ...p.components, bess: { ...p.components.bess, soc_min_fraction: v } } }));
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="bess-soc-max">SOC Maksimum (%)</label>
              <input
                id="bess-soc-max"
                type="number"
                min={10}
                max={100}
                aria-invalid={bess.soc_min_fraction >= bess.soc_max_fraction ? "true" : undefined}
                value={Math.round(bess.soc_max_fraction * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  if (Number.isFinite(v)) update((p) => ({ ...p, components: { ...p.components, bess: { ...p.components.bess, soc_max_fraction: v } } }));
                }}
              />
            </div>
          </div>
          {bess.soc_min_fraction >= bess.soc_max_fraction && (
            <p className="err">SOC minimum harus lebih kecil dari SOC maksimum.</p>
          )}
        </div>
      )}

      {selectedNode.kind === "biomass" && (
        <div>
          <div className="fld" style={{ marginTop: 0 }}>
            <label htmlFor="bio-sample">Profil Sampel Pembangkit [REAL DATA]</label>
            <select
              id="bio-sample"
              value={biomass.plant_sample ?? "sample_gasifier_250kw"}
              onChange={(e) => handlePlantSampleChange(e.target.value)}
            >
              <option value="sample_gasifier_250kw">Sampel A: Gasifikasi 250 kW [REAL DATA]</option>
              <option value="sample_steam_turbine_1000kw">Sampel B: Boiler + Turbin Uap 1.000 kW [REAL DATA]</option>
            </select>
          </div>

          <RangeNumberField
            id="bio-kw"
            label="Kapasitas Terpasang Biomass"
            unit="kW"
            min={10}
            max={10000}
            step={25}
            value={biomass.rated_capacity_kw}
            error={biomass.rated_capacity_kw <= 0 ? "Kapasitas terpasang Biomass harus lebih besar dari 0 kW." : undefined}
            onChange={(v) => update((p) => ({ ...p, components: { ...p.components, biomass: { ...p.components.biomass, rated_capacity_kw: v } } }))}
          />

          <div className="fld">
            <label htmlFor="bio-fuel">Preset Bahan Bakar [REAL DATA]</label>
            <select
              id="bio-fuel"
              value={biomass.fuel_preset}
              onChange={(e) =>
                update((p) => ({
                  ...p,
                  components: { ...p.components, biomass: { ...p.components.biomass, fuel_preset: e.target.value as BiomassPresetId } },
                }))
              }
            >
              <option value="efb">EFB / Tandan Kosong Sawit (45% air, 8,5 MJ/kg)</option>
              <option value="pks">PKS / Cangkang Sawit (12% air, 16,5 MJ/kg)</option>
              <option value="wood_pellet">Wood Pellet (8% air, 17,5 MJ/kg)</option>
              <option value="woodchip">Woodchip / Serpihan Kayu (30% air, 12,2 MJ/kg)</option>
              <option value="rice_husk">Rice Husk / Sekam Padi (12% air, 13,5 MJ/kg)</option>
            </select>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="bio-supply-period">Periode Batas Pasokan</label>
              <select
                id="bio-supply-period"
                value={biomass.supply_period}
                onChange={(e) =>
                  update((p) => ({
                    ...p,
                    components: {
                      ...p.components,
                      biomass: { ...p.components.biomass, supply_period: e.target.value as "unlimited" | "daily" | "monthly" | "annual" },
                    },
                  }))
                }
              >
                <option value="unlimited">Tak Terbatas</option>
                <option value="daily">Harian</option>
                <option value="monthly">Bulanan</option>
                <option value="annual">Tahunan</option>
              </select>
            </div>
            {biomass.supply_period !== "unlimited" && (
              <div className="fld">
                <label htmlFor="bio-limit">Batas Pasokan (ton/periode)</label>
                <input
                  id="bio-limit"
                  type="number"
                  min={1}
                  value={biomass.supply_limit_tons}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) update((p) => ({ ...p, components: { ...p.components, biomass: { ...p.components.biomass, supply_limit_tons: v } } }));
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {selectedNode.kind === "diesel" && (
        <div>
          <p className="note" style={{ marginBottom: "0.75rem" }}>
            Sumber pembangkit fosil non-terbarukan (tidak dihitung ke Pangsa Terbarukan; emisi dihitung langsung dari konsumsi solar).
          </p>

          <RangeNumberField
            id="diesel-kw"
            label="Kapasitas Terpasang Diesel"
            unit="kW"
            min={10}
            max={10000}
            step={10}
            value={diesel.rated_capacity_kw}
            error={diesel.rated_capacity_kw <= 0 ? "Kapasitas Diesel harus lebih besar dari 0 kW." : undefined}
            onChange={(v) =>
              update((p) => ({ ...p, components: { ...p.components, diesel: { ...p.components.diesel, rated_capacity_kw: v } } }))
            }
          />

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="diesel-min-load">Beban Minimum (%, hindari wet stacking)</label>
              <input
                id="diesel-min-load"
                type="number"
                min={0}
                max={100}
                value={Math.round(diesel.min_load_fraction * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  if (Number.isFinite(v)) {
                    update((p) => ({ ...p, components: { ...p.components, diesel: { ...p.components.diesel, min_load_fraction: v } } }));
                  }
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="diesel-slope">Slope Konsumsi Solar (L/kWh)</label>
              <input
                id="diesel-slope"
                type="number"
                min={0.05}
                step={0.01}
                value={diesel.slope_liters_per_kwh}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    update((p) => ({ ...p, components: { ...p.components, diesel: { ...p.components.diesel, slope_liters_per_kwh: v } } }));
                  }
                }}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="diesel-fuel-price">Harga Solar ({project.project.currency_code}/L) [REAL DATA]</label>
              <input
                id="diesel-fuel-price"
                type="number"
                min={0}
                value={diesel.fuel_price_per_liter}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    update((p) => ({ ...p, components: { ...p.components, diesel: { ...p.components.diesel, fuel_price_per_liter: v } } }));
                  }
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="diesel-em">Faktor Emisi (kg CO2e/L, IPCC/DEFRA)</label>
              <input
                id="diesel-em"
                type="number"
                min={0}
                step={0.01}
                value={diesel.emission_factor_kg_co2e_per_liter}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    update((p) => ({
                      ...p,
                      components: { ...p.components, diesel: { ...p.components.diesel, emission_factor_kg_co2e_per_liter: v } },
                    }));
                  }
                }}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="diesel-min-run">Min. Run Time (jam)</label>
              <input
                id="diesel-min-run"
                type="number"
                min={0}
                step={1}
                value={diesel.min_run_time_hours}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    update((p) => ({ ...p, components: { ...p.components, diesel: { ...p.components.diesel, min_run_time_hours: v } } }));
                  }
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="diesel-min-down">Min. Down Time (jam)</label>
              <input
                id="diesel-min-down"
                type="number"
                min={0}
                step={1}
                value={diesel.min_down_time_hours}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    update((p) => ({ ...p, components: { ...p.components, diesel: { ...p.components.diesel, min_down_time_hours: v } } }));
                  }
                }}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="fld">
              <label htmlFor="diesel-fixed-om">O&amp;M Tetap ({project.project.currency_code}/kW/thn)</label>
              <input
                id="diesel-fixed-om"
                type="number"
                min={0}
                value={diesel.fixed_om_per_kw_year}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    update((p) => ({ ...p, components: { ...p.components, diesel: { ...p.components.diesel, fixed_om_per_kw_year: v } } }));
                  }
                }}
              />
            </div>
            <div className="fld">
              <label htmlFor="diesel-oh-cost">Biaya Overhaul ({project.project.currency_code})</label>
              <input
                id="diesel-oh-cost"
                type="number"
                min={0}
                value={diesel.overhaul_cost}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    update((p) => ({ ...p, components: { ...p.components, diesel: { ...p.components.diesel, overhaul_cost: v } } }));
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}

      {selectedNode.kind === "load" && (
        <div>
          <p className="note">
            <strong>Mode Beban:</strong> {project.load_profile.mode === "csv" ? "Unggahan CSV" : "Profil Sintetis"}
          </p>
          {project.load_profile.mode === "csv" ? (
            <p className="note">Berkas: {project.load_profile.csv_filename || "Belum dipilih"}</p>
          ) : (
            <p className="note tabular-nums">
              Beban dasar {formatNumber(project.load_profile.base_load_kw, lang, 0)} kW, puncak {formatNumber(project.load_profile.peak_load_kw, lang, 0)} kW.
            </p>
          )}
          <div className="row" style={{ borderTop: 0, paddingTop: "0.75rem", marginTop: "0.5rem" }}>
            <Link href={`/hybrid/${project.id}/load`} className="btn btn-sm ghost">
              Ubah Profil Beban di Halaman 3
            </Link>
          </div>
        </div>
      )}

      {selectedNode.kind === "grid" && (
        <div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={project.simulation.dispatch_params.allow_grid_import}
              disabled={!isConnected}
              onChange={(e) =>
                update((p) => ({
                  ...p,
                  simulation: {
                    ...p.simulation,
                    dispatch_params: { ...p.simulation.dispatch_params, allow_grid_import: e.target.checked },
                  },
                }))
              }
            />
            <span>Izinkan impor listrik dari jaringan PLN/Grid</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={project.simulation.dispatch_params.allow_grid_export}
              disabled={!isConnected}
              onChange={(e) =>
                update((p) => ({
                  ...p,
                  simulation: {
                    ...p.simulation,
                    dispatch_params: { ...p.simulation.dispatch_params, allow_grid_export: e.target.checked },
                  },
                }))
              }
            />
            <span>Izinkan ekspor surplus listrik ke jaringan PLN/Grid</span>
          </label>
          <p className="note tabular-nums" style={{ marginTop: "0.5rem" }}>
            Tarif impor saat ini: {formatNumber(project.finance.grid_import_tariff_per_kwh, lang, 0)} {project.project.currency_code}/kWh
          </p>
          <div className="row" style={{ borderTop: 0, paddingTop: "0.75rem", marginTop: "0.5rem" }}>
            <Link href={`/hybrid/${project.id}/ems`} className="btn btn-sm ghost">
              Atur Strategi EMS di Halaman 5
            </Link>
          </div>
        </div>
      )}

      {selectedNode.kind === "ac_bus" && (
        <div>
          <p className="note">
            <strong>Strategi Dispatch EMS:</strong> <code>{project.simulation.dispatch_strategy}</code>
          </p>
          <p className="note" style={{ marginTop: "0.5rem" }}>
            <strong>Komponen pada skema saat ini:</strong>
          </p>
          <div className="actions-inline" style={{ marginTop: "0.5rem" }}>
            {topology.nodes
              .filter((n) => n.kind !== "ac_bus")
              .map((n) => (
                <button
                  key={`jump-${n.id}`}
                  type="button"
                  className="btn btn-sm ghost"
                  onClick={() => onSelectNode(n.id)}
                >
                  {n.kind.toUpperCase()} ({isKindConnectedToBus(topology, n.kind) ? "Aktif" : "Terputus"})
                </button>
              ))}
          </div>
          <div className="row" style={{ borderTop: 0, paddingTop: "0.75rem", marginTop: "0.75rem" }}>
            <Link href={`/hybrid/${project.id}/ems`} className="btn btn-sm ghost">
              Buka Pengaturan EMS (Halaman 5)
            </Link>
          </div>
        </div>
      )}

      <p className="note" style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
        Seluruh parameter sampel berlabel <code>[REAL DATA]</code> bersumber dari <code>docs/assumptions.md</code>.
      </p>
    </aside>
  );
}
