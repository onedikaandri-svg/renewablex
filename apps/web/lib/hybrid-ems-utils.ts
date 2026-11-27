import type {
  DispatchStrategyId,
  HybridEmsRuleAction,
  HybridEmsRuleItem,
  HybridEmsRulePreset,
  HybridEmsRuleSet,
  HybridPresetsResponse,
} from "./hybrid-types";
import { type LangCode, tr } from "./preferences";

export type VisualConditionCombinator = "all" | "any";
export type VisualConditionOperator = "==" | "!=" | ">" | ">=" | "<" | "<=" | "in" | "not_in";
export type VisualActionKind =
  | "charge_bess"
  | "discharge_bess"
  | "hold_bess"
  | "start_biomass"
  | "stop_biomass"
  | "set_biomass_target"
  | "start_and_target_biomass"
  | "curtail_pv"
  | "enforce_export_limit"
  | "follow_export_target";

export interface VisualEmsConditionClause {
  variable: string;
  operator: VisualConditionOperator;
  valueText: string;
}

export interface VisualEmsRuleDraft {
  id: string;
  priority: number;
  enabled: boolean;
  combinator: VisualConditionCombinator;
  conditions: VisualEmsConditionClause[];
  actionType: VisualActionKind;
  actionArgText: string;
}

export interface EmsVariableSpec {
  id: string;
  valueType: "float" | "int" | "bool" | "str";
  isFraction?: boolean;
  labelEn: string;
  labelId: string;
  labelJa: string;
}

export const EMS_VARIABLE_SPECS: readonly EmsVariableSpec[] = [
  {
    id: "pv_surplus_kw",
    valueType: "float",
    labelEn: "PV Surplus (kW)",
    labelId: "Surplus Surya (kW)",
    labelJa: "太陽光余剰電力 (kW)",
  },
  {
    id: "net_load_kw",
    valueType: "float",
    labelEn: "Net Load after PV (kW)",
    labelId: "Beban Bersih setelah PV (kW)",
    labelJa: "PV控除後純負荷 (kW)",
  },
  {
    id: "local_load_kw",
    valueType: "float",
    labelEn: "Local Load (kW)",
    labelId: "Beban Listrik (kW)",
    labelJa: "構内電力負荷 (kW)",
  },
  {
    id: "pv_available_kw",
    valueType: "float",
    labelEn: "Available PV Power (kW)",
    labelId: "Daya PV Tersedia (kW)",
    labelJa: "利用可能PV出力 (kW)",
  },
  {
    id: "bess_soc_fraction",
    valueType: "float",
    isFraction: true,
    labelEn: "Battery SOC",
    labelId: "SOC Baterai",
    labelJa: "蓄電池SOC",
  },
  {
    id: "bess_max_charge_kw",
    valueType: "float",
    labelEn: "BESS Max Charge (kW)",
    labelId: "Daya Charge Maks BESS (kW)",
    labelJa: "BESS最大充電電力 (kW)",
  },
  {
    id: "bess_max_discharge_kw",
    valueType: "float",
    labelEn: "BESS Max Discharge (kW)",
    labelId: "Daya Discharge Maks BESS (kW)",
    labelJa: "BESS最大放電電力 (kW)",
  },
  {
    id: "biomass_available_kw",
    valueType: "float",
    labelEn: "Available Biomass Power (kW)",
    labelId: "Daya Biomass Tersedia (kW)",
    labelJa: "利用可能バイオマス出力 (kW)",
  },
  {
    id: "hour_of_day",
    valueType: "int",
    labelEn: "Hour of Day (0 to 23)",
    labelId: "Jam Operasi (0 sampai 23)",
    labelJa: "時間帯 (0〜23時)",
  },
  {
    id: "month",
    valueType: "int",
    labelEn: "Month (1 to 12)",
    labelId: "Bulan (1 sampai 12)",
    labelJa: "月 (1〜12月)",
  },
  {
    id: "grid_connected",
    valueType: "bool",
    labelEn: "Grid Connected Status",
    labelId: "Status Grid Terhubung",
    labelJa: "系統連系状態",
  },
  {
    id: "biomass_can_start",
    valueType: "bool",
    labelEn: "Biomass Ready to Start",
    labelId: "Biomass Siap Menyala",
    labelJa: "バイオマス起動可能",
  },
  {
    id: "biomass_can_stop",
    valueType: "bool",
    labelEn: "Biomass Ready to Stop",
    labelId: "Biomass Siap Berhenti",
    labelJa: "バイオマス停止可能",
  },
  {
    id: "biomass_status",
    valueType: "str",
    labelEn: "Biomass Operating Status",
    labelId: "Status Operasi Biomass",
    labelJa: "バイオマス運転状態",
  },
];

