"use client";

import { use, useEffect, useState } from "react";
import HybridShell from "@/components/hybrid/HybridShell";
import { ApiError } from "@/lib/api";
import { translateIssue } from "@/lib/errors-id";
import { fetchHybridPresets, validateHybridEmsRules } from "@/lib/hybrid-api";
import type {
  DispatchStrategyId,
  HybridEmsRuleAction,
  HybridEmsRuleItem,
  HybridEmsRulePreset,
  HybridEmsRuleSet,
  HybridPresetsResponse,
} from "@/lib/hybrid-types";
import { tr, usePreferences } from "@/lib/preferences";
import { MissingProjectState, useHybridProject } from "@/lib/use-hybrid-project";

const DEFAULT_CUSTOM_EMS_RULES: HybridEmsRuleSet = {
  ems_schema_version: "0.1",
  name: "peak_cut_daytime",
  description: "Aturan supervisory peak-cut dengan proteksi cadangan SOC baterai.",
  params: {
    reserve_soc_fraction: 0.3,
    soc_max_fraction: 0.95,
    grid_export_limit_kw: 2000.0,
  },
  priority: ["pv", "bess", "biomass"],
  fallback_mode_dispatcher: true,
  rules: [
    {
      id: "r_enforce_peak_cut_limit",
      enabled: true,
      priority: 5,
      mode_scope: ["peak_cut", "grid_connected_normal"],
      when: { var: "grid_connected", op: "==", value: true },
      then: [{ action: "enforce_export_limit", limit: "$params.grid_export_limit_kw" }],
    },
    {
      id: "r_peak_cut_charge_surplus",
      enabled: true,
      priority: 10,
      mode_scope: ["*"],
      when: {
        all: [
          { var: "pv_surplus_kw", op: ">", value: 0.0 },
          { var: "bess_soc_fraction", op: "<", value: "$params.soc_max_fraction" },
        ],
      },
      then: [{ action: "charge_bess", limit: "pv_surplus_kw" }],
    },
    {
      id: "r_peak_cut_discharge_support",
      enabled: true,
      priority: 20,
      mode_scope: ["*"],
      when: {
        all: [
          { var: "net_load_kw", op: ">", value: 0.0 },
          { var: "bess_soc_fraction", op: ">", value: "$params.reserve_soc_fraction" },
        ],
      },
      then: [{ action: "discharge_bess", limit: "net_load_kw" }],
    },
  ],
};

