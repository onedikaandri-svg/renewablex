import { describe, expect, it } from "vitest";
import { buildHybridSimulatePayload } from "./hybrid-api";
import { buildBlankProject, buildSampleProject } from "./hybrid-storage";
import {
  addTopologyNode,
  computeSchematicBounds,
  connectTopologyNodes,
  deriveDefaultTopology,
  disconnectNodeFromBus,
  getEdgeGeometry,
  getNodeIdForKind,
  getNodeRect,
  moveTopologyNode,
  removeTopologyNode,
  resetTopologyLayout,
  resolveProjectTopology,
  serializeSchematicSvgWithLightTheme,
  setTopologyViewport,
  validateSystemTopology,
} from "./hybrid-topology";
import type { HybridProjectConfig } from "./hybrid-types";

describe("hybrid-topology: kesetaraan kanvas vs JSON", () => {
  it("menghasilkan payload simulasi 100% identik untuk 4 skenario kombinasi dan tanpa kebocoran topology", () => {
    // 1. Skenario PV + Beban
    const manual1 = buildBlankProject("Uji 1");
    const canvas1 = buildBlankProject("Uji 1");
    const payload1Canvas = buildHybridSimulatePayload(canvas1);
    const payload1Manual = buildHybridSimulatePayload(manual1);
    expect(payload1Canvas).toEqual(payload1Manual);
    expect((payload1Canvas as Record<string, unknown>).topology).toBeUndefined();

    // 2. Skenario PV + BESS + Beban
    const manual2 = buildBlankProject("Uji 2");
    manual2.components.bess.enabled = true;
    manual2.components.bess.nominal_capacity_kwh = 400;
    manual2.components.bess.max_charge_kw = 200;

    let canvas2 = buildBlankProject("Uji 2");
    canvas2 = addTopologyNode(canvas2, "bess", { autoConnect: false });
    const conn2 = connectTopologyNodes(canvas2, getNodeIdForKind("bess"), getNodeIdForKind("ac_bus"));
    expect(conn2.error).toBeUndefined();
    canvas2 = {
      ...conn2.project,
      components: {
        ...conn2.project.components,
        bess: { ...conn2.project.components.bess, nominal_capacity_kwh: 400, max_charge_kw: 200 },
      },
    };
    expect(buildHybridSimulatePayload(canvas2)).toEqual(buildHybridSimulatePayload(manual2));

    // 3. Skenario PV + BESS + Biomass + Beban (off-grid penuh)
    const manual3 = buildSampleProject("uji-3");
    let canvas3 = buildBlankProject("Pabrik Hybrid Cikarang [REAL DATA]", "uji-3");
    canvas3 = {
      ...canvas3,
      components: {
        ...canvas3.components,
        pv: { ...manual3.components.pv },
        bess: { ...manual3.components.bess, enabled: false },
        biomass: { ...manual3.components.biomass, enabled: false },
      },
    };
    canvas3 = addTopologyNode(canvas3, "bess", { autoConnect: true });
    canvas3 = addTopologyNode(canvas3, "biomass", { autoConnect: true });
    expect(buildHybridSimulatePayload(canvas3)).toEqual(buildHybridSimulatePayload(manual3));

    // 4. Skenario PV + BESS + Biomass + Grid + Beban (on-grid)
    const manual4 = buildSampleProject("uji-4");
    manual4.simulation.dispatch_params.allow_grid_import = true;
    let canvas4 = buildSampleProject("uji-4");
    canvas4 = addTopologyNode(canvas4, "grid", { autoConnect: true });
    expect(buildHybridSimulatePayload(canvas4)).toEqual(buildHybridSimulatePayload(manual4));
  });

  it("invariansi tata letak: geser koordinat, zoom, pan, dan reset tata letak tidak mengubah payload", () => {
    const base = buildSampleProject("invarian");
    const basePayload = buildHybridSimulatePayload(base);

    let modified = moveTopologyNode(base, getNodeIdForKind("pv"), 120, 80);
    modified = moveTopologyNode(modified, getNodeIdForKind("bess"), 105, 215);
    modified = setTopologyViewport(modified, { panX: 45, panY: -20, zoom: 1.4 });
    expect(buildHybridSimulatePayload(modified)).toEqual(basePayload);

    const reset = resetTopologyLayout(modified);
    expect(buildHybridSimulatePayload(reset)).toEqual(basePayload);
    expect(resolveProjectTopology(reset).viewport).toEqual({ panX: 0, panY: 0, zoom: 1 });
  });
});

