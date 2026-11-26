import type {
  HybridProjectConfig,
  HybridSystemTopology,
  TopologyEdge,
  TopologyEdgeFlowType,
  TopologyIssue,
  TopologyNode,
  TopologyNodeKind,
  TopologyValidationResult,
  TopologyViewport,
} from "@/lib/hybrid-types";

export const GRID_SIZE = 20;
export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 1.6;
export const ZOOM_STEP = 0.2;

export const DEFAULT_VIEWPORT: TopologyViewport = {
  panX: 0,
  panY: 0,
  zoom: 1,
};

export const NODE_DIMENSIONS: Record<TopologyNodeKind, { width: number; height: number }> = {
  ac_bus: { width: 128, height: 96 },
  pv: { width: 176, height: 76 },
  bess: { width: 176, height: 76 },
  biomass: { width: 176, height: 76 },
  load: { width: 176, height: 76 },
  grid: { width: 176, height: 76 },
};

export const DEFAULT_NODE_POSITIONS: Record<TopologyNodeKind, { x: number; y: number }> = {
  pv: { x: 40, y: 40 },
  bess: { x: 40, y: 160 },
  biomass: { x: 40, y: 280 },
  ac_bus: { x: 360, y: 160 },
  load: { x: 620, y: 80 },
  grid: { x: 620, y: 220 },
};

export const LOCKED_REQUIRED_KINDS = new Set<TopologyNodeKind>(["ac_bus", "pv", "load"]);

const NODE_IDS: Record<TopologyNodeKind, string> = {
  ac_bus: "node-ac-bus",
  pv: "node-pv",
  bess: "node-bess",
  biomass: "node-biomass",
  load: "node-load",
  grid: "node-grid",
};

const LIGHT_THEME_TOKENS: Record<string, string> = {
  "--bg": "#FFFFFF",
  "--surface": "#FFFFFF",
  "--surface-subtle": "#F8FAFC",
  "--text": "#0B1F3A",
  "--ink": "#0B1F3A",
  "--muted": "#5A687D",
  "--navy": "#061B31",
  "--navytext": "#061B31",
  "--ink-strong": "#061B31",
  "--onnavy": "#FFFFFF",
  "--accent": "#533AFD",
  "--brand": "#533AFD",
  "--accent-soft": "#8E5CFF",
  "--brand-soft": "#8E5CFF",
  "--secondary": "#B9B9F9",
  "--tertiary": "#E5EDF5",
  "--border": "#E5EDF5",
  "--field": "#6B7A90",
  "--field-border": "#6B7A90",
  "--success": "#15803D",
  "--positive": "#15803D",
  "--successbg": "#F0FDF4",
  "--errbg": "#FEF2F2",
  "--errtext": "#B42318",
  "--negative": "#B42318",
  "--warnbg": "#FFFBEB",
  "--warntext": "#92400E",
  "--warning": "#92400E",
  "--series-pv": "#533AFD",
  "--series-bess": "#0369A1",
  "--series-biomass": "#B45309",
  "--series-load": "#061B31",
  "--series-grid": "#15803D",
  "--series-unmet": "#B42318",
};

export function snapToGrid(value: number): number {
  const snapped = Math.round(value / GRID_SIZE) * GRID_SIZE;
  return snapped === 0 ? 0 : snapped;
}

export function isRequiredNodeKind(kind: TopologyNodeKind): boolean {
  return LOCKED_REQUIRED_KINDS.has(kind);
}

export function getNodeIdForKind(kind: TopologyNodeKind): string {
  return NODE_IDS[kind];
}

export function flowTypeForKind(kind: TopologyNodeKind): TopologyEdgeFlowType {
  switch (kind) {
    case "pv":
      return "dc_ac_generation";
    case "bess":
      return "bidirectional_storage";
    case "biomass":
      return "ac_generation";
    case "load":
      return "ac_load";
    case "grid":
    case "ac_bus":
      return "bidirectional_grid";
  }
}