const FALLBACK_EMS_RULE_PRESETS: HybridEmsRulePreset[] = [
  {
    id: "peak_cut_daytime",
    name_id: "Pemangkasan Puncak & Penyangga Siang (Peak-Cut)",
    name_en: "Peak-Cut & Daytime Solar Buffering",
    description_id:
      "Menyimpan kelebihan energi surya siang hari ke baterai, membatasi daya puncak jaringan, dan menjaga cadangan baterai minimum.",
    description_en:
      "Buffers daytime PV surplus into BESS, caps peak grid power, and protects reserve battery state of charge.",
    rule_set: DEFAULT_CUSTOM_EMS_RULES,
  },
  {
    id: "islanded_reserve_protection",
    name_id: "Proteksi Cadangan Off-Grid (Islanded Reserve)",
    name_en: "Islanded Microgrid Reserve Protection",
    description_id:
      "Mengutamakan kestabilan jaringan mandiri (off-grid/islanded): mengisi baterai dari surplus surya, menjaga batas bawah SOC, dan menyalakan biomass saat beban tinggi.",
    description_en:
      "Prioritizes standalone microgrid stability: charges BESS from PV surplus, protects minimum SOC, and dispatches biomass during high net load.",
    rule_set: {
      ems_schema_version: "0.1",
      name: "islanded_reserve_protection",
      description: "Aturan supervisory sistem mandiri (islanded) dengan dukungan biomass.",
      params: {
        soc_min_fraction: 0.2,
        soc_max_fraction: 0.95,
      },
      priority: ["pv", "bess", "biomass"],
      fallback_mode_dispatcher: true,
      rules: [
        {
          id: "r_islanded_charge_excess_pv",
          enabled: true,
          priority: 10,
          mode_scope: ["*"],
          when: {
            all: [
              { var: "pv_surplus_kw", op: ">", value: 0.0 },
              { var: "bess_soc_fraction", op: "<", value: "$params.soc_max_fraction" },
            ],
          },
          then: [{ action: "charge_bess", limit: "pv_surplus_kw" }],
        },
        {
          id: "r_islanded_discharge_to_min_soc",
          enabled: true,
          priority: 20,
          mode_scope: ["*"],
          when: {
            all: [
              { var: "net_load_kw", op: ">", value: 0.0 },
              { var: "bess_soc_fraction", op: ">", value: "$params.soc_min_fraction" },
            ],
          },
          then: [{ action: "discharge_bess", limit: "net_load_kw" }],
        },
        {
          id: "r_islanded_start_biomass_on_deficit",
          enabled: true,
          priority: 30,
          mode_scope: ["*"],
          when: {
            all: [
              { var: "net_load_kw", op: ">", value: 0.0 },
              { var: "biomass_can_start", op: "==", value: true },
            ],
          },
          then: [
            { action: "start_biomass" },
            { action: "set_biomass_target", target: "net_load_kw" },
          ],
        },
      ],
    },
  },
  {
    id: "tou_industrial_hybrid",
    name_id: "Optimalisasi Jam Sibuk Industri (Evening Peak Support)",
    name_en: "Industrial Evening Peak & Night Support",
    description_id:
      "Menahan baterai di siang hari agar penuh dari surya, lalu menguras baterai dan menyalakan biomass pada jam beban puncak sore-malam (17:00 sampai 22:00).",
    description_en:
      "Charges BESS from daytime solar and prioritizes BESS discharge plus biomass support during evening peak hours (17:00 to 22:00).",
    rule_set: {
      ems_schema_version: "0.1",
      name: "tou_industrial_hybrid",
      description: "Aturan supervisory industri untuk pengisian siang dan pelepasan jam puncak.",
      params: {
        peak_reserve_soc: 0.25,
        daytime_hold_soc: 0.55,
        soc_max_fraction: 0.95,
      },
      priority: ["pv", "bess", "biomass"],
      fallback_mode_dispatcher: true,
      rules: [
        {
          id: "r_daytime_charge_pv",
          enabled: true,
          priority: 10,
          mode_scope: ["*"],
          when: {
            all: [
              { var: "pv_surplus_kw", op: ">", value: 0.0 },
              { var: "bess_soc_fraction", op: "<", value: "$params.soc_max_fraction" },
            ],
          },
          then: [{ action: "charge_bess", limit: "pv_surplus_kw" }],
        },
        {
          id: "r_evening_peak_discharge",
          enabled: true,
          priority: 15,
          mode_scope: ["*"],
          when: {
            all: [
              { var: "hour_of_day", op: "in", value: [17, 18, 19, 20, 21, 22] },
              { var: "net_load_kw", op: ">", value: 0.0 },
              { var: "bess_soc_fraction", op: ">", value: "$params.peak_reserve_soc" },
            ],
          },
          then: [{ action: "discharge_bess", limit: "net_load_kw" }],
        },
        {
          id: "r_off_peak_preserve_battery",
          enabled: true,
          priority: 25,
          mode_scope: ["*"],
          when: {
            all: [
              { var: "hour_of_day", op: "not_in", value: [17, 18, 19, 20, 21, 22] },
              { var: "net_load_kw", op: ">", value: 0.0 },
              { var: "bess_soc_fraction", op: ">", value: "$params.daytime_hold_soc" },
            ],
          },
          then: [{ action: "discharge_bess", limit: "net_load_kw" }],
        },
      ],
    },
  },
];

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
  {
    id: "custom_ems",
    name_id: "Aturan EMS Kustom (Supervisory Controller)",
    name_en: "Custom Supervisory EMS Rules",
    description_id:
      "Menjalankan aturan prioritas berbasis kondisi (SOC baterai, jam operasi, surplus PV, beban bersih, dan batas ekspor) dengan pengawasan keselamatan otomatis.",
    description_en:
      "Executes priority condition-action rules (battery SOC, hour of day, PV surplus, net load, and export limits) with automated supervisory safety checks.",
    default_params: {},
  },
];

