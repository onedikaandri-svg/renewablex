"use client";

import { use, useEffect, useState } from "react";
import HybridShell from "@/components/hybrid/HybridShell";
import RangeNumberField from "@/components/hybrid/RangeNumberField";
import SystemSchematicSvg from "@/components/hybrid/SystemSchematicSvg";
import { fetchHybridPresets } from "@/lib/hybrid-api";
import type { BiomassPlantSampleId, BiomassPresetId, HybridPresetsResponse } from "@/lib/hybrid-types";
import { usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

export default function HybridSystemPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, ready, updateProject } = useHybridProject(projectId);
  const { lang } = usePreferences();
  const [presets, setPresets] = useState<HybridPresetsResponse | null>(null);

  useEffect(() => {
    fetchHybridPresets().then(setPresets).catch(() => {});
  }, []);

  if (!ready) return <div className="state"><p>Memuat proyek&hellip;</p></div>;
  if (!project) return <MissingProjectState />;

  const { pv, bess, biomass } = project.components;

  function handlePlantSampleChange(sampleId: string) {
    if (!sampleId) {
      updateProject((p) => ({
        ...p,
        components: { ...p.components, biomass: { ...p.components.biomass, plant_sample: null } },
      }));
      return;
    }
    const typed = sampleId as BiomassPlantSampleId;
    const sample = presets?.plant_samples?.[typed];
    updateProject((p) => ({
      ...p,
      components: {
        ...p.components,
        biomass: {
          ...p.components.biomass,
          plant_sample: typed,
          rated_capacity_kw: sample ? sample.rated_capacity_kw : typed === "sample_steam_turbine_1000kw" ? 1000 : 250,
          min_load_fraction: sample ? sample.min_load_fraction : typed === "sample_steam_turbine_1000kw" ? 0.45 : 0.40,
          overhaul_interval_operating_hours: sample ? sample.overhaul_interval_operating_hours : typed === "sample_steam_turbine_1000kw" ? 16000 : 8000,
        },
      },
    }));
  }

  return (
    <HybridShell
      project={project}
      activeStep="system"
      title={lang === "en" ? "System Architecture & Components" : "Desain Sistem & Parameter Komponen"}
      subtitle="Atur ukuran dan parameter fisik PV, BESS (baterai), serta Biomass. Pratinjau skema di kanan memperlihatkan topologi aktif."
      result={result}
    >
      <div className="grid-hybrid">
        <section className="card" aria-labelledby="h-sys">
          <div className="card-header">
            <h2 id="h-sys">Konfigurasi Komponen</h2>
          </div>

          {/* 1. Solar PV */}
          <fieldset style={{ borderTop: 0, marginTop: 0, paddingTop: 0 }}>
            <legend>1. Solar PV</legend>
            <div className="fld">
              <label htmlFor="pv-model">Model Simulasi PV</label>
              <select
                id="pv-model"
                value={pv.model}
                onChange={(e) =>
                  updateProject((p) => ({
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
              onChange={(v) => updateProject((p) => ({ ...p, components: { ...p.components, pv: { ...p.components.pv, capacity_kwp: v } } }))}
            />
            <RangeNumberField
              id="pv-inv"
              label="Kapasitas AC Inverter"
              unit="kW"
              min={1}
              max={10000}
              step={10}
              value={pv.inverter_ac_kw}
              onChange={(v) => updateProject((p) => ({ ...p, components: { ...p.components, pv: { ...p.components.pv, inverter_ac_kw: v } } }))}
            />

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
                    if (Number.isFinite(v)) updateProject((p) => ({ ...p, components: { ...p.components, pv: { ...p.components.pv, tilt_degrees: v } } }));
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
                    if (Number.isFinite(v)) updateProject((p) => ({ ...p, components: { ...p.components, pv: { ...p.components.pv, azimuth_degrees: v } } }));
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
                      updateProject((p) => ({
                        ...p,
                        components: { ...p.components, pv: { ...p.components.pv, transposition_model: e.target.value as "isotropic" | "hay_davies" | "perez" } },
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
                      updateProject((p) => ({
                        ...p,
                        components: { ...p.components, pv: { ...p.components.pv, tracking_mode: e.target.value as "fixed" | "single_axis" | "two_axis" } },
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
          </fieldset>

          {/* 2. BESS */}
          <fieldset>
            <legend>2. BESS (Penyimpanan Baterai)</legend>
            <label className="check-row">
              <input
                type="checkbox"
                checked={bess.enabled}
                onChange={(e) => updateProject((p) => ({ ...p, components: { ...p.components, bess: { ...p.components.bess, enabled: e.target.checked } } }))}
              />
              <span>Aktifkan BESS dalam sistem hybrid</span>
            </label>

            {bess.enabled && (
              <>
                <RangeNumberField
                  id="bess-kwh"
                  label="Kapasitas Nominal BESS"
                  unit="kWh"
                  min={10}
                  max={20000}
                  step={20}
                  value={bess.nominal_capacity_kwh}
                  onChange={(v) => updateProject((p) => ({ ...p, components: { ...p.components, bess: { ...p.components.bess, nominal_capacity_kwh: v } } }))}
                />
                <div className="grid-2">
                  <div className="fld">
                    <label htmlFor="bess-chg">Daya Charge Maks (kW)</label>
                    <input
                      id="bess-chg"
                      type="number"
                      min={1}
                      value={bess.max_charge_kw}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) updateProject((p) => ({ ...p, components: { ...p.components, bess: { ...p.components.bess, max_charge_kw: v } } }));
                      }}
                    />
                  </div>
                  <div className="fld">
                    <label htmlFor="bess-dis">Daya Discharge Maks (kW)</label>
                    <input
                      id="bess-dis"
                      type="number"
                      min={1}
                      value={bess.max_discharge_kw}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) updateProject((p) => ({ ...p, components: { ...p.components, bess: { ...p.components.bess, max_discharge_kw: v } } }));
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
                      value={Math.round(bess.soc_min_fraction * 100)}
                      onChange={(e) => {
                        const v = Number(e.target.value) / 100;
                        if (Number.isFinite(v)) updateProject((p) => ({ ...p, components: { ...p.components, bess: { ...p.components.bess, soc_min_fraction: v } } }));
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
                      value={Math.round(bess.soc_max_fraction * 100)}
                      onChange={(e) => {
                        const v = Number(e.target.value) / 100;
                        if (Number.isFinite(v)) updateProject((p) => ({ ...p, components: { ...p.components, bess: { ...p.components.bess, soc_max_fraction: v } } }));
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </fieldset>

          {/* 3. Biomass */}
          <fieldset>
            <legend>3. Pembangkit Biomass</legend>
            <label className="check-row">
              <input
                type="checkbox"
                checked={biomass.enabled}
                onChange={(e) => updateProject((p) => ({ ...p, components: { ...p.components, biomass: { ...p.components.biomass, enabled: e.target.checked } } }))}
              />
              <span>Aktifkan Pembangkit Biomass</span>
            </label>

            {biomass.enabled && (
              <>
                <div className="fld">
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
                  onChange={(v) => updateProject((p) => ({ ...p, components: { ...p.components, biomass: { ...p.components.biomass, rated_capacity_kw: v } } }))}
                />

                <div className="fld">
                  <label htmlFor="bio-fuel">Preset Bahan Bakar [REAL DATA]</label>
                  <select
                    id="bio-fuel"
                    value={biomass.fuel_preset}
                    onChange={(e) =>
                      updateProject((p) => ({
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
                        updateProject((p) => ({
                          ...p,
                          components: { ...p.components, biomass: { ...p.components.biomass, supply_period: e.target.value as "unlimited" | "daily" | "monthly" | "annual" } },
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
                          if (Number.isFinite(v)) updateProject((p) => ({ ...p, components: { ...p.components, biomass: { ...p.components.biomass, supply_limit_tons: v } } }));
                        }}
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </fieldset>
        </section>

        <section>
          <SystemSchematicSvg config={project} result={result} />
          <div className="sec card">
            <h3>Catatan Desain Sistem (Tahap 5)</h3>
            <p className="note">
              Seluruh parameter sampel pembangkit, bahan bakar, efisiensi baterai, dan rugi PV mengikuti dokumen asumsi di{" "}
              <code>docs/assumptions.md</code> berlabel <code>[REAL DATA]</code> dan dapat disesuaikan langsung.
              Kanvas skema tarik-lepas penuh dijadwalkan pada Tahap 6.
            </p>
          </div>
        </section>
      </div>
    </HybridShell>
  );
}