function makeEdgeId(kind: TopologyNodeKind): string {
  return `edge-${kind}-bus`;
}

function isEdgeConnecting(edge: TopologyEdge, aId: string, bId: string): boolean {
  return (edge.source === aId && edge.target === bId) || (edge.source === bId && edge.target === aId);
}

function cloneTopology(topology: HybridSystemTopology): HybridSystemTopology {
  return {
    version: "1.0",
    viewport: {
      panX: Number.isFinite(topology.viewport?.panX) ? topology.viewport.panX : 0,
      panY: Number.isFinite(topology.viewport?.panY) ? topology.viewport.panY : 0,
      zoom: Number.isFinite(topology.viewport?.zoom)
        ? Math.min(Math.max(topology.viewport.zoom, MIN_ZOOM), MAX_ZOOM)
        : 1,
    },
    nodes: topology.nodes.map((n) => ({ ...n })),
    edges: topology.edges.map((e) => ({ ...e })),
  };
}

export function deriveDefaultTopology(project: HybridProjectConfig): HybridSystemTopology {
  const nodes: TopologyNode[] = [
    { id: NODE_IDS.pv, kind: "pv", ...DEFAULT_NODE_POSITIONS.pv },
    { id: NODE_IDS.ac_bus, kind: "ac_bus", ...DEFAULT_NODE_POSITIONS.ac_bus },
    { id: NODE_IDS.load, kind: "load", ...DEFAULT_NODE_POSITIONS.load },
  ];
  const edges: TopologyEdge[] = [];

  if (project.components.pv.enabled) {
    edges.push({
      id: makeEdgeId("pv"),
      source: NODE_IDS.pv,
      target: NODE_IDS.ac_bus,
      flowType: "dc_ac_generation",
    });
  }

  edges.push({
    id: makeEdgeId("load"),
    source: NODE_IDS.ac_bus,
    target: NODE_IDS.load,
    flowType: "ac_load",
  });

  if (project.components.bess.enabled) {
    nodes.push({ id: NODE_IDS.bess, kind: "bess", ...DEFAULT_NODE_POSITIONS.bess });
    edges.push({
      id: makeEdgeId("bess"),
      source: NODE_IDS.bess,
      target: NODE_IDS.ac_bus,
      flowType: "bidirectional_storage",
    });
  }

  if (project.components.biomass.enabled) {
    nodes.push({ id: NODE_IDS.biomass, kind: "biomass", ...DEFAULT_NODE_POSITIONS.biomass });
    edges.push({
      id: makeEdgeId("biomass"),
      source: NODE_IDS.biomass,
      target: NODE_IDS.ac_bus,
      flowType: "ac_generation",
    });
  }

  const gridActive =
    project.simulation.dispatch_params.allow_grid_import ||
    project.simulation.dispatch_params.allow_grid_export;
  if (gridActive) {
    nodes.push({ id: NODE_IDS.grid, kind: "grid", ...DEFAULT_NODE_POSITIONS.grid });
    edges.push({
      id: makeEdgeId("grid"),
      source: NODE_IDS.ac_bus,
      target: NODE_IDS.grid,
      flowType: "bidirectional_grid",
    });
  }

  return {
    version: "1.0",
    viewport: { ...DEFAULT_VIEWPORT },
    nodes,
    edges,
  };
}

/**
 * Menyelesaikan topologi proyek saat ini (mendukung kompatibilitas mundur proyek Tahap 5
 * dan sinkronisasi perubahan izin grid dari Halaman 5 EMS).
 */
