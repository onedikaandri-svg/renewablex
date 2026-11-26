import { describe, expect, it } from "vitest";
import { COMPONENT_ICON_PATHS } from "@/components/Icons";
import type { TopologyNodeKind } from "@/lib/hybrid-types";

const ALL_KINDS: TopologyNodeKind[] = [
  "ac_bus",
  "pv",
  "bess",
  "biomass",
  "diesel",
  "load",
  "grid",
];

describe("Icons: kelengkapan ikon komponen energi", () => {
  it("menyediakan path SVG valid untuk seluruh 7 jenis node topologi", () => {
    expect(Object.keys(COMPONENT_ICON_PATHS).sort()).toEqual([...ALL_KINDS].sort());
    for (const kind of ALL_KINDS) {
      const paths = COMPONENT_ICON_PATHS[kind];
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThanOrEqual(1);
      for (const d of paths) {
        expect(d.trim().startsWith("M")).toBe(true);
      }
    }
  });
});