const PARAM_LABELS_ID: Record<string, { label: string; isPercent: boolean; unit: string }> = {
  reserve_soc_fraction: { label: "Batas Cadangan SOC Baterai", isPercent: true, unit: "%" },
  soc_min_fraction: { label: "Batas Minimum SOC Baterai", isPercent: true, unit: "%" },
  soc_max_fraction: { label: "Batas Maksimum Pengisian SOC", isPercent: true, unit: "%" },
  peak_reserve_soc: { label: "Batas Bawah SOC Jam Sibuk", isPercent: true, unit: "%" },
  daytime_hold_soc: { label: "Target Tahan SOC Siang Hari", isPercent: true, unit: "%" },
  grid_export_limit_kw: { label: "Batas Daya Ekspor Jaringan", isPercent: false, unit: "kW" },
};

const VAR_LABELS_ID: Record<string, string> = {
  pv_surplus_kw: "Surplus Surya (kW)",
  net_load_kw: "Beban Bersih setelah PV (kW)",
  local_load_kw: "Beban Listrik (kW)",
  pv_available_kw: "Daya PV Tersedia (kW)",
  bess_soc_fraction: "SOC Baterai",
  hour_of_day: "Jam Operasi",
  grid_connected: "Status Grid Terhubung",
  biomass_can_start: "Biomass Siap Menyala",
  biomass_status: "Status Biomass",
};

const ACTION_LABELS_ID: Record<string, string> = {
  charge_bess: "Isi Baterai (Charge BESS)",
  discharge_bess: "Kuras Baterai (Discharge BESS)",
  hold_bess: "Tahan Baterai (Hold)",
  start_biomass: "Nyalakan Pembangkit Biomass",
  stop_biomass: "Matikan Pembangkit Biomass",
  set_biomass_target: "Atur Target Daya Biomass",
  curtail_pv: "Batasi Keluaran PV (Curtail)",
  enforce_export_limit: "Terapkan Batas Ekspor Grid",
  follow_export_target: "Ikuti Target Ekspor Grid",
};

function formatConditionSummary(
  node: Record<string, unknown>,
  params: Record<string, number> | undefined,
): string {
  if (Array.isArray(node.all)) {
    return (node.all as Array<Record<string, unknown>>)
      .map((child) => formatConditionSummary(child, params))
      .join(" DAN ");
  }
  if (Array.isArray(node.any)) {
    return (node.any as Array<Record<string, unknown>>)
      .map((child) => formatConditionSummary(child, params))
      .join(" ATAU ");
  }
  const rawVar = String(node.var ?? "");
  const varLabel = VAR_LABELS_ID[rawVar] ?? rawVar;
  const op = String(node.op ?? "==");
  const rawVal = node.value;
  let valText = String(rawVal ?? "");
  if (typeof rawVal === "string" && rawVal.startsWith("$params.")) {
    const key = rawVal.slice("$params.".length);
    const paramMeta = PARAM_LABELS_ID[key];
    const numVal = params?.[key];
    if (typeof numVal === "number" && paramMeta) {
      valText = paramMeta.isPercent ? `${Math.round(numVal * 100)}%` : `${numVal} ${paramMeta.unit}`;
    } else {
      valText = key;
    }
  } else if (Array.isArray(rawVal)) {
    valText = rawVal.map((v) => `${String(v).padStart(2, "0")}:00`).join(", ");
  } else if (typeof rawVal === "boolean") {
    valText = rawVal ? "Ya" : "Tidak";
  }
  const opLabel = op === "in" ? "pada jam" : op === "not_in" ? "di luar jam" : op;
  return `${varLabel} ${opLabel} ${valText}`;
}

function formatActionSummary(
  actions: HybridEmsRuleAction[],
  params: Record<string, number> | undefined,
): string {
  return actions
    .map((a) => {
      const base = ACTION_LABELS_ID[a.action] ?? a.action;
      const arg = a.limit ?? a.target;
      if (arg === undefined) return base;
      if (typeof arg === "string" && arg.startsWith("$params.")) {
        const key = arg.slice("$params.".length);
        const meta = PARAM_LABELS_ID[key];
        const numVal = params?.[key];
        if (typeof numVal === "number" && meta) {
          return `${base} (${meta.isPercent ? `${Math.round(numVal * 100)}%` : `${numVal} ${meta.unit}`})`;
        }
      }
      if (typeof arg === "string" && VAR_LABELS_ID[arg]) {
        return `${base} sebesar ${VAR_LABELS_ID[arg]}`;
      }
      return `${base} (${String(arg)})`;
    })
    .join(" + ");
}