export function resolveProjectTopology(project: HybridProjectConfig): HybridSystemTopology {
  if (!project.topology || !Array.isArray(project.topology.nodes) || !Array.isArray(project.topology.edges)) {
    return deriveDefaultTopology(project);
  }

  const topo = cloneTopology(project.topology);
  const acBus = topo.nodes.find((n) => n.kind === "ac_bus");
  let gridNode = topo.nodes.find((n) => n.kind === "grid");
  const gridEnabled =
    project.simulation.dispatch_params.allow_grid_import ||
    project.simulation.dispatch_params.allow_grid_export;

  if (gridEnabled) {
    if (!gridNode) {
      gridNode = { id: NODE_IDS.grid, kind: "grid", ...DEFAULT_NODE_POSITIONS.grid };
      topo.nodes.push(gridNode);
    }
    if (acBus && !topo.edges.some((e) => isEdgeConnecting(e, gridNode!.id, acBus.id))) {
      topo.edges.push({
        id: makeEdgeId("grid"),
        source: acBus.id,
        target: gridNode.id,
        flowType: "bidirectional_grid",
      });
    }
  } else if (gridNode && acBus) {
    topo.edges = topo.edges.filter((e) => !isEdgeConnecting(e, gridNode!.id, acBus.id));
  }

  return topo;
}

export function isKindConnectedToBus(topology: HybridSystemTopology, kind: TopologyNodeKind): boolean {
  if (kind === "ac_bus") return topology.nodes.some((n) => n.kind === "ac_bus");
  const acBus = topology.nodes.find((n) => n.kind === "ac_bus");
  const node = topology.nodes.find((n) => n.kind === kind);
  if (!acBus || !node) return false;
  return topology.edges.some((e) => isEdgeConnecting(e, node.id, acBus.id));
}

export function syncProjectFromTopology(
  project: HybridProjectConfig,
  topology: HybridSystemTopology,
): HybridProjectConfig {
  const cleanTopology = cloneTopology(topology);
  const pvConnected = isKindConnectedToBus(cleanTopology, "pv");
  const bessConnected = isKindConnectedToBus(cleanTopology, "bess");
  const biomassConnected = isKindConnectedToBus(cleanTopology, "biomass");
  const gridConnected = isKindConnectedToBus(cleanTopology, "grid");

  const prevGridImport = project.simulation.dispatch_params.allow_grid_import;
  const prevGridExport = project.simulation.dispatch_params.allow_grid_export;

  return {
    ...project,
    schemaVersion: "0.6",
    topology: cleanTopology,
    components: {
      ...project.components,
      pv: {
        ...project.components.pv,
        enabled: pvConnected,
      },
      bess: {
        ...project.components.bess,
        enabled: bessConnected,
      },
      biomass: {
        ...project.components.biomass,
        enabled: biomassConnected,
      },
    },
    simulation: {
      ...project.simulation,
      dispatch_params: {
        ...project.simulation.dispatch_params,
        allow_grid_import: gridConnected ? (prevGridImport || !prevGridExport) : false,
        allow_grid_export: gridConnected ? prevGridExport : false,
      },
    },
  };
}

export function addTopologyNode(
  project: HybridProjectConfig,
  kind: TopologyNodeKind,
  options?: { autoConnect?: boolean; x?: number; y?: number },
): HybridProjectConfig {
  const topo = resolveProjectTopology(project);
  if (topo.nodes.some((n) => n.kind === kind)) {
    return project;
  }

  const pos = DEFAULT_NODE_POSITIONS[kind];
  const node: TopologyNode = {
    id: NODE_IDS[kind],
    kind,
    x: snapToGrid(options?.x ?? pos.x),
    y: snapToGrid(options?.y ?? pos.y),
  };
  topo.nodes.push(node);

  if (options?.autoConnect && kind !== "ac_bus") {
    const acBus = topo.nodes.find((n) => n.kind === "ac_bus");
    if (acBus) {
      const targetIsSink = kind === "load" || kind === "grid";
      topo.edges.push({
        id: makeEdgeId(kind),
        source: targetIsSink ? acBus.id : node.id,
        target: targetIsSink ? node.id : acBus.id,
        flowType: flowTypeForKind(kind),
      });
    }
  }

  return syncProjectFromTopology(project, topo);
}