export interface EmsActionSpec {
  id: VisualActionKind;
  argKind: "none" | "limit" | "target";
  defaultArg: string;
  labelEn: string;
  labelId: string;
  labelJa: string;
}

export const EMS_ACTION_SPECS: readonly EmsActionSpec[] = [
  {
    id: "charge_bess",
    argKind: "limit",
    defaultArg: "pv_surplus_kw",
    labelEn: "Charge BESS",
    labelId: "Isi Baterai (Charge BESS)",
    labelJa: "蓄電池を充電 (Charge BESS)",
  },
  {
    id: "discharge_bess",
    argKind: "limit",
    defaultArg: "net_load_kw",
    labelEn: "Discharge BESS",
    labelId: "Kuras Baterai (Discharge BESS)",
    labelJa: "蓄電池を放電 (Discharge BESS)",
  },
  {
    id: "hold_bess",
    argKind: "none",
    defaultArg: "",
    labelEn: "Hold BESS",
    labelId: "Tahan Baterai (Hold)",
    labelJa: "蓄電池待機 (Hold)",
  },
  {
    id: "start_and_target_biomass",
    argKind: "target",
    defaultArg: "net_load_kw",
    labelEn: "Start Biomass & Set Target",
    labelId: "Nyalakan & Atur Target Daya Biomass",
    labelJa: "バイオマス起動・目標出力設定",
  },
  {
    id: "start_biomass",
    argKind: "none",
    defaultArg: "",
    labelEn: "Start Biomass Generator",
    labelId: "Nyalakan Pembangkit Biomass",
    labelJa: "バイオマス発電機を起動",
  },
  {
    id: "stop_biomass",
    argKind: "none",
    defaultArg: "",
    labelEn: "Stop Biomass Generator",
    labelId: "Matikan Pembangkit Biomass",
    labelJa: "バイオマス発電機を停止",
  },
  {
    id: "set_biomass_target",
    argKind: "target",
    defaultArg: "net_load_kw",
    labelEn: "Set Biomass Power Target",
    labelId: "Atur Target Daya Biomass",
    labelJa: "バイオマス目標出力を設定",
  },
  {
    id: "curtail_pv",
    argKind: "limit",
    defaultArg: "local_load_kw",
    labelEn: "Curtail PV Output",
    labelId: "Batasi Keluaran PV (Curtail)",
    labelJa: "PV出力抑制 (Curtail)",
  },
  {
    id: "enforce_export_limit",
    argKind: "limit",
    defaultArg: "$params.grid_export_limit_kw",
    labelEn: "Enforce Grid Export Limit",
    labelId: "Terapkan Batas Ekspor Grid",
    labelJa: "系統逆潮流上限を適用",
  },
  {
    id: "follow_export_target",
    argKind: "target",
    defaultArg: "grid_export_target_kw",
    labelEn: "Follow Grid Export Target",
    labelId: "Ikuti Target Ekspor Grid",
    labelJa: "系統逆潮流目標に追従",
  },
];

const PARAM_META: Record<
  string,
  { labelEn: string; labelId: string; labelJa: string; isPercent: boolean; unit: string }
> = {
  reserve_soc_fraction: {
    labelEn: "Battery Reserve SOC Threshold",
    labelId: "Batas Cadangan SOC Baterai",
    labelJa: "蓄電池予備SOC下限",
    isPercent: true,
    unit: "%",
  },
  soc_min_fraction: {
    labelEn: "Minimum Battery SOC Floor",
    labelId: "Batas Minimum SOC Baterai",
    labelJa: "蓄電池最小SOC下限",
    isPercent: true,
    unit: "%",
  },
  soc_max_fraction: {
    labelEn: "Maximum Charge SOC Ceiling",
    labelId: "Batas Maksimum Pengisian SOC",
    labelJa: "蓄電池最大充電SOC上限",
    isPercent: true,
    unit: "%",
  },
  peak_reserve_soc: {
    labelEn: "Peak Hours Reserve SOC Floor",
    labelId: "Batas Bawah SOC Jam Sibuk",
    labelJa: "ピーク時間帯SOC下限",
    isPercent: true,
    unit: "%",
  },
  daytime_hold_soc: {
    labelEn: "Daytime Hold SOC Target",
    labelId: "Target Tahan SOC Siang Hari",
    labelJa: "日中保持SOC目標",
    isPercent: true,
    unit: "%",
  },
  grid_export_limit_kw: {
    labelEn: "Grid Export Power Limit",
    labelId: "Batas Daya Ekspor Jaringan",
    labelJa: "系統逆潮流上限電力",
    isPercent: false,
    unit: "kW",
  },
};