export default function HybridEmsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, ready, updateProject } = useHybridProject(projectId);
  const { lang } = usePreferences();
  const [presets, setPresets] = useState<HybridPresetsResponse | null>(null);
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [validationState, setValidationState] = useState<{
    status: "idle" | "checking" | "valid" | "error";
    message: string;
  }>({ status: "idle", message: "" });

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
  const rulePresets = presets?.ems_rule_presets ?? FALLBACK_EMS_RULE_PRESETS;
  const activeStrategy = project.simulation.dispatch_strategy;
  const dp = project.simulation.dispatch_params;
  const activeRuleSet: HybridEmsRuleSet = dp.ems_rules ?? DEFAULT_CUSTOM_EMS_RULES;
  const matchedPreset = rulePresets.find((pr) => pr.rule_set.name === activeRuleSet.name);

  function selectStrategy(id: DispatchStrategyId) {
    updateProject((p) => ({
      ...p,
      simulation: {
        ...p.simulation,
        dispatch_strategy: id,
        dispatch_params: {
          ...p.simulation.dispatch_params,
          allow_grid_import:
            id === "peak_shaving" || id === "time_of_use_arbitrage"
              ? true
              : p.simulation.dispatch_params.allow_grid_import,
          ems_rules:
            id === "custom_ems"
              ? (p.simulation.dispatch_params.ems_rules ?? structuredClone(DEFAULT_CUSTOM_EMS_RULES))
              : p.simulation.dispatch_params.ems_rules,
        },
      },
    }));
    setValidationState({ status: "idle", message: "" });
  }

  function applyRulePreset(preset: HybridEmsRulePreset) {
    const cloned = structuredClone(preset.rule_set);
    updateProject((p) => ({
      ...p,
      simulation: {
        ...p.simulation,
        dispatch_strategy: "custom_ems",
        dispatch_params: {
          ...p.simulation.dispatch_params,
          ems_rules: cloned,
        },
      },
    }));
    setJsonDraft(JSON.stringify(cloned, null, 2));
    setValidationState({
      status: "valid",
      message: `Preset "${lang === "id" ? preset.name_id : preset.name_en}" siap digunakan (${cloned.rules.length} aturan aktif).`,
    });
  }

  function toggleRuleEnabled(ruleId: string, nextEnabled: boolean) {
    const nextRules: HybridEmsRuleItem[] = activeRuleSet.rules.map((r) =>
      r.id === ruleId ? { ...r, enabled: nextEnabled } : r,
    );
    const nextSet: HybridEmsRuleSet = { ...activeRuleSet, rules: nextRules };
    updateProject((p) => ({
      ...p,
      simulation: {
        ...p.simulation,
        dispatch_params: {
          ...p.simulation.dispatch_params,
          ems_rules: nextSet,
        },
      },
    }));
    setJsonDraft(JSON.stringify(nextSet, null, 2));
  }

  function updateRuleParam(paramKey: string, nextValue: number) {
    if (!Number.isFinite(nextValue)) return;
    const nextSet: HybridEmsRuleSet = {
      ...activeRuleSet,
      params: {
        ...(activeRuleSet.params ?? {}),
        [paramKey]: nextValue,
      },
    };
    updateProject((p) => ({
      ...p,
      simulation: {
        ...p.simulation,
        dispatch_params: {
          ...p.simulation.dispatch_params,
          ems_rules: nextSet,
        },
      },
    }));
    setJsonDraft(JSON.stringify(nextSet, null, 2));
  }

  async function handleValidateCurrentRules(candidateSet?: HybridEmsRuleSet) {
    const target = candidateSet ?? activeRuleSet;
    setValidationState({ status: "checking", message: "Memeriksa keamanan dan struktur aturan EMS..." });
    try {
      const report = await validateHybridEmsRules(target);
      setValidationState({
        status: "valid",
        message: `Aturan EMS sah (Skema v${report.schema_version}): ${report.enabled_rule_count} dari ${report.rule_count} aturan aktif dan aman dijalankan.`,
      });
    } catch (err) {
      if (err instanceof ApiError && err.problems.issues.length > 0) {
        const msg = err.problems.issues.map((i) => translateIssue(i)).join(" ");
        setValidationState({ status: "error", message: msg });
      } else if (err instanceof ApiError && err.problems.general.length > 0) {
        setValidationState({ status: "error", message: err.problems.general.join(" ") });
      } else if (err instanceof Error) {
        setValidationState({ status: "error", message: err.message });
      } else {
        setValidationState({ status: "error", message: "Gagal memvalidasi aturan EMS." });
      }
    }
  }

  function handleApplyJsonDraft() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonDraft);
    } catch {
      setValidationState({
        status: "error",
        message: "Format JSON tidak sah. Periksa tanda kutip atau koma yang kurang.",
      });
      return;
    }
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as HybridEmsRuleSet).rules)) {
      setValidationState({
        status: "error",
        message: "Dokumen aturan EMS harus berupa objek JSON yang memiliki daftar 'rules'.",
      });
      return;
    }
    const candidate = parsed as HybridEmsRuleSet;
    updateProject((p) => ({
      ...p,
      simulation: {
        ...p.simulation,
        dispatch_params: {
          ...p.simulation.dispatch_params,
          ems_rules: candidate,
        },
      },
    }));
    void handleValidateCurrentRules(candidate);
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
        "Choose a built-in dispatch strategy or activate Custom Supervisory EMS Rules with ready-to-use templates.",
        "Pilih strategi dispatch bawaan atau aktifkan Aturan EMS Kustom (Supervisory Controller) dengan preset siap pakai.",
        "標準ディスパッチ戦略を選択するか、プリセット付きのカスタム監視EMSルールを有効化します。",
      )}
      result={result}
    >
      <div className="grid-hybrid">
        <section aria-labelledby="h-ems-strat">
          <h2 id="h-ems-strat" style={{ marginTop: 0 }}>
            {tr(lang, "Dispatch Strategies", "Pilihan Strategi Dispatch", "ディスパッチ戦略の選択")}
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
            <span className="chip">
              {activeStrategy === "custom_ems" ? "Supervisory EMS v0.1" : activeStrategy}
            </span>
          </div>

          <label className="check-row">
            <input
              type="checkbox"
              checked={dp.allow_grid_import}
              onChange={(e) =>
                updateProject((p) => ({
                  ...p,
                  simulation: {
                    ...p.simulation,
                    dispatch_params: { ...p.simulation.dispatch_params, allow_grid_import: e.target.checked },
                  },
                }))
              }
            />
            <span>Izinkan impor listrik dari jaringan Grid saat defisit</span>
          </label>

          <label className="check-row">
            <input
              type="checkbox"
              checked={dp.allow_grid_export}
              onChange={(e) =>
                updateProject((p) => ({
                  ...p,
                  simulation: {
                    ...p.simulation,
                    dispatch_params: { ...p.simulation.dispatch_params, allow_grid_export: e.target.checked },
                  },
                }))
              }
            />
            <span>Izinkan ekspor surplus listrik ke jaringan Grid</span>
          </label>

          {activeStrategy === "cycle_charging" && (
            <div className="fld">
              <label htmlFor="ems-target-soc">Target SOC Pengisian Siklus (%)</label>
              <input
                id="ems-target-soc"
                type="number"
                className="tabular-nums"
                min={20}
                max={100}
                value={Math.round(dp.target_soc_fraction * 100)}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  if (Number.isFinite(v)) {
                    updateProject((p) => ({
                      ...p,
                      simulation: {
                        ...p.simulation,
                        dispatch_params: { ...p.simulation.dispatch_params, target_soc_fraction: v },
                      },
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
                className="tabular-nums"
                min={1}
                value={dp.peak_limit_kw ?? 250}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) {
                    updateProject((p) => ({
                      ...p,
                      simulation: {
                        ...p.simulation,
                        dispatch_params: { ...p.simulation.dispatch_params, peak_limit_kw: v },
                      },
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
                    className="tabular-nums"
                    min={20}
                    max={100}
                    value={Math.round(dp.tou_charge_soc_target * 100)}
                    onChange={(e) => {
                      const v = Number(e.target.value) / 100;
                      if (Number.isFinite(v)) {
                        updateProject((p) => ({
                          ...p,
                          simulation: {
                            ...p.simulation,
                            dispatch_params: { ...p.simulation.dispatch_params, tou_charge_soc_target: v },
                          },
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
                    className="tabular-nums"
                    min={5}
                    max={90}
                    value={Math.round(dp.tou_discharge_soc_floor * 100)}
                    onChange={(e) => {
                      const v = Number(e.target.value) / 100;
                      if (Number.isFinite(v)) {
                        updateProject((p) => ({
                          ...p,
                          simulation: {
                            ...p.simulation,
                            dispatch_params: { ...p.simulation.dispatch_params, tou_discharge_soc_floor: v },
                          },
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

          {activeStrategy === "custom_ems" && (
            <div className="sec">
              <div className="card-header" style={{ marginBottom: "0.5rem" }}>
                <h3 style={{ margin: 0 }}>1. Pilih Preset Aturan Supervisory Siap Pakai</h3>
                <span className="chip">Klik untuk menerapkan</span>
              </div>
              <p className="note" style={{ marginBottom: "0.75rem" }}>
                Pilih salah satu paket aturan di bawah ini sesuai kebutuhan proyek Anda. Seluruh aturan dieksekusi secara deterministik tanpa eksekusi kode bebas.
              </p>

              <div style={{ display: "grid", gap: "0.625rem" }}>
                {rulePresets.map((preset) => {
                  const isCurrentPreset = activeRuleSet.name === preset.rule_set.name;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className="strategy-card"
                      aria-pressed={isCurrentPreset}
                      onClick={() => applyRulePreset(preset)}
                    >
                      <div className="actions-inline" style={{ justifyContent: "space-between", marginBottom: "0.25rem" }}>
                        <strong style={{ color: "var(--navytext)" }}>
                          {lang === "id" ? preset.name_id : preset.name_en}
                        </strong>
                        <span className="chip">{preset.rule_set.rules.length} aturan</span>
                      </div>
                      <p className="note">{lang === "id" ? preset.description_id : preset.description_en}</p>
                    </button>
                  );
                })}
              </div>

              {activeRuleSet.params && Object.keys(activeRuleSet.params).length > 0 && (
                <div className="sec">
                  <h3 style={{ marginBottom: "0.5rem" }}>2. Sesuaikan Ambang Batas Aturan (Default Preset / Input Pengguna)</h3>
                  <div className="grid-2">
                    {Object.entries(activeRuleSet.params).map(([key, rawVal]) => {
                      const meta = PARAM_LABELS_ID[key] ?? { label: key, isPercent: false, unit: "" };
                      const displayVal = meta.isPercent ? Math.round(Number(rawVal) * 100) : Number(rawVal);
                      const inputId = `ems-param-${key}`;
                      const presetDefault = matchedPreset?.rule_set.params?.[key];
                      const isPresetDefault =
                        typeof presetDefault === "number" && Math.abs(Number(rawVal) - presetDefault) < 1e-9;
                      const sourceLabel = isPresetDefault ? "Default Preset" : "Input Pengguna";
                      return (
                        <div className="fld" key={key} style={{ marginTop: 0 }}>
                          <div className="label-row">
                            <label htmlFor={inputId}>{meta.label}</label>
                            <span className="unit tabular-nums">
                              {displayVal} {meta.unit} ({sourceLabel})
                            </span>
                          </div>
                          <input
                            id={inputId}
                            type="number"
                            className="tabular-nums"
                            min={meta.isPercent ? 5 : 0}
                            max={meta.isPercent ? 100 : 100000}
                            value={displayVal}
                            onChange={(e) => {
                              const num = Number(e.target.value);
                              if (Number.isFinite(num)) {
                                updateRuleParam(key, meta.isPercent ? num / 100 : num);
                              }
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="sec">
                <div className="actions-inline" style={{ justifyContent: "space-between", marginBottom: "0.5rem" }}>
                  <h3 style={{ margin: 0 }}>3. Tabel Urutan Prioritas Aturan EMS</h3>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    disabled={validationState.status === "checking"}
                    onClick={() => void handleValidateCurrentRules()}
                  >
                    {validationState.status === "checking" ? "Memeriksa Aturan..." : "Periksa Keamanan Aturan"}
                  </button>
                </div>

                {validationState.status === "valid" && (
                  <div
                    className="state good"
                    role="status"
                    style={{ marginBottom: "0.75rem", padding: "0.75rem 1rem" }}
                  >
                    <p style={{ margin: 0 }}>{validationState.message}</p>
                  </div>
                )}
                {validationState.status === "error" && (
                  <div
                    className="state bad"
                    role="alert"
                    style={{ marginBottom: "0.75rem", padding: "0.75rem 1rem" }}
                  >
                    <p style={{ margin: 0 }}>{validationState.message}</p>
                  </div>
                )}

                <div className="tw" tabIndex={0} role="region" aria-label="Tabel daftar aturan EMS kustom">
                  <table className="sens-main">
                    <caption>
                      Daftar aturan aktif pada paket &ldquo;{activeRuleSet.name}&rdquo; (diurutkan dari angka prioritas terkecil)
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Aktif</th>
                        <th scope="col">Prioritas</th>
                        <th scope="col">ID Aturan</th>
                        <th scope="col">Syarat Kondisi (Kapan Aktif)</th>
                        <th scope="col">Keputusan Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeRuleSet.rules.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ textAlign: "left" }}>
                            Belum ada aturan EMS kustom yang terdaftar. Pilih salah satu preset aturan siap pakai di atas untuk memulai.
                          </td>
                        </tr>
                      ) : (
                        [...activeRuleSet.rules]
                          .sort((a, b) => a.priority - b.priority)
                          .map((rule) => {
                            const isEnabled = rule.enabled !== false;
                            return (
                              <tr key={rule.id}>
                                <td>
                                  <input
                                    type="checkbox"
                                    checked={isEnabled}
                                    aria-label={`Aktifkan aturan ${rule.id}`}
                                    onChange={(e) => toggleRuleEnabled(rule.id, e.target.checked)}
                                  />
                                </td>
                                <td className="tabular-nums">{rule.priority}</td>
                                <th scope="row">
                                  <code>{rule.id}</code>
                                </th>
                                <td style={{ textAlign: "left" }}>
                                  {formatConditionSummary(rule.when, activeRuleSet.params)}
                                </td>
                                <td style={{ textAlign: "left" }}>
                                  <strong>{formatActionSummary(rule.then, activeRuleSet.params)}</strong>
                                </td>
                              </tr>
                            );
                          })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="sec">
                <button
                  type="button"
                  className="btn ghost btn-sm"
                  aria-expanded={jsonEditorOpen}
                  onClick={() => {
                    if (!jsonEditorOpen) {
                      setJsonDraft(JSON.stringify(activeRuleSet, null, 2));
                    }
                    setJsonEditorOpen(!jsonEditorOpen);
                  }}
                >
                  {jsonEditorOpen ? "Sembunyikan Editor JSON Tingkat Lanjut" : "Buka Editor JSON Tingkat Lanjut (Opsional)"}
                </button>

                {jsonEditorOpen && (
                  <div className="fld" style={{ marginTop: "0.75rem" }}>
                    <label htmlFor="ems-json-editor">Dokumen Skema JSON EMS v0.1</label>
                    <textarea
                      id="ems-json-editor"
                      rows={12}
                      value={jsonDraft}
                      onChange={(e) => setJsonDraft(e.target.value)}
                      style={{
                        width: "100%",
                        fontFamily: "monospace",
                        fontSize: "0.85rem",
                        padding: "0.625rem",
                        borderRadius: "4px",
                        border: "1px solid var(--border)",
                        background: "var(--surface)",
                        color: "var(--text)",
                      }}
                    />
                    <div className="actions-inline" style={{ marginTop: "0.5rem" }}>
                      <button type="button" className="btn primary btn-sm" onClick={handleApplyJsonDraft}>
                        Terapkan &amp; Validasi JSON
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </HybridShell>
  );
}
