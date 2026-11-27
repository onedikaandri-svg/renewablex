"use client";

import { use, useEffect, useState } from "react";
import HybridShell from "@/components/hybrid/HybridShell";
import { ApiError } from "@/lib/api";
import { translateIssue } from "@/lib/errors-id";
import { fetchHybridPresets, validateHybridEmsRules } from "@/lib/hybrid-api";
import {
  EMS_ACTION_SPECS,
  EMS_VARIABLE_SPECS,
  addVisualEmsRule,
  extractVisualDraftFromRule,
  formatEmsActionSummary,
  formatEmsConditionSummary,
  formatEmsParamMeta,
  formatEmsPresetMeta,
  formatEmsStrategyMeta,
  removeEmsRuleById,
  updateVisualEmsRule,
  type VisualActionKind,
  type VisualConditionCombinator,
  type VisualConditionOperator,
  type VisualEmsConditionClause,
  type VisualEmsRuleDraft,
} from "@/lib/hybrid-ems-utils";
import type {
  DispatchStrategyId,
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

const OPERATOR_CHOICES: Array<{ op: VisualConditionOperator; labelEn: string; labelId: string; labelJa: string }> = [
  { op: ">", labelEn: "> (greater than)", labelId: "> (lebih besar dari)", labelJa: "> (より大きい)" },
  { op: ">=", labelEn: ">= (at least)", labelId: ">= (minimal)", labelJa: ">= (以上)" },
  { op: "<", labelEn: "< (less than)", labelId: "< (lebih kecil dari)", labelJa: "< (より小さい)" },
  { op: "<=", labelEn: "<= (at most)", labelId: "<= (maksimal)", labelJa: "<= (以下)" },
  { op: "==", labelEn: "== (equals)", labelId: "== (sama dengan)", labelJa: "== (等しい)" },
  { op: "!=", labelEn: "!= (not equal)", labelId: "!= (tidak sama dengan)", labelJa: "!= (等しくない)" },
  { op: "in", labelEn: "in (in list, comma-separated)", labelId: "in (di dalam daftar jam/angka)", labelJa: "in (リストに含まれる)" },
  { op: "not_in", labelEn: "not_in (outside list)", labelId: "not_in (di luar daftar jam/angka)", labelJa: "not_in (リスト外)" },
];

function createDefaultVisualDraft(nextIndex: number): VisualEmsRuleDraft {
  return {
    id: `r_custom_${nextIndex}`,
    priority: nextIndex * 10,
    enabled: true,
    combinator: "all",
    conditions: [{ variable: "pv_surplus_kw", operator: ">", valueText: "0" }],
    actionType: "charge_bess",
    actionArgText: "pv_surplus_kw",
  };
}

export default function HybridEmsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project, result, ready, updateProject } = useHybridProject(projectId);
  const { lang } = usePreferences();
  const [presets, setPresets] = useState<HybridPresetsResponse | null>(null);
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false);
  const [jsonDraft, setJsonDraft] = useState("");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [visualDraft, setVisualDraft] = useState<VisualEmsRuleDraft>(() => createDefaultVisualDraft(4));
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
  const selectedActionSpec = EMS_ACTION_SPECS.find((a) => a.id === visualDraft.actionType) ?? EMS_ACTION_SPECS[0];

  function commitRuleSet(nextSet: HybridEmsRuleSet) {
    updateProject((p) => ({
      ...p,
      simulation: {
        ...p.simulation,
        dispatch_strategy: "custom_ems",
        dispatch_params: {
          ...p.simulation.dispatch_params,
          ems_rules: nextSet,
        },
      },
    }));
    setJsonDraft(JSON.stringify(nextSet, null, 2));
  }

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
    const meta = formatEmsPresetMeta(preset, lang);
    commitRuleSet(cloned);
    setEditingRuleId(null);
    setVisualDraft(createDefaultVisualDraft(cloned.rules.length + 1));
    setValidationState({
      status: "valid",
      message: tr(
        lang,
        `Preset "${meta.name}" applied (${cloned.rules.length} active rules).`,
        `Preset "${meta.name}" siap digunakan (${cloned.rules.length} aturan aktif).`,
        `プリセット「${meta.name}」を適用しました（有効ルール ${cloned.rules.length} 件）。`,
      ),
    });
  }

  function toggleRuleEnabled(ruleId: string, nextEnabled: boolean) {
    const nextRules: HybridEmsRuleItem[] = activeRuleSet.rules.map((r) =>
      r.id === ruleId ? { ...r, enabled: nextEnabled } : r,
    );
    commitRuleSet({ ...activeRuleSet, rules: nextRules });
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
    commitRuleSet(nextSet);
  }

  function handleEditRuleRow(rule: HybridEmsRuleItem) {
    const extracted = extractVisualDraftFromRule(rule);
    if (!extracted) {
      setJsonEditorOpen(true);
      setJsonDraft(JSON.stringify(activeRuleSet, null, 2));
      setValidationState({
        status: "idle",
        message: tr(
          lang,
          `Rule "${rule.id}" uses nested expressions; opened Advanced JSON Editor.`,
          `Aturan "${rule.id}" memiliki ekspresi bersarang; Editor JSON Tingkat Lanjut dibuka.`,
          `ルール「${rule.id}」はネスト条件を含むため、JSONエディタを開きました。`,
        ),
      });
      return;
    }
    setEditingRuleId(rule.id);
    setVisualDraft(extracted);
  }

  function handleDeleteRuleRow(ruleId: string) {
    const nextSet = removeEmsRuleById(activeRuleSet, ruleId);
    commitRuleSet(nextSet);
    if (editingRuleId === ruleId) {
      setEditingRuleId(null);
      setVisualDraft(createDefaultVisualDraft(nextSet.rules.length + 1));
    }
    void handleValidateCurrentRules(nextSet);
  }

  function handleSaveVisualRule() {
    const nextSet = editingRuleId
      ? updateVisualEmsRule(activeRuleSet, editingRuleId, visualDraft)
      : addVisualEmsRule(activeRuleSet, visualDraft);
    commitRuleSet(nextSet);
    setEditingRuleId(null);
    setVisualDraft(createDefaultVisualDraft(nextSet.rules.length + 1));
    void handleValidateCurrentRules(nextSet);
  }

  function handleCancelVisualEdit() {
    setEditingRuleId(null);
    setVisualDraft(createDefaultVisualDraft(activeRuleSet.rules.length + 1));
  }

  function updateVisualCondition(idx: number, patch: Partial<VisualEmsConditionClause>) {
    setVisualDraft((prev) => ({
      ...prev,
      conditions: prev.conditions.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    }));
  }

  function addVisualConditionClause() {
    setVisualDraft((prev) => ({
      ...prev,
      conditions: [
        ...prev.conditions,
        { variable: "bess_soc_fraction", operator: "<", valueText: "$params.soc_max_fraction" },
      ],
    }));
  }

  function removeVisualConditionClause(idx: number) {
    setVisualDraft((prev) => ({
      ...prev,
      conditions: prev.conditions.length > 1 ? prev.conditions.filter((_, i) => i !== idx) : prev.conditions,
    }));
  }

  async function handleValidateCurrentRules(candidateSet?: HybridEmsRuleSet) {
    const target = candidateSet ?? activeRuleSet;
    setValidationState({
      status: "checking",
      message: tr(
        lang,
        "Checking EMS rule structure and safety constraints...",
        "Memeriksa keamanan dan struktur aturan EMS...",
        "EMSルールの構造と安全制約を検証しています...",
      ),
    });
    try {
      const report = await validateHybridEmsRules(target);
      setValidationState({
        status: "valid",
        message: tr(
          lang,
          `Valid EMS rules (Schema v${report.schema_version}): ${report.enabled_rule_count} of ${report.rule_count} rules enabled and safe to execute.`,
          `Aturan EMS sah (Skema v${report.schema_version}): ${report.enabled_rule_count} dari ${report.rule_count} aturan aktif dan aman dijalankan.`,
          `EMSルール検証OK（スキーマ v${report.schema_version}）: ${report.rule_count} 件中 ${report.enabled_rule_count} 件が有効で安全に実行可能です。`,
        ),
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
        setValidationState({
          status: "error",
          message: tr(
            lang,
            "Failed to validate EMS rules.",
            "Gagal memvalidasi aturan EMS.",
            "EMSルールの検証に失敗しました。",
          ),
        });
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
        message: tr(
          lang,
          "Invalid JSON syntax. Please check missing quotes or commas.",
          "Format JSON tidak sah. Periksa tanda kutip atau koma yang kurang.",
          "JSON構文が無効です。引用符やカンマを確認してください。",
        ),
      });
      return;
    }
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as HybridEmsRuleSet).rules)) {
      setValidationState({
        status: "error",
        message: tr(
          lang,
          "EMS rule document must be a JSON object containing a 'rules' array.",
          "Dokumen aturan EMS harus berupa objek JSON yang memiliki daftar 'rules'.",
          "EMSルールドキュメントは 'rules' 配列を含むJSONオブジェクトである必要があります。",
        ),
      });
      return;
    }
    const candidate = parsed as HybridEmsRuleSet;
    commitRuleSet(candidate);
    void handleValidateCurrentRules(candidate);
  }

  const paramKeys = Object.keys(activeRuleSet.params ?? {});

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
        "Choose a built-in dispatch strategy or configure Custom Supervisory EMS Rules with templates and the visual rule builder.",
        "Pilih strategi dispatch bawaan atau atur Aturan EMS Kustom (Supervisory Controller) lewat preset dan perakit aturan visual.",
        "標準ディスパッチ戦略を選択するか、プリセットとビジュアルルールビルダーでカスタム監視EMSルールを構成します。",
      )}
      result={result}
    >
      <div className="grid-hybrid">
        <section aria-labelledby="h-ems-strat">
          <h2 id="h-ems-strat" style={{ marginTop: 0 }}>
            {tr(lang, "Dispatch Strategies", "Pilihan Strategi Dispatch", "ディスパッチ戦略の選択")}
          </h2>
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {strategies.map((s) => {
              const meta = formatEmsStrategyMeta(s, lang);
              return (
                <button
                  key={s.id}
                  type="button"
                  className="strategy-card"
                  aria-pressed={activeStrategy === s.id}
                  onClick={() => selectStrategy(s.id)}
                >
                  <div className="actions-inline" style={{ justifyContent: "space-between", marginBottom: "0.25rem" }}>
                    <strong style={{ color: "var(--navytext)" }}>{meta.name}</strong>
                    <span className="chip">{s.id}</span>
                  </div>
                  <p className="note">{meta.description}</p>
                </button>
              );
            })}
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
            <span>
              {tr(
                lang,
                "Allow electricity import from Grid during deficit",
                "Izinkan impor listrik dari jaringan Grid saat defisit",
                "電力不足時に系統（グリッド）からの受電を許可",
              )}
            </span>
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
            <span>
              {tr(
                lang,
                "Allow surplus electricity export to Grid",
                "Izinkan ekspor surplus listrik ke jaringan Grid",
                "余剰電力の系統（グリッド）への逆潮流を許可",
              )}
            </span>
          </label>

          {activeStrategy === "cycle_charging" && (
            <div className="fld">
              <label htmlFor="ems-target-soc">
                {tr(lang, "Cycle Charging Target SOC (%)", "Target SOC Pengisian Siklus (%)", "サイクル充電目標SOC (%)")}
              </label>
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
              <label htmlFor="ems-peak-limit">
                {tr(lang, "Grid Peak Load Limit (kW)", "Batas Beban Puncak Grid (kW)", "系統ピーク負荷上限 (kW)")}
              </label>
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
                  <label htmlFor="ems-tou-chg">
                    {tr(lang, "Off-Peak Charge Target (%)", "Target Charge Luar Puncak (%)", "オフピーク充電目標SOC (%)")}
                  </label>
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
                  <label htmlFor="ems-tou-dis">
                    {tr(lang, "Peak Discharge Floor (%)", "Batas Bawah Discharge Puncak (%)", "ピーク放電下限SOC (%)")}
                  </label>
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
                <legend>
                  {tr(
                    lang,
                    "Peak Tariff Hours Schedule (00:00 to 23:00)",
                    "Jadwal Jam Tarif Puncak (Peak Hours, 00:00 sampai 23:00)",
                    "ピーク料金時間帯スケジュール (00:00〜23:00)",
                  )}
                </legend>
                <p className="note" style={{ marginTop: "0.25rem" }}>
                  {tr(
                    lang,
                    "Click hour buttons to toggle peak tariff hours (battery discharge prioritized). Cannot overlap with off-peak hours.",
                    "Klik tombol jam untuk mengaktifkan atau menonaktifkan jam tarif puncak (discharge baterai diprioritaskan). Jam tidak boleh tumpang tindih dengan jam luar puncak.",
                    "時間ボタンをクリックしてピーク時間帯（蓄電池放電優先）を切り替えます。オフピーク時間帯とは重複できません。",
                  )}
                </p>
                <div
                  role="group"
                  aria-label={tr(lang, "Peak tariff hours selector", "Pemilih jam tarif puncak", "ピーク料金時間帯セレクター")}
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
                            ? tr(
                                lang,
                                `Hour ${String(hr).padStart(2, "0")}:00 is currently Off-Peak (click to move to Peak)`,
                                `Jam ${String(hr).padStart(2, "0")}:00 saat ini terdaftar sebagai Jam Luar Puncak (klik untuk memindahkan ke Jam Puncak)`,
                                `${String(hr).padStart(2, "0")}:00 は現在オフピークです（クリックでピークへ移動）`,
                              )
                            : tr(
                                lang,
                                `Toggle peak hour ${String(hr).padStart(2, "0")}:00`,
                                `Toggle jam puncak ${String(hr).padStart(2, "0")}:00`,
                                `ピーク時間帯 ${String(hr).padStart(2, "0")}:00 を切替`,
                              )
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
                  {tr(lang, "Active Peak Hours:", "Jam Puncak aktif:", "有効なピーク時間帯:")}{" "}
                  <strong>{dp.peak_hours.length > 0 ? dp.peak_hours.join(", ") : tr(lang, "None", "Tidak ada", "なし")}</strong>
                </p>
              </fieldset>

              <fieldset style={{ marginTop: "1rem" }}>
                <legend>
                  {tr(
                    lang,
                    "Off-Peak Tariff Hours Schedule (00:00 to 23:00)",
                    "Jadwal Jam Luar Puncak (Off-Peak Hours, 00:00 sampai 23:00)",
                    "オフピーク料金時間帯スケジュール (00:00〜23:00)",
                  )}
                </legend>
                <p className="note" style={{ marginTop: "0.25rem" }}>
                  {tr(
                    lang,
                    "Click hour buttons to select battery charging hours during low-tariff off-peak periods.",
                    "Klik tombol jam untuk memilih jadwal pengisian baterai saat tarif murah luar puncak.",
                    "低料金のオフピーク時間帯に蓄電池を充電する時間を選択します。",
                  )}
                </p>
                <div
                  role="group"
                  aria-label={tr(lang, "Off-peak hours selector", "Pemilih jam luar puncak", "オフピーク時間帯セレクター")}
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
                            ? tr(
                                lang,
                                `Hour ${String(hr).padStart(2, "0")}:00 is currently Peak (click to move to Off-Peak)`,
                                `Jam ${String(hr).padStart(2, "0")}:00 saat ini terdaftar sebagai Jam Puncak (klik untuk memindahkan ke Jam Luar Puncak)`,
                                `${String(hr).padStart(2, "0")}:00 は現在ピークです（クリックでオフピークへ移動）`,
                              )
                            : tr(
                                lang,
                                `Toggle off-peak hour ${String(hr).padStart(2, "0")}:00`,
                                `Toggle jam luar puncak ${String(hr).padStart(2, "0")}:00`,
                                `オフピーク時間帯 ${String(hr).padStart(2, "0")}:00 を切替`,
                              )
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
                    {tr(lang, "Active Off-Peak Hours:", "Jam Luar Puncak aktif:", "有効なオフピーク時間帯:")}{" "}
                    <strong>{dp.off_peak_hours.length > 0 ? dp.off_peak_hours.join(", ") : tr(lang, "None", "Tidak ada", "なし")}</strong>
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
                    {tr(lang, "Reset Default Hours", "Reset Jam Default", "デフォルト時間に戻す")}
                  </button>
                </div>
              </fieldset>
            </>
          )}

          {activeStrategy === "custom_ems" && (
            <div className="sec">
              <div className="card-header" style={{ marginBottom: "0.5rem" }}>
                <h3 style={{ margin: 0 }}>
                  {tr(
                    lang,
                    "1. Choose a Ready-to-Use Supervisory Rule Preset",
                    "1. Pilih Preset Aturan Supervisory Siap Pakai",
                    "1. 監視EMSルールプリセットの選択",
                  )}
                </h3>
                <span className="chip">{tr(lang, "Click to apply", "Klik untuk menerapkan", "クリックして適用")}</span>
              </div>
              <p className="note" style={{ marginBottom: "0.75rem" }}>
                {tr(
                  lang,
                  "Select a rule template matching your operating profile. All rules execute deterministically as pure data without arbitrary code execution.",
                  "Pilih salah satu paket aturan di bawah ini sesuai kebutuhan proyek Anda. Seluruh aturan dieksekusi secara deterministik tanpa eksekusi kode bebas.",
                  "プロジェクトの運用形態に合ったルールセットを選択してください。すべてのルールは純粋なデータとして決定論的に実行されます。",
                )}
              </p>

              <div style={{ display: "grid", gap: "0.625rem" }}>
                {rulePresets.map((preset) => {
                  const isCurrentPreset = activeRuleSet.name === preset.rule_set.name;
                  const meta = formatEmsPresetMeta(preset, lang);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      className="strategy-card"
                      aria-pressed={isCurrentPreset}
                      onClick={() => applyRulePreset(preset)}
                    >
                      <div className="actions-inline" style={{ justifyContent: "space-between", marginBottom: "0.25rem" }}>
                        <strong style={{ color: "var(--navytext)" }}>{meta.name}</strong>
                        <span className="chip tabular-nums">
                          {preset.rule_set.rules.length} {tr(lang, "rules", "aturan", "ルール")}
                        </span>
                      </div>
                      <p className="note">{meta.description}</p>
                    </button>
                  );
                })}
              </div>

              {activeRuleSet.params && Object.keys(activeRuleSet.params).length > 0 && (
                <div className="sec">
                  <h3 style={{ marginBottom: "0.5rem" }}>
                    {tr(
                      lang,
                      "2. Adjust Rule Thresholds (Preset Default vs User Input)",
                      "2. Sesuaikan Ambang Batas Aturan (Default Preset vs Input Pengguna)",
                      "2. ルール閾値パラメータの調整（プリセット初期値／ユーザー入力）",
                    )}
                  </h3>
                  <div className="grid-2">
                    {Object.entries(activeRuleSet.params).map(([key, rawVal]) => {
                      const meta = formatEmsParamMeta(key, lang);
                      const displayVal = meta.isPercent ? Math.round(Number(rawVal) * 100) : Number(rawVal);
                      const inputId = `ems-param-${key}`;
                      const presetDefault = matchedPreset?.rule_set.params?.[key];
                      const isPresetDefault =
                        typeof presetDefault === "number" && Math.abs(Number(rawVal) - presetDefault) < 1e-9;
                      const sourceLabel = isPresetDefault
                        ? tr(lang, "Preset Default", "Default Preset", "プリセット初期値")
                        : tr(lang, "User Input", "Input Pengguna", "ユーザー入力");
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
                  <h3 style={{ margin: 0 }}>
                    {tr(
                      lang,
                      "3. EMS Rule Priority Table",
                      "3. Tabel Urutan Prioritas Aturan EMS",
                      "3. EMSルール優先度テーブル",
                    )}
                  </h3>
                  <button
                    type="button"
                    className="btn ghost btn-sm"
                    disabled={validationState.status === "checking"}
                    onClick={() => void handleValidateCurrentRules()}
                  >
                    {validationState.status === "checking"
                      ? tr(lang, "Checking Rules...", "Memeriksa Aturan...", "検証中...")
                      : tr(lang, "Validate Rule Safety", "Periksa Keamanan Aturan", "ルールの安全性を検証")}
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

                <div
                  className="tw"
                  tabIndex={0}
                  role="region"
                  aria-label={tr(
                    lang,
                    "Custom EMS rules priority table",
                    "Tabel daftar aturan EMS kustom",
                    "カスタムEMSルール一覧テーブル",
                  )}
                >
                  <table className="sens-main">
                    <caption>
                      {tr(
                        lang,
                        `Active rules in "${activeRuleSet.name}" (sorted by lowest priority number first)`,
                        `Daftar aturan aktif pada paket "${activeRuleSet.name}" (diurutkan dari angka prioritas terkecil)`,
                        `ルールセット「${activeRuleSet.name}」の登録ルール（優先度数値の小さい順）`,
                      )}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">{tr(lang, "Enabled", "Aktif", "有効")}</th>
                        <th scope="col">{tr(lang, "Priority", "Prioritas", "優先度")}</th>
                        <th scope="col">{tr(lang, "Rule ID", "ID Aturan", "ルールID")}</th>
                        <th scope="col">{tr(lang, "Condition (When Active)", "Syarat Kondisi (Kapan Aktif)", "発動条件 (When)")}</th>
                        <th scope="col">{tr(lang, "Action Decision", "Keputusan Aksi", "制御アクション (Then)")}</th>
                        <th scope="col">{tr(lang, "Manage", "Kelola", "操作")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeRuleSet.rules.length === 0 ? (
                        <tr>
                          <td colSpan={6} style={{ textAlign: "left" }}>
                            {tr(
                              lang,
                              "No custom EMS rules registered yet. Select a preset above or add a rule using the Visual Rule Builder below.",
                              "Belum ada aturan EMS kustom yang terdaftar. Pilih salah satu preset di atas atau tambahkan aturan lewat Perakit Aturan Visual di bawah.",
                              "カスタムEMSルールが登録されていません。上のプリセットを選択するか、下のビジュアルルールビルダーから追加してください。",
                            )}
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
                                    aria-label={tr(
                                      lang,
                                      `Enable rule ${rule.id}`,
                                      `Aktifkan aturan ${rule.id}`,
                                      `ルール ${rule.id} を有効化`,
                                    )}
                                    onChange={(e) => toggleRuleEnabled(rule.id, e.target.checked)}
                                  />
                                </td>
                                <td className="tabular-nums">{rule.priority}</td>
                                <th scope="row">
                                  <code>{rule.id}</code>
                                </th>
                                <td style={{ textAlign: "left" }}>
                                  {formatEmsConditionSummary(rule.when, activeRuleSet.params, lang)}
                                </td>
                                <td style={{ textAlign: "left" }}>
                                  <strong>{formatEmsActionSummary(rule.then, activeRuleSet.params, lang)}</strong>
                                </td>
                                <td>
                                  <div className="actions-inline" style={{ justifyContent: "flex-end" }}>
                                    <button
                                      type="button"
                                      className="btn ghost btn-sm"
                                      onClick={() => handleEditRuleRow(rule)}
                                    >
                                      {tr(lang, "Edit", "Ubah", "編集")}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn ghost btn-sm"
                                      onClick={() => handleDeleteRuleRow(rule.id)}
                                    >
                                      {tr(lang, "Delete", "Hapus", "削除")}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="sec card" style={{ background: "var(--surface-subtle)" }}>
                <div className="card-header" style={{ marginBottom: "0.5rem" }}>
                  <h3 style={{ margin: 0 }}>
                    {editingRuleId
                      ? tr(
                          lang,
                          `4. Visual Rule Builder (Editing: ${editingRuleId})`,
                          `4. Perakit Aturan Visual (Mengubah: ${editingRuleId})`,
                          `4. ビジュアルルールビルダー（編集中: ${editingRuleId}）`,
                        )
                      : tr(
                          lang,
                          "4. Visual Rule Builder (Add or Edit Rules Without JSON)",
                          "4. Perakit Aturan Visual (Tambah atau Ubah Aturan Tanpa JSON)",
                          "4. ビジュアルルールビルダー（JSON不要でルールを追加・編集）",
                        )}
                  </h3>
                  <span className="chip">{tr(lang, "Whitelist Guarded", "Daftar Putih Aman", "ホワイトリスト保護")}</span>
                </div>
                <p className="note" style={{ marginBottom: "0.75rem" }}>
                  {tr(
                    lang,
                    "Compose condition clauses and target actions from whitelisted plant variables. Rules with lower priority numbers execute first.",
                    "Susun syarat kondisi dan keputusan aksi dari variabel pembangkit resmi. Aturan dengan angka prioritas lebih kecil dijalankan lebih dulu.",
                    "許可されたプラント変数から条件とアクションを組み立てます。優先度の数値が小さいルールから順に評価されます。",
                  )}
                </p>

                <div className="grid-2">
                  <div className="fld" style={{ marginTop: 0 }}>
                    <label htmlFor="vb-rule-id">
                      {tr(lang, "Rule ID", "ID Aturan", "ルールID")}
                    </label>
                    <input
                      id="vb-rule-id"
                      type="text"
                      value={visualDraft.id}
                      onChange={(e) => setVisualDraft((prev) => ({ ...prev, id: e.target.value }))}
                    />
                  </div>
                  <div className="fld" style={{ marginTop: 0 }}>
                    <label htmlFor="vb-rule-priority">
                      {tr(lang, "Priority Order (1 = highest)", "Angka Prioritas (1 = tertinggi)", "優先度（1 = 最優先）")}
                    </label>
                    <input
                      id="vb-rule-priority"
                      type="number"
                      className="tabular-nums"
                      min={1}
                      max={999}
                      value={visualDraft.priority}
                      onChange={(e) =>
                        setVisualDraft((prev) => ({
                          ...prev,
                          priority: Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 10,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="fld" style={{ marginTop: "0.75rem" }}>
                  <div className="actions-inline" style={{ justifyContent: "space-between" }}>
                    <label htmlFor="vb-combinator">
                      {tr(lang, "When Condition Logic", "Logika Penggabung Syarat (When)", "条件結合ロジック (When)")}
                    </label>
                    <select
                      id="vb-combinator"
                      value={visualDraft.combinator}
                      onChange={(e) =>
                        setVisualDraft((prev) => ({
                          ...prev,
                          combinator: e.target.value as VisualConditionCombinator,
                        }))
                      }
                      style={{ width: "auto", minWidth: "220px" }}
                    >
                      <option value="all">
                        {tr(lang, "ALL conditions must match (AND)", "SEMUA syarat terpenuhi (DAN)", "すべての条件を満たす (AND)")}
                      </option>
                      <option value="any">
                        {tr(lang, "ANY condition matches (OR)", "SALAH SATU syarat terpenuhi (ATAU)", "いずれかの条件を満たす (OR)")}
                      </option>
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.5rem" }}>
                  {visualDraft.conditions.map((clause, idx) => {
                    const varSpec = EMS_VARIABLE_SPECS.find((v) => v.id === clause.variable);
                    return (
                      <div
                        key={`clause-${idx}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1.4fr 1fr 1.2fr auto",
                          gap: "0.5rem",
                          alignItems: "end",
                        }}
                      >
                        <div className="fld" style={{ marginTop: 0 }}>
                          <label htmlFor={`vb-var-${idx}`}>
                            {tr(lang, `Variable #${idx + 1}`, `Variabel #${idx + 1}`, `変数 #${idx + 1}`)}
                          </label>
                          <select
                            id={`vb-var-${idx}`}
                            value={clause.variable}
                            onChange={(e) => {
                              const nextVar = e.target.value;
                              const nextSpec = EMS_VARIABLE_SPECS.find((v) => v.id === nextVar);
                              const defaultVal =
                                nextSpec?.valueType === "bool"
                                  ? "true"
                                  : nextSpec?.isFraction
                                    ? "0.30"
                                    : nextVar === "hour_of_day"
                                      ? "17, 18, 19, 20, 21"
                                      : "0";
                              const defaultOp: VisualConditionOperator =
                                nextSpec?.valueType === "bool" || nextSpec?.valueType === "str"
                                  ? "=="
                                  : nextVar === "hour_of_day"
                                    ? "in"
                                    : ">";
                              updateVisualCondition(idx, {
                                variable: nextVar,
                                operator: defaultOp,
                                valueText: defaultVal,
                              });
                            }}
                          >
                            {EMS_VARIABLE_SPECS.map((v) => (
                              <option key={v.id} value={v.id}>
                                {tr(lang, v.labelEn, v.labelId, v.labelJa)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="fld" style={{ marginTop: 0 }}>
                          <label htmlFor={`vb-op-${idx}`}>
                            {tr(lang, "Operator", "Operator", "演算子")}
                          </label>
                          <select
                            id={`vb-op-${idx}`}
                            value={clause.operator}
                            onChange={(e) =>
                              updateVisualCondition(idx, { operator: e.target.value as VisualConditionOperator })
                            }
                          >
                            {OPERATOR_CHOICES.map((opItem) => (
                              <option key={opItem.op} value={opItem.op}>
                                {tr(lang, opItem.labelEn, opItem.labelId, opItem.labelJa)}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="fld" style={{ marginTop: 0 }}>
                          <label htmlFor={`vb-val-${idx}`}>
                            {tr(lang, "Threshold / Value", "Nilai / Ambang", "比較値・閾値")}
                          </label>
                          {varSpec?.valueType === "bool" ? (
                            <select
                              id={`vb-val-${idx}`}
                              value={clause.valueText.toLowerCase() === "false" ? "false" : "true"}
                              onChange={(e) => updateVisualCondition(idx, { valueText: e.target.value })}
                            >
                              <option value="true">{tr(lang, "Yes (true)", "Ya (true)", "はい (true)")}</option>
                              <option value="false">{tr(lang, "No (false)", "Tidak (false)", "いいえ (false)")}</option>
                            </select>
                          ) : (
                            <input
                              id={`vb-val-${idx}`}
                              type="text"
                              className="tabular-nums"
                              list={`vb-param-list-${idx}`}
                              value={clause.valueText}
                              onChange={(e) => updateVisualCondition(idx, { valueText: e.target.value })}
                              placeholder={
                                clause.operator === "in" || clause.operator === "not_in"
                                  ? "17, 18, 19, 20"
                                  : varSpec?.isFraction
                                    ? "0.30 / $params.reserve_soc_fraction"
                                    : "0"
                              }
                            />
                          )}
                          <datalist id={`vb-param-list-${idx}`}>
                            {paramKeys.map((pk) => (
                              <option key={pk} value={`$params.${pk}`} />
                            ))}
                          </datalist>
                        </div>

                        <div>
                          <button
                            type="button"
                            className="btn ghost btn-sm"
                            disabled={visualDraft.conditions.length <= 1}
                            onClick={() => removeVisualConditionClause(idx)}
                          >
                            {tr(lang, "Remove", "Hapus", "削除")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="actions-inline" style={{ marginTop: "0.5rem" }}>
                  <button type="button" className="btn ghost btn-sm" onClick={addVisualConditionClause}>
                    {tr(lang, "+ Add Condition Clause", "+ Tambah Baris Syarat", "+ 条件行を追加")}
                  </button>
                </div>

                <div className="grid-2" style={{ marginTop: "0.75rem" }}>
                  <div className="fld" style={{ marginTop: 0 }}>
                    <label htmlFor="vb-action-type">
                      {tr(lang, "Then Action Decision", "Keputusan Aksi (Then)", "実行アクション (Then)")}
                    </label>
                    <select
                      id="vb-action-type"
                      value={visualDraft.actionType}
                      onChange={(e) => {
                        const nextAct = e.target.value as VisualActionKind;
                        const spec = EMS_ACTION_SPECS.find((a) => a.id === nextAct) ?? EMS_ACTION_SPECS[0];
                        setVisualDraft((prev) => ({
                          ...prev,
                          actionType: nextAct,
                          actionArgText: spec.defaultArg,
                        }));
                      }}
                    >
                      {EMS_ACTION_SPECS.map((act) => (
                        <option key={act.id} value={act.id}>
                          {tr(lang, act.labelEn, act.labelId, act.labelJa)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedActionSpec.argKind !== "none" && (
                    <div className="fld" style={{ marginTop: 0 }}>
                      <label htmlFor="vb-action-arg">
                        {selectedActionSpec.argKind === "limit"
                          ? tr(lang, "Power Limit Source / kW", "Sumber Batas Daya / Nilai kW", "電力上限ソース / kW値")
                          : tr(lang, "Target Power Source / kW", "Sumber Target Daya / Nilai kW", "目標出力ソース / kW値")}
                      </label>
                      <input
                        id="vb-action-arg"
                        type="text"
                        className="tabular-nums"
                        list="vb-action-sources"
                        value={visualDraft.actionArgText}
                        onChange={(e) => setVisualDraft((prev) => ({ ...prev, actionArgText: e.target.value }))}
                      />
                      <datalist id="vb-action-sources">
                        <option value="pv_surplus_kw" />
                        <option value="net_load_kw" />
                        <option value="local_load_kw" />
                        <option value="bess_max_charge_kw" />
                        <option value="bess_max_discharge_kw" />
                        <option value="biomass_available_kw" />
                        {paramKeys.map((pk) => (
                          <option key={pk} value={`$params.${pk}`} />
                        ))}
                      </datalist>
                    </div>
                  )}
                </div>

                <div className="actions-inline" style={{ marginTop: "0.75rem" }}>
                  <button type="button" className="btn primary btn-sm" onClick={handleSaveVisualRule}>
                    {editingRuleId
                      ? tr(lang, "Save Rule Changes", "Simpan Perubahan Aturan", "ルールの変更を保存")
                      : tr(lang, "Add Rule to Priority Table", "Tambahkan Aturan ke Tabel", "ルールをテーブルに追加")}
                  </button>
                  {editingRuleId && (
                    <button type="button" className="btn ghost btn-sm" onClick={handleCancelVisualEdit}>
                      {tr(lang, "Cancel Edit", "Batal Mengubah", "編集をキャンセル")}
                    </button>
                  )}
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
                  {jsonEditorOpen
                    ? tr(
                        lang,
                        "Hide Advanced JSON Editor",
                        "Sembunyikan Editor JSON Tingkat Lanjut",
                        "高度なJSONエディタを閉じる",
                      )
                    : tr(
                        lang,
                        "Open Advanced JSON Editor (Optional)",
                        "Buka Editor JSON Tingkat Lanjut (Opsional)",
                        "高度なJSONエディタを開く（任意）",
                      )}
                </button>

                {jsonEditorOpen && (
                  <div className="fld" style={{ marginTop: "0.75rem" }}>
                    <label htmlFor="ems-json-editor">
                      {tr(
                        lang,
                        "EMS v0.1 JSON Schema Document",
                        "Dokumen Skema JSON EMS v0.1",
                        "EMS v0.1 JSONスキーマドキュメント",
                      )}
                    </label>
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
                        {tr(lang, "Apply & Validate JSON", "Terapkan & Validasi JSON", "JSONを適用して検証")}
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