const STRATEGY_JA: Record<DispatchStrategyId, { name: string; description: string }> = {
  self_consumption: {
    name: "自家消費優先 (Self-Consumption)",
    description: "PV余剰電力を優先して蓄電池へ充電し、不足時は蓄電池、次にバイオマスで負荷を賄います。",
  },
  load_following: {
    name: "負荷追従 (Load Following)",
    description: "PV控除後の残余負荷を埋めるように蓄電池とバイオマスの出力を調整します。",
  },
  cycle_charging: {
    name: "サイクル充電 (Cycle Charging)",
    description: "バイオマス等の稼働時に、目標SOCに達するまで蓄電池への充電も同時に行います。",
  },
  peak_shaving: {
    name: "ピークカット (Peak Shaving)",
    description: "設定したピーク上限を超える負荷を蓄電池とバイオマスで抑制します。",
  },
  time_of_use_arbitrage: {
    name: "時間帯別料金裁定 (Time-of-Use)",
    description: "オフピーク時間帯やPV余剰時に充電し、ピーク料金時間帯に優先放電します。",
  },
  custom_ems: {
    name: "カスタム監視EMSルール (Supervisory Controller)",
    description:
      "優先度付きの条件・アクションルール（SOC、時間帯、PV余剰、純負荷、逆潮流上限）を安全監視付きで実行します。",
  },
};

const PRESET_JA: Record<string, { name: string; description: string }> = {
  peak_cut_daytime: {
    name: "ピークカット＆日中太陽光バッファ (Peak-Cut)",
    description:
      "日中のPV余剰を蓄電池に蓄え、系統電力ピークを抑えながら予備SOCを確保します。",
  },
  islanded_reserve_protection: {
    name: "オフグリッド予備容量保護 (Islanded Reserve)",
    description:
      "自立マイクログリッドの安定性を優先し、PV余剰充電、最小SOC保護、高負荷時のバイオマス起動を行います。",
  },
  tou_industrial_hybrid: {
    name: "産業用夕方ピーク支援 (Evening Peak Support)",
    description:
      "日中の太陽光で蓄電池を満たし、夕方〜夜間のピーク時間帯 (17:00〜22:00) に放電とバイオマス支援を優先します。",
  },
};

export function formatEmsStrategyMeta(
  strategy: HybridPresetsResponse["dispatch_strategies"][number],
  lang: LangCode,
): { name: string; description: string } {
  if (lang === "id") {
    return { name: strategy.name_id, description: strategy.description_id };
  }
  if (lang === "ja") {
    const ja = STRATEGY_JA[strategy.id];
    if (ja) return ja;
  }
  return { name: strategy.name_en, description: strategy.description_en };
}

export function formatEmsPresetMeta(
  preset: HybridEmsRulePreset,
  lang: LangCode,
): { name: string; description: string } {
  if (lang === "id") {
    return { name: preset.name_id, description: preset.description_id };
  }
  if (lang === "ja") {
    const ja = PRESET_JA[preset.id];
    if (ja) return ja;
  }
  return { name: preset.name_en, description: preset.description_en };
}

export function formatEmsParamMeta(
  key: string,
  lang: LangCode,
): { label: string; isPercent: boolean; unit: string } {
  const entry = PARAM_META[key];
  if (!entry) {
    return { label: key, isPercent: false, unit: "" };
  }
  return {
    label: tr(lang, entry.labelEn, entry.labelId, entry.labelJa),
    isPercent: entry.isPercent,
    unit: entry.unit,
  };
}

export function formatEmsVarLabel(varName: string, lang: LangCode): string {
  const spec = EMS_VARIABLE_SPECS.find((v) => v.id === varName);
  if (!spec) return varName;
  return tr(lang, spec.labelEn, spec.labelId, spec.labelJa);
}

