import { describe, expect, it } from "vitest";
import {
  addVisualEmsRule,
  buildEmsRuleFromVisualDraft,
  extractVisualDraftFromRule,
  formatEmsActionSummary,
  formatEmsConditionSummary,
  formatEmsParamMeta,
  formatEmsPresetMeta,
  removeEmsRuleById,
  summarizeActiveEmsRuleSet,
  updateVisualEmsRule,
  type VisualEmsRuleDraft,
} from "./hybrid-ems-utils";
import type { HybridEmsRulePreset, HybridEmsRuleSet } from "./hybrid-types";

const SAMPLE_RULE_SET: HybridEmsRuleSet = {
  ems_schema_version: "0.1",
  name: "peak_cut_daytime",
  description: "Aturan supervisory peak-cut dengan proteksi cadangan SOC baterai.",
  params: {
    reserve_soc_fraction: 0.3,
    soc_max_fraction: 0.95,
    grid_export_limit_kw: 2000,
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
          { var: "pv_surplus_kw", op: ">", value: 0 },
          { var: "bess_soc_fraction", op: "<", value: "$params.soc_max_fraction" },
        ],
      },
      then: [{ action: "charge_bess", limit: "pv_surplus_kw" }],
    },
  ],
};

describe("hybrid-ems-utils", () => {
  it("formats EMS condition, action, parameter, and preset summaries across EN, ID, and JA without em or en dashes", () => {
    const condEn = formatEmsConditionSummary(SAMPLE_RULE_SET.rules[1].when, SAMPLE_RULE_SET.params, "en");
    const condId = formatEmsConditionSummary(SAMPLE_RULE_SET.rules[1].when, SAMPLE_RULE_SET.params, "id");
    const condJa = formatEmsConditionSummary(SAMPLE_RULE_SET.rules[1].when, SAMPLE_RULE_SET.params, "ja");

    expect(condEn).toContain("AND");
    expect(condEn).toContain("95%");
    expect(condId).toContain("DAN");
    expect(condId).toContain("95%");
    expect(condJa).toContain("かつ");
    expect(condJa).toContain("95%");

    const actEn = formatEmsActionSummary(SAMPLE_RULE_SET.rules[0].then, SAMPLE_RULE_SET.params, "en");
    const actId = formatEmsActionSummary(SAMPLE_RULE_SET.rules[0].then, SAMPLE_RULE_SET.params, "id");
    const actJa = formatEmsActionSummary(SAMPLE_RULE_SET.rules[0].then, SAMPLE_RULE_SET.params, "ja");

    expect(actEn).toContain("2000 kW");
    expect(actId).toContain("2000 kW");
    expect(actJa).toContain("2000 kW");

    const paramEn = formatEmsParamMeta("reserve_soc_fraction", "en");
    const paramId = formatEmsParamMeta("reserve_soc_fraction", "id");
    const paramJa = formatEmsParamMeta("reserve_soc_fraction", "ja");
    expect(paramEn.isPercent).toBe(true);
    expect(paramId.label).toContain("SOC");
    expect(paramJa.label).toContain("SOC");

    const samplePreset: HybridEmsRulePreset = {
      id: "peak_cut_daytime",
      name_id: "Pemangkasan Puncak",
      name_en: "Peak-Cut",
      description_id: "Deskripsi ID",
      description_en: "Description EN",
      rule_set: SAMPLE_RULE_SET,
    };
    const presetJa = formatEmsPresetMeta(samplePreset, "ja");
    expect(presetJa.name).toContain("ピークカット");

    for (const s of [condEn, condId, condJa, actEn, actId, actJa, presetJa.name, presetJa.description]) {
      expect(s).not.toContain("\u2014");
      expect(s).not.toContain("\u2013");
    }
  });

  it("builds, adds, updates, extracts, and deletes visual EMS rules cleanly", () => {
    const draft: VisualEmsRuleDraft = {
      id: "r_custom_night_biomass",
      priority: 15,
      enabled: true,
      combinator: "all",
      conditions: [
        { variable: "net_load_kw", operator: ">", valueText: "25" },
        { variable: "biomass_can_start", operator: "==", valueText: "true" },
      ],
      actionType: "start_and_target_biomass",
      actionArgText: "net_load_kw",
    };

    const built = buildEmsRuleFromVisualDraft(draft);
    expect(built.id).toBe("r_custom_night_biomass");
    expect(built.priority).toBe(15);
    expect(built.then).toEqual([
      { action: "start_biomass" },
      { action: "set_biomass_target", target: "net_load_kw" },
    ]);

    const afterAdd = addVisualEmsRule(SAMPLE_RULE_SET, draft);
    expect(afterAdd.rules).toHaveLength(3);

    const extracted = extractVisualDraftFromRule(built);
    expect(extracted).not.toBeNull();
    expect(extracted!.actionType).toBe("start_and_target_biomass");
    expect(extracted!.conditions).toHaveLength(2);

    const updatedDraft: VisualEmsRuleDraft = {
      ...draft,
      priority: 18,
      conditions: [{ variable: "hour_of_day", operator: "in", valueText: "17, 18, 19, 20" }],
      actionType: "discharge_bess",
      actionArgText: "net_load_kw",
    };
    const afterUpdate = updateVisualEmsRule(afterAdd, "r_custom_night_biomass", updatedDraft);
    const updatedRule = afterUpdate.rules.find((r) => r.id === "r_custom_night_biomass");
    expect(updatedRule?.priority).toBe(18);
    expect(updatedRule?.when).toEqual({
      var: "hour_of_day",
      op: "in",
      value: [17, 18, 19, 20],
    });
    expect(updatedRule?.then).toEqual([{ action: "discharge_bess", limit: "net_load_kw" }]);

    const afterRemove = removeEmsRuleById(afterUpdate, "r_custom_night_biomass");
    expect(afterRemove.rules).toHaveLength(2);
  });

  it("summarizes active EMS rule set for dashboard and print report", () => {
    const summaryId = summarizeActiveEmsRuleSet(SAMPLE_RULE_SET, "id");
    const summaryEn = summarizeActiveEmsRuleSet(SAMPLE_RULE_SET, "en");
    const summaryJa = summarizeActiveEmsRuleSet(SAMPLE_RULE_SET, "ja");

    expect(summaryId.name).toBe("peak_cut_daytime");
    expect(summaryId.enabledCount).toBe(2);
    expect(summaryId.totalCount).toBe(2);
    expect(summaryId.rows).toHaveLength(2);
    expect(summaryId.rows[0].id).toBe("r_enforce_peak_cut_limit");
    expect(summaryEn.rows[1].conditionText).toContain("AND");
    expect(summaryJa.rows[1].conditionText).toContain("かつ");
  });
});