export function removeTopologyNode(
  project: HybridProjectConfig,
  nodeId: string,
): { project: HybridProjectConfig; removed: boolean; reason?: string } {
  const topo = resolveProjectTopology(project);
  const target = topo.nodes.find((n) => n.id === nodeId);
  if (!target) {
    return { project, removed: false, reason: "Komponen tidak ditemukan di kanvas." };
  }
  if (isRequiredNodeKind(target.kind)) {
    return {
      project,
      removed: false,
      reason: "Komponen wajib (AC Bus, Solar PV, dan Beban) dikunci dan tidak dapat dihapus.",
    };
  }

  topo.nodes = topo.nodes.filter((n) => n.id !== nodeId);
  topo.edges = topo.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
  return {
    project: syncProjectFromTopology(project, topo),
    removed: true,
  };
}

export function moveTopologyNode(
  project: HybridProjectConfig,
  nodeId: string,
  x: number,
  y: number,
): HybridProjectConfig {
  const topo = resolveProjectTopology(project);
  const clampedX = snapToGrid(Math.min(Math.max(x, -200), 1200));
  const clampedY = snapToGrid(Math.min(Math.max(y, -100), 800));
  topo.nodes = topo.nodes.map((n) =>
    n.id === nodeId ? { ...n, x: clampedX, y: clampedY } : n,
  );
  return {
    ...project,
    schemaVersion: "0.6",
    topology: topo,
  };
}

export function connectTopologyNodes(
  project: HybridProjectConfig,
  sourceId: string,
  targetId: string,
): { project: HybridProjectConfig; error?: TopologyIssue } {
  const topo = resolveProjectTopology(project);
  const srcNode = topo.nodes.find((n) => n.id === sourceId);
  const tgtNode = topo.nodes.find((n) => n.id === targetId);

  if (!srcNode || !tgtNode) {
    return {
      project,
      error: {
        code: "invalid_edge_connection",
        severity: "error",
        messageId: "Salah satu komponen koneksi tidak ditemukan di kanvas.",
        messageEn: "One of the connection nodes does not exist.",
      },
    };
  }

  if (srcNode.id === tgtNode.id) {
    return {
      project,
      error: {
        code: "invalid_edge_connection",
        severity: "error",
        nodeId: srcNode.id,
        messageId: "Tidak dapat menghubungkan komponen ke dirinya sendiri.",
        messageEn: "Cannot connect a node to itself.",
      },
    };
  }

  if ((srcNode.kind === "ac_bus") === (tgtNode.kind === "ac_bus")) {
    return {
      project,
      error: {
        code: "invalid_edge_connection",
        severity: "error",
        messageId: "Semua komponen harus terhubung ke AC Bus, bukan langsung antar komponen.",
        messageEn: "All components must connect to AC Bus directly.",
      },
    };
  }

  const acBus = srcNode.kind === "ac_bus" ? srcNode : tgtNode;
  const compNode = srcNode.kind === "ac_bus" ? tgtNode : srcNode;

  if (topo.edges.some((e) => isEdgeConnecting(e, acBus.id, compNode.id))) {
    return {
      project,
      error: {
        code: "invalid_edge_connection",
        severity: "error",
        nodeId: compNode.id,
        messageId: "Koneksi komponen ini ke AC Bus sudah terpasang.",
        messageEn: "This component is already connected to AC Bus.",
      },
    };
  }

  const targetIsSink = compNode.kind === "load" || compNode.kind === "grid";
  topo.edges.push({
    id: makeEdgeId(compNode.kind),
    source: targetIsSink ? acBus.id : compNode.id,
    target: targetIsSink ? compNode.id : acBus.id,
    flowType: flowTypeForKind(compNode.kind),
  });

  return {
    project: syncProjectFromTopology(project, topo),
  };
}