export function formatEmsActionLabel(actionName: string, lang: LangCode): string {
  const spec = EMS_ACTION_SPECS.find((a) => a.id === actionName);
  if (!spec) return actionName;
  return tr(lang, spec.labelEn, spec.labelId, spec.labelJa);
}

export function formatEmsConditionSummary(
  node: Record<string, unknown>,
  params: Record<string, number> | undefined,
  lang: LangCode,
): string {
  if (Array.isArray(node.all)) {
    const joiner = tr(lang, " AND ", " DAN ", " かつ ");
    return (node.all as Array<Record<string, unknown>>)
      .map((child) => formatEmsConditionSummary(child, params, lang))
      .join(joiner);
  }
  if (Array.isArray(node.any)) {
    const joiner = tr(lang, " OR ", " ATAU ", " または ");
    return (node.any as Array<Record<string, unknown>>)
      .map((child) => formatEmsConditionSummary(child, params, lang))
      .join(joiner);
  }
  if (typeof node.not === "object" && node.not !== null) {
    const prefix = tr(lang, "NOT (", "BUKAN (", "否定 (");
    return `${prefix}${formatEmsConditionSummary(node.not as Record<string, unknown>, params, lang)})`;
  }

  const rawVar = String(node.var ?? "");
  const varLabel = formatEmsVarLabel(rawVar, lang);
  const op = String(node.op ?? "==");
  const rawVal = node.value;
  let valText = String(rawVal ?? "");

  if (typeof rawVal === "string" && rawVal.startsWith("$params.")) {
    const key = rawVal.slice("$params.".length);
    const paramMeta = formatEmsParamMeta(key, lang);
    const numVal = params?.[key];
    if (typeof numVal === "number" && PARAM_META[key]) {
      valText = paramMeta.isPercent ? `${Math.round(numVal * 100)}%` : `${numVal} ${paramMeta.unit}`;
    } else {
      valText = key;
    }
  } else if (Array.isArray(rawVal)) {
    valText = rawVal
      .map((v) => (rawVar === "hour_of_day" ? `${String(v).padStart(2, "0")}:00` : String(v)))
      .join(", ");
  } else if (typeof rawVal === "boolean") {
    valText = rawVal ? tr(lang, "Yes", "Ya", "はい") : tr(lang, "No", "Tidak", "いいえ");
  } else if (typeof rawVal === "number" && rawVar === "bess_soc_fraction" && rawVal <= 1) {
    valText = `${Math.round(rawVal * 100)}%`;
  }

  const opLabel =
    op === "in"
      ? tr(lang, "in", "pada", "∈")
      : op === "not_in"
        ? tr(lang, "not in", "di luar", "∉")
        : op;
  return `${varLabel} ${opLabel} ${valText}`;
}

export function formatEmsActionSummary(
  actions: HybridEmsRuleAction[],
  params: Record<string, number> | undefined,
  lang: LangCode,
): string {
  return actions
    .map((a) => {
      const base = formatEmsActionLabel(a.action, lang);
      const arg = a.limit ?? a.target;
      if (arg === undefined) return base;
      if (typeof arg === "string" && arg.startsWith("$params.")) {
        const key = arg.slice("$params.".length);
        const meta = formatEmsParamMeta(key, lang);
        const numVal = params?.[key];
        if (typeof numVal === "number" && PARAM_META[key]) {
          return `${base} (${meta.isPercent ? `${Math.round(numVal * 100)}%` : `${numVal} ${meta.unit}`})`;
        }
      }
      if (typeof arg === "string" && EMS_VARIABLE_SPECS.some((v) => v.id === arg)) {
        const byWord = tr(lang, "up to", "sebesar", "上限:");
        return `${base} (${byWord} ${formatEmsVarLabel(arg, lang)})`;
      }
      if (typeof arg === "number") {
        return `${base} (${arg} kW)`;
      }
      return `${base} (${String(arg)})`;
    })
    .join(" + ");
}

function parseConditionValue(
  variable: string,
  operator: VisualConditionOperator,
  valueText: string,
): unknown {
  const trimmed = valueText.trim();
  if (trimmed.startsWith("$params.")) {
    return trimmed;
  }
  const spec = EMS_VARIABLE_SPECS.find((v) => v.id === variable);
  const valType = spec?.valueType ?? "float";

  if (operator === "in" || operator === "not_in") {
    const parts = trimmed
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (valType === "int" || valType === "float") {
      return parts.map((p) => {
        const n = Number(p);
        return Number.isFinite(n) ? (valType === "int" ? Math.trunc(n) : n) : 0;
      });
    }
    return parts;
  }

  if (valType === "bool") {
    return trimmed.toLowerCase() === "true" || trimmed === "1" || trimmed.toLowerCase() === "ya";
  }
  if (valType === "str") {
    return trimmed || "off";
  }
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return 0;
  if (valType === "int") return Math.trunc(num);
  // Jika pengguna mengetik angka persen > 1 pada variabel SOC (misalnya 30 untuk 30%), konversi ke fraksi 0.30
  if (spec?.isFraction && num > 1 && num <= 100) {
    return Math.round((num / 100) * 10000) / 10000;
  }
  return num;
}