describe("hybrid-topology: validasi dan keputusan 2a / 3a", () => {
  it("keputusan 2a: node opsional yang belum terhubung memberi peringatan non-blokir dan dianggap nonaktif", () => {
    let p = buildBlankProject("Uji 2a");
    p = addTopologyNode(p, "bess", { autoConnect: false });
    expect(p.components.bess.enabled).toBe(false);

    const val = validateSystemTopology(p);
    expect(val.valid).toBe(true);
    expect(val.warnings.some((w) => w.code === "disconnected_optional_node")).toBe(true);
  });

  it("mempertahankan parameter BESS saat kabelnya diputus lalu disambung kembali", () => {
    let p = buildSampleProject("uji-keep");
    p.components.bess.nominal_capacity_kwh = 950;
    p = disconnectNodeFromBus(p, getNodeIdForKind("bess"));
    expect(p.components.bess.enabled).toBe(false);
    expect(p.components.bess.nominal_capacity_kwh).toBe(950);

    const reconnected = connectTopologyNodes(p, getNodeIdForKind("bess"), getNodeIdForKind("ac_bus"));
    expect(reconnected.error).toBeUndefined();
    expect(reconnected.project.components.bess.enabled).toBe(true);
    expect(reconnected.project.components.bess.nominal_capacity_kwh).toBe(950);
  });

  it("keputusan 3a: komponen wajib terkunci dari hapus, tetapi memutus kabelnya memicu error pemblokir", () => {
    const p = buildSampleProject("uji-3a");
    for (const kind of ["ac_bus", "pv", "load"] as const) {
      const rem = removeTopologyNode(p, getNodeIdForKind(kind));
      expect(rem.removed).toBe(false);
    }

    const noPv = disconnectNodeFromBus(p, getNodeIdForKind("pv"));
    expect(noPv.components.pv.enabled).toBe(false);
    const valPv = validateSystemTopology(noPv);
    expect(valPv.valid).toBe(false);
    expect(valPv.errors.some((e) => e.code === "pv_not_connected")).toBe(true);

    const noLoad = disconnectNodeFromBus(p, getNodeIdForKind("load"));
    const valLoad = validateSystemTopology(noLoad);
    expect(valLoad.valid).toBe(false);
    expect(valLoad.errors.some((e) => e.code === "load_not_connected")).toBe(true);
  });

  it("menolak koneksi ilegal antar komponen non-bus dan duplikat kabel", () => {
    const p = buildSampleProject("uji-illegal");
    const directNonBus = connectTopologyNodes(p, getNodeIdForKind("pv"), getNodeIdForKind("bess"));
    expect(directNonBus.error?.code).toBe("invalid_edge_connection");

    const selfLoop = connectTopologyNodes(p, getNodeIdForKind("pv"), getNodeIdForKind("pv"));
    expect(selfLoop.error?.code).toBe("invalid_edge_connection");

    const duplicate = connectTopologyNodes(p, getNodeIdForKind("pv"), getNodeIdForKind("ac_bus"));
    expect(duplicate.error?.code).toBe("invalid_edge_connection");
  });

  it("sinkron dua arah dengan perubahan izin grid di Halaman 5 (EMS) dan kompatibel dengan proyek Tahap 5", () => {
    const legacy = buildSampleProject("legacy-v05") as HybridProjectConfig;
    delete legacy.topology;
    legacy.schemaVersion = "0.5";
    legacy.simulation.dispatch_params.allow_grid_import = true;

    const resolved = resolveProjectTopology(legacy);
    expect(resolved.nodes.some((n) => n.kind === "grid")).toBe(true);
    expect(resolved.edges.some((e) => e.target === getNodeIdForKind("grid"))).toBe(true);

    const offGridAgain = {
      ...legacy,
      topology: resolved,
      simulation: {
        ...legacy.simulation,
        dispatch_params: {
          ...legacy.simulation.dispatch_params,
          allow_grid_import: false,
          allow_grid_export: false,
        },
      },
    };
    const resolvedOff = resolveProjectTopology(offGridAgain);
    expect(resolvedOff.edges.some((e) => e.target === getNodeIdForKind("grid"))).toBe(false);
  });
});

describe("hybrid-topology: geometri SVG dan serialisasi tema terang untuk PDF Tahap 7", () => {
  it("menghitung bounding box, geometri edge, dan mengganti token CSS saat serialisasi SVG", () => {
    const p = buildSampleProject("svg-test");
    const topo = deriveDefaultTopology(p);
    const bounds = computeSchematicBounds(topo.nodes);
    expect(bounds.width).toBeGreaterThanOrEqual(680);
    expect(bounds.height).toBeGreaterThanOrEqual(340);

    const pvNode = topo.nodes.find((n) => n.kind === "pv")!;
    const busNode = topo.nodes.find((n) => n.kind === "ac_bus")!;
    expect(getNodeRect(pvNode).width).toBe(176);
    const geo = getEdgeGeometry(pvNode, busNode);
    expect(geo.pathD.startsWith("M ")).toBe(true);

    const fakeAttrMap = new Map<string, string>([
      ["viewBox", "0 0 680 340"],
      ["fill", "var(--surface)"],
      ["stroke", "var(--series-pv)"],
    ]);
    const fakeEl = {
      tagName: "svg",
      children: [],
      textContent: null,
      outerHTML: "",
      cloneNode: () => fakeEl,
      getAttribute: (k: string) => fakeAttrMap.get(k) ?? null,
      setAttribute: (k: string, v: string) => {
        fakeAttrMap.set(k, v);
      },
    };
    // Pastikan serialisasi outerHTML jalan dan mengganti var(--...) ke hex tema terang
    Object.defineProperty(fakeEl, "outerHTML", {
      get: () =>
        `<svg xmlns="${fakeAttrMap.get("xmlns")}" width="${fakeAttrMap.get("width")}" height="${fakeAttrMap.get("height")}" fill="${fakeAttrMap.get("fill")}" stroke="${fakeAttrMap.get("stroke")}"></svg>`,
    });
    const prevSerializer = globalThis.XMLSerializer;
    // @ts-expect-error mock minimal tanpa DOM penuh di node test environment
    globalThis.XMLSerializer = undefined;
    try {
      const out = serializeSchematicSvgWithLightTheme(fakeEl as unknown as SVGSVGElement);
      expect(out).toContain('fill="#FFFFFF"');
      expect(out).toContain('stroke="#533AFD"');
      expect(out).toContain('width="680"');
    } finally {
      globalThis.XMLSerializer = prevSerializer;
    }
  });
});