export function disconnectTopologyEdge(
  project: HybridProjectConfig,
  edgeId: string,
): HybridProjectConfig {
  const topo = resolveProjectTopology(project);
  topo.edges = topo.edges.filter((e) => e.id !== edgeId);
  return syncProjectFromTopology(project, topo);
}

export function disconnectNodeFromBus(
  project: HybridProjectConfig,
  nodeId: string,
): HybridProjectConfig {
  const topo = resolveProjectTopology(project);
  topo.edges = topo.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
  return syncProjectFromTopology(project, topo);
}

export function setTopologyViewport(
  project: HybridProjectConfig,
  patch: Partial<TopologyViewport>,
): HybridProjectConfig {
  const topo = resolveProjectTopology(project);
  const nextZoom =
    patch.zoom !== undefined
      ? Math.round(Math.min(Math.max(patch.zoom, MIN_ZOOM), MAX_ZOOM) * 100) / 100
      : topo.viewport.zoom;
  topo.viewport = {
    panX: patch.panX !== undefined && Number.isFinite(patch.panX) ? patch.panX : topo.viewport.panX,
    panY: patch.panY !== undefined && Number.isFinite(patch.panY) ? patch.panY : topo.viewport.panY,
    zoom: nextZoom,
  };
  return {
    ...project,
    schemaVersion: "0.6",
    topology: topo,
  };
}

export function resetTopologyLayout(project: HybridProjectConfig): HybridProjectConfig {
  const topo = resolveProjectTopology(project);
  topo.nodes = topo.nodes.map((n) => {
    const def = DEFAULT_NODE_POSITIONS[n.kind];
    return { ...n, x: def.x, y: def.y };
  });
  topo.viewport = { ...DEFAULT_VIEWPORT };
  return {
    ...project,
    schemaVersion: "0.6",
    topology: topo,
  };
}