function parseActionArgument(argText: string, fallback: string): string | number {
  const trimmed = argText.trim() || fallback;
  if (trimmed.startsWith("$params.") || EMS_VARIABLE_SPECS.some((v) => v.id === trimmed)) {
    return trimmed;
  }
  const num = Number(trimmed);
  if (Number.isFinite(num) && num >= 0) {
    return num;
  }
  return fallback;
}

export function buildEmsRuleFromVisualDraft(draft: VisualEmsRuleDraft): HybridEmsRuleItem {
  const cleanId = draft.id.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "r_custom_rule";
  const cleanPriority = Number.isFinite(draft.priority) ? Math.max(1, Math.trunc(draft.priority)) : 25;
  const validClauses =
    draft.conditions.length > 0
      ? draft.conditions
      : [{ variable: "pv_surplus_kw", operator: ">" as const, valueText: "0" }];

  const leafNodes = validClauses.map((clause) => ({
    var: clause.variable,
    op: clause.operator,
    value: parseConditionValue(clause.variable, clause.operator, clause.valueText),
  }));

  const whenNode: Record<string, unknown> =
    leafNodes.length === 1 ? leafNodes[0] : { [draft.combinator]: leafNodes };

  let thenActions: HybridEmsRuleAction[];
  if (draft.actionType === "start_and_target_biomass") {
    const targetVal = parseActionArgument(draft.actionArgText, "net_load_kw");
    thenActions = [
      { action: "start_biomass" },
      { action: "set_biomass_target", target: targetVal },
    ];
  } else {
    const spec = EMS_ACTION_SPECS.find((a) => a.id === draft.actionType) ?? EMS_ACTION_SPECS[0];
    if (spec.argKind === "none") {
      thenActions = [{ action: spec.id }];
    } else if (spec.argKind === "limit") {
      thenActions = [
        {
          action: spec.id,
          limit: parseActionArgument(draft.actionArgText, spec.defaultArg),
        },
      ];
    } else {
      thenActions = [
        {
          action: spec.id,
          target: parseActionArgument(draft.actionArgText, spec.defaultArg),
        },
      ];
    }
  }

  return {
    id: cleanId,
    enabled: draft.enabled,
    priority: cleanPriority,
    mode_scope: ["*"],
    when: whenNode,
    then: thenActions,
  };
}

function extractLeafClause(node: Record<string, unknown>): VisualEmsConditionClause | null {
  if (typeof node.var !== "string" || typeof node.op !== "string") return null;
  const rawVal = node.value;
  let valueText = "";
  if (Array.isArray(rawVal)) {
    valueText = rawVal.join(", ");
  } else if (rawVal !== undefined && rawVal !== null) {
    valueText = String(rawVal);
  }
  return {
    variable: node.var,
    operator: node.op as VisualConditionOperator,
    valueText,
  };
}

export function extractVisualDraftFromRule(rule: HybridEmsRuleItem): VisualEmsRuleDraft | null {
  let combinator: VisualConditionCombinator = "all";
  let conditions: VisualEmsConditionClause[] = [];

  if (Array.isArray(rule.when.all)) {
    combinator = "all";
    for (const child of rule.when.all) {
      if (typeof child === "object" && child !== null) {
        const leaf = extractLeafClause(child as Record<string, unknown>);
        if (!leaf) return null;
        conditions.push(leaf);
      }
    }
  } else if (Array.isArray(rule.when.any)) {
    combinator = "any";
    for (const child of rule.when.any) {
      if (typeof child === "object" && child !== null) {
        const leaf = extractLeafClause(child as Record<string, unknown>);
        if (!leaf) return null;
        conditions.push(leaf);
      }
    }
  } else {
    const single = extractLeafClause(rule.when);
    if (!single) return null;
    conditions = [single];
  }

  if (conditions.length === 0) return null;

  let actionType: VisualActionKind = "charge_bess";
  let actionArgText = "pv_surplus_kw";

  if (
    rule.then.length === 2 &&
    rule.then[0].action === "start_biomass" &&
    rule.then[1].action === "set_biomass_target"
  ) {
    actionType = "start_and_target_biomass";
    actionArgText = String(rule.then[1].target ?? "net_load_kw");
  } else if (rule.then.length === 1) {
    const act = rule.then[0];
    const matched = EMS_ACTION_SPECS.find((s) => s.id === act.action);
    if (!matched) return null;
    actionType = matched.id;
    const rawArg = act.limit ?? act.target;
    actionArgText = rawArg !== undefined ? String(rawArg) : matched.defaultArg;
  } else {
    return null;
  }

  return {
    id: rule.id,
    priority: rule.priority,
    enabled: rule.enabled !== false,
    combinator,
    conditions,
    actionType,
    actionArgText,
  };
}

export function addVisualEmsRule(
  ruleSet: HybridEmsRuleSet,
  draft: VisualEmsRuleDraft,
): HybridEmsRuleSet {
  const built = buildEmsRuleFromVisualDraft(draft);
  let uniqueId = built.id;
  let suffix = 2;
  const existingIds = new Set(ruleSet.rules.map((r) => r.id));
  while (existingIds.has(uniqueId)) {
    uniqueId = `${built.id}_${suffix}`;
    suffix += 1;
  }
  return {
    ...ruleSet,
    rules: [...ruleSet.rules, { ...built, id: uniqueId }],
  };
}

export function updateVisualEmsRule(
  ruleSet: HybridEmsRuleSet,
  originalId: string,
  draft: VisualEmsRuleDraft,
): HybridEmsRuleSet {
  const built = buildEmsRuleFromVisualDraft(draft);
  const otherIds = new Set(ruleSet.rules.filter((r) => r.id !== originalId).map((r) => r.id));
  const finalId = otherIds.has(built.id) ? originalId : built.id;
  return {
    ...ruleSet,
    rules: ruleSet.rules.map((r) =>
      r.id === originalId
        ? {
            ...built,
            id: finalId,
            mode_scope: r.mode_scope && r.mode_scope.length > 0 ? r.mode_scope : ["*"],
          }
        : r,
    ),
  };
}

export function removeEmsRuleById(ruleSet: HybridEmsRuleSet, ruleId: string): HybridEmsRuleSet {
  return {
    ...ruleSet,
    rules: ruleSet.rules.filter((r) => r.id !== ruleId),
  };
}

export interface EmsRuleSummaryRow {
  id: string;
  priority: number;
  enabled: boolean;
  conditionText: string;
  actionText: string;
}

export interface ActiveEmsRuleSetSummary {
  name: string;
  schemaVersion: string;
  enabledCount: number;
  totalCount: number;
  paramsSummary: Array<{ key: string; label: string; valueText: string }>;
  rows: EmsRuleSummaryRow[];
}

export function summarizeActiveEmsRuleSet(
  ruleSet: HybridEmsRuleSet | null | undefined,
  lang: LangCode,
): ActiveEmsRuleSetSummary {
  if (!ruleSet) {
    return {
      name: "custom_ems",
      schemaVersion: "0.1",
      enabledCount: 0,
      totalCount: 0,
      paramsSummary: [],
      rows: [],
    };
  }
  const sorted = [...ruleSet.rules].sort((a, b) => a.priority - b.priority);
  const rows: EmsRuleSummaryRow[] = sorted.map((rule) => ({
    id: rule.id,
    priority: rule.priority,
    enabled: rule.enabled !== false,
    conditionText: formatEmsConditionSummary(rule.when, ruleSet.params, lang),
    actionText: formatEmsActionSummary(rule.then, ruleSet.params, lang),
  }));
  const paramsSummary = Object.entries(ruleSet.params ?? {}).map(([key, val]) => {
    const meta = formatEmsParamMeta(key, lang);
    const num = Number(val);
    const valueText = meta.isPercent ? `${Math.round(num * 100)}%` : `${num} ${meta.unit}`.trim();
    return { key, label: meta.label, valueText };
  });
  return {
    name: ruleSet.name,
    schemaVersion: ruleSet.ems_schema_version || "0.1",
    enabledCount: rows.filter((r) => r.enabled).length,
    totalCount: rows.length,
    paramsSummary,
    rows,
  };
}