export function validateSystemTopology(project: HybridProjectConfig): TopologyValidationResult {
  const topo = resolveProjectTopology(project);
  const errors: TopologyIssue[] = [];
  const warnings: TopologyIssue[] = [];

  const acBus = topo.nodes.find((n) => n.kind === "ac_bus");
  const pvNode = topo.nodes.find((n) => n.kind === "pv");
  const loadNode = topo.nodes.find((n) => n.kind === "load");

  if (!acBus) {
    errors.push({
      code: "missing_ac_bus",
      severity: "error",
      messageId: "Komponen AC Bus wajib ada pada skema sistem.",
      messageEn: "AC Bus component is required in the schematic.",
    });
  }

  if (!pvNode) {
    errors.push({
      code: "missing_pv_node",
      severity: "error",
      messageId: "Komponen Solar PV wajib ada pada skema sistem.",
      messageEn: "Solar PV component is required in the schematic.",
    });
  } else if (acBus && !topo.edges.some((e) => isEdgeConnecting(e, pvNode.id, acBus.id))) {
    errors.push({
      code: "pv_not_connected",
      severity: "error",
      nodeId: pvNode.id,
      messageId: "Solar PV wajib terhubung ke AC Bus sebelum simulasi dijalankan.",
      messageEn: "Solar PV must be connected to AC Bus before running simulation.",
    });
  }

  if (!loadNode) {
    errors.push({
      code: "missing_load_node",
      severity: "error",
      messageId: "Komponen Beban Listrik wajib ada pada skema sistem.",
      messageEn: "Electrical Load component is required in the schematic.",
    });
  } else if (acBus && !topo.edges.some((e) => isEdgeConnecting(e, loadNode.id, acBus.id))) {
    errors.push({
      code: "load_not_connected",
      severity: "error",
      nodeId: loadNode.id,
      messageId: "Beban Listrik wajib terhubung ke AC Bus sebelum simulasi dijalankan.",
      messageEn: "Electrical Load must be connected to AC Bus before running simulation.",
    });
  }

  const seenPairs = new Set<string>();
  const nodeById = new Map(topo.nodes.map((n) => [n.id, n]));
  for (const edge of topo.edges) {
    const src = nodeById.get(edge.source);
    const tgt = nodeById.get(edge.target);
    if (!src || !tgt || src.id === tgt.id || (src.kind === "ac_bus") === (tgt.kind === "ac_bus")) {
      errors.push({
        code: "invalid_edge_connection",
        severity: "error",
        messageId: `Koneksi tidak sah pada kabel ${edge.id}: setiap komponen harus terhubung langsung ke AC Bus.`,
        messageEn: `Invalid edge ${edge.id}: each component must connect directly to AC Bus.`,
      });
      continue;
    }
    const pairKey = [src.id, tgt.id].sort().join("::");
    if (seenPairs.has(pairKey)) {
      errors.push({
        code: "invalid_edge_connection",
        severity: "error",
        messageId: "Terdapat koneksi duplikat pada skema sistem.",
        messageEn: "Duplicate connection detected in the schematic.",
      });
    }
    seenPairs.add(pairKey);
  }

  // Validasi parameter fisik komponen aktif
  const { pv, bess, biomass } = project.components;
  if (pv.enabled) {
    if (!Number.isFinite(pv.capacity_kwp) || pv.capacity_kwp <= 0) {
      errors.push({
        code: "invalid_component_params",
        severity: "error",
        nodeId: pvNode?.id,
        field: "pv.capacity_kwp",
        messageId: "Kapasitas DC PV harus lebih besar dari 0 kWp.",
        messageEn: "PV DC capacity must be greater than 0 kWp.",
      });
    }
    if (!Number.isFinite(pv.inverter_ac_kw) || pv.inverter_ac_kw <= 0) {
      errors.push({
        code: "invalid_component_params",
        severity: "error",
        nodeId: pvNode?.id,
        field: "pv.inverter_ac_kw",
        messageId: "Kapasitas AC inverter PV harus lebih besar dari 0 kW.",
        messageEn: "PV inverter AC capacity must be greater than 0 kW.",
      });
    }
    if (
      Number.isFinite(pv.capacity_kwp) &&
      Number.isFinite(pv.inverter_ac_kw) &&
      pv.inverter_ac_kw > 0
    ) {
      const ratio = pv.capacity_kwp / pv.inverter_ac_kw;
      if (ratio < 0.8 || ratio > 1.6) {
        warnings.push({
          code: "pv_dc_ac_ratio_warning",
          severity: "warning",
          nodeId: pvNode?.id,
          field: "pv.inverter_ac_kw",
          messageId: `Rasio DC/AC PV saat ini ${ratio.toFixed(2)} berada di luar rentang lazim 0,8 sampai 1,6.`,
          messageEn: `PV DC/AC ratio (${ratio.toFixed(2)}) is outside the typical 0.8 to 1.6 range.`,
        });
      }
    }
  }

  if (bess.enabled) {
    if (!Number.isFinite(bess.nominal_capacity_kwh) || bess.nominal_capacity_kwh <= 0) {
      errors.push({
        code: "invalid_component_params",
        severity: "error",
        nodeId: NODE_IDS.bess,
        field: "bess.nominal_capacity_kwh",
        messageId: "Kapasitas nominal BESS harus lebih besar dari 0 kWh.",
        messageEn: "BESS nominal capacity must be greater than 0 kWh.",
      });
    }
    if (
      !Number.isFinite(bess.max_charge_kw) ||
      bess.max_charge_kw <= 0 ||
      !Number.isFinite(bess.max_discharge_kw) ||
      bess.max_discharge_kw <= 0
    ) {
      errors.push({
        code: "invalid_component_params",
        severity: "error",
        nodeId: NODE_IDS.bess,
        field: "bess.max_charge_kw",
        messageId: "Daya charge dan discharge maksimum BESS harus lebih besar dari 0 kW.",
        messageEn: "BESS max charge and discharge power must be greater than 0 kW.",
      });
    }
    if (
      !Number.isFinite(bess.soc_min_fraction) ||
      !Number.isFinite(bess.soc_max_fraction) ||
      bess.soc_min_fraction < 0 ||
      bess.soc_max_fraction > 1 ||
      bess.soc_min_fraction >= bess.soc_max_fraction
    ) {
      errors.push({
        code: "invalid_component_params",
        severity: "error",
        nodeId: NODE_IDS.bess,
        field: "bess.soc_min_fraction",
        messageId: "SOC minimum BESS harus lebih kecil dari SOC maksimum (dalam rentang 0% sampai 100%).",
        messageEn: "BESS minimum SOC must be smaller than maximum SOC (between 0% and 100%).",
      });
    }
  }

  if (biomass.enabled) {
    if (!Number.isFinite(biomass.rated_capacity_kw) || biomass.rated_capacity_kw <= 0) {
      errors.push({
        code: "invalid_component_params",
        severity: "error",
        nodeId: NODE_IDS.biomass,
        field: "biomass.rated_capacity_kw",
        messageId: "Kapasitas terpasang Biomass harus lebih besar dari 0 kW.",
        messageEn: "Biomass rated capacity must be greater than 0 kW.",
      });
    }
  }

  // Keputusan 2a: node opsional tidak terhubung ke AC Bus memberi peringatan kuning non-blokir.
  for (const node of topo.nodes) {
    if (isRequiredNodeKind(node.kind)) continue;
    const connected = acBus ? topo.edges.some((e) => isEdgeConnecting(e, node.id, acBus.id)) : false;
    if (!connected) {
      const name = node.kind === "bess" ? "BESS" : node.kind === "biomass" ? "Biomass" : "Grid";
      warnings.push({
        code: "disconnected_optional_node",
        severity: "warning",
        nodeId: node.id,
        messageId: `${name} ada di kanvas tetapi belum terhubung ke AC Bus, sehingga dianggap nonaktif saat simulasi.`,
        messageEn: `${name} is on the canvas but not connected to AC Bus, so it will be inactive during simulation.`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

export function getNodeRect(node: TopologyNode): NodeRect {
  const dim = NODE_DIMENSIONS[node.kind];
  return {
    x: node.x,
    y: node.y,
    width: dim.width,
    height: dim.height,
    cx: node.x + dim.width / 2,
    cy: node.y + dim.height / 2,
  };
}

export interface EdgeGeometry {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mx: number;
  my: number;
  pathD: string;
}

export function getEdgeGeometry(sourceNode: TopologyNode, targetNode: TopologyNode): EdgeGeometry {
  const s = getNodeRect(sourceNode);
  const t = getNodeRect(targetNode);
  const dx = t.cx - s.cx;
  const dy = t.cy - s.cy;

  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;
  let cx1: number;
  let cy1: number;
  let cx2: number;
  let cy2: number;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const dir = dx >= 0 ? 1 : -1;
    x1 = s.cx + dir * (s.width / 2);
    y1 = s.cy;
    x2 = t.cx - dir * (t.width / 2);
    y2 = t.cy;
    const offset = Math.max(Math.abs(x2 - x1) * 0.45, 32);
    cx1 = x1 + dir * offset;
    cy1 = y1;
    cx2 = x2 - dir * offset;
    cy2 = y2;
  } else {
    const dir = dy >= 0 ? 1 : -1;
    x1 = s.cx;
    y1 = s.cy + dir * (s.height / 2);
    x2 = t.cx;
    y2 = t.cy - dir * (t.height / 2);
    const offset = Math.max(Math.abs(y2 - y1) * 0.45, 32);
    cx1 = x1;
    cy1 = y1 + dir * offset;
    cx2 = x2;
    cy2 = y2 - dir * offset;
  }

  return {
    x1,
    y1,
    x2,
    y2,
    mx: (x1 + x2) / 2,
    my: (y1 + y2) / 2,
    pathD: `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`,
  };
}

export interface EdgePillLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  cx: number;
  cy: number;
}

/**
 * Menghitung posisi dan lebar adaptif pill label aliran energi agar selalu
 * berada di ruang kosong antara node sumber dan target tanpa menyentuh tepi kotak.
 */
export function computeEdgePillLayout(geo: EdgeGeometry, label: string): EdgePillLayout {
  const width = Math.max(82, Math.min(124, Math.ceil(label.length * 6.0) + 18));
  const height = 20;
  const minXBound = Math.min(geo.x1, geo.x2);
  const maxXBound = Math.max(geo.x1, geo.x2);
  const gapX = maxXBound - minXBound;
  const margin = 8;

  let cx = geo.mx;
  if (gapX >= width + margin * 2) {
    const lo = minXBound + width / 2 + margin;
    const hi = maxXBound - width / 2 - margin;
    cx = Math.min(Math.max(geo.mx, lo), hi);
  }
  const cy = geo.my;
  return {
    x: Math.round((cx - width / 2) * 10) / 10,
    y: Math.round((cy - height / 2) * 10) / 10,
    width,
    height,
    cx: Math.round(cx * 10) / 10,
    cy: Math.round(cy * 10) / 10,
  };
}

export interface SchematicBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export function computeSchematicBounds(nodes: TopologyNode[], padding = 48): SchematicBounds {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, width: 680, height: 340 };
  }

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const n of nodes) {
    const r = getNodeRect(n);
    if (r.x < left) left = r.x;
    if (r.y < top) top = r.y;
    if (r.x + r.width > right) right = r.x + r.width;
    if (r.y + r.height > bottom) bottom = r.y + r.height;
  }

  let minX = left - padding;
  let minY = top - padding;
  let width = right - left + padding * 2;
  let height = bottom - top + padding * 2;

  if (width < 680) {
    minX -= (680 - width) / 2;
    width = 680;
  }
  if (height < 340) {
    minY -= (340 - height) / 2;
    height = 340;
  }

  return {
    minX: Math.round(minX),
    minY: Math.round(minY),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function replaceCssVarsForLightTheme(input: string): string {
  return input.replace(/var\((--[\w-]+)\)/g, (_, token: string) => LIGHT_THEME_TOKENS[token] ?? "#0B1F3A");
}

/**
 * Mengonversi elemen SVG skema menjadi string SVG mandiri bertema terang
 * agar siap disematkan ke ekspor PDF pada Tahap 7.
 */
export function serializeSchematicSvgWithLightTheme(svgElement: SVGSVGElement): string {
  const clone = svgElement.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const vb = clone.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (vb && vb.length === 4 && vb.every((v) => Number.isFinite(v))) {
    clone.setAttribute("width", String(vb[2]));
    clone.setAttribute("height", String(vb[3]));
  }
  clone.setAttribute("style", "background:#FFFFFF;font-family:DM Sans,system-ui,sans-serif;");

  const walker = [clone as Element];
  while (walker.length > 0) {
    const el = walker.pop()!;
    for (const attrName of ["fill", "stroke", "color", "style"]) {
      const val = el.getAttribute(attrName);
      if (val && val.includes("var(--")) {
        el.setAttribute(attrName, replaceCssVarsForLightTheme(val));
      }
    }
    if (el.tagName.toLowerCase() === "style" && el.textContent) {
      el.textContent = replaceCssVarsForLightTheme(el.textContent);
    }
    for (let i = 0; i < el.children.length; i++) {
      walker.push(el.children[i]);
    }
  }

  if (typeof XMLSerializer !== "undefined") {
    return new XMLSerializer().serializeToString(clone);
  }
  return clone.outerHTML;
}
