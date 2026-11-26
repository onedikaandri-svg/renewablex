"use client";

import { useMemo, useRef, useState } from "react";
import { ComponentIcon, ComponentSvgIcon, IconRotateCcw, IconZoomIn, IconZoomOut } from "@/components/Icons";
import { formatNumber } from "@/lib/format";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  addTopologyNode,
  connectTopologyNodes,
  disconnectNodeFromBus,
  getEdgeGeometry,
  getNodeRect,
  isKindConnectedToBus,
  isRequiredNodeKind,
  moveTopologyNode,
  removeTopologyNode,
  resetTopologyLayout,
  resolveProjectTopology,
  setTopologyViewport,
  snapToGrid,
} from "@/lib/hybrid-topology";
import type {
  HybridProjectConfig,
  TopologyNode,
  TopologyNodeKind,
  TopologyValidationResult,
} from "@/lib/hybrid-types";
import { usePreferences } from "@/lib/preferences";

const OPTIONAL_KINDS: Array<{ kind: TopologyNodeKind; addId: string; addEn: string; labelId: string; labelEn: string }> = [
  { kind: "bess", addId: "Tambah BESS", addEn: "Add BESS", labelId: "BESS (Baterai)", labelEn: "BESS (Battery)" },
  { kind: "biomass", addId: "Tambah Biomass", addEn: "Add Biomass", labelId: "Biomass", labelEn: "Biomass" },
  { kind: "diesel", addId: "Tambah Diesel", addEn: "Add Diesel", labelId: "Diesel Generator", labelEn: "Diesel Generator" },
  { kind: "grid", addId: "Tambah Grid", addEn: "Add Grid", labelId: "Jaringan Grid", labelEn: "Utility Grid" },
];

const SERIES_COLOR_BY_KIND: Record<TopologyNodeKind, string> = {
  pv: "var(--series-pv)",
  bess: "var(--series-bess)",
  biomass: "var(--series-biomass)",
  diesel: "var(--series-diesel)",
  ac_bus: "var(--accent)",
  load: "var(--series-load)",
  grid: "var(--series-grid)",
};

function nodeTitle(kind: TopologyNodeKind, lang: "id" | "en"): string {
  switch (kind) {
    case "pv":
      return "Solar PV";
    case "bess":
      return lang === "en" ? "BESS Storage" : "BESS (Baterai)";
    case "biomass":
      return "Biomass";
    case "diesel":
      return "Diesel Generator";
    case "ac_bus":
      return "AC BUS";
    case "load":
      return lang === "en" ? "Electrical Load" : "Beban Listrik";
    case "grid":
      return lang === "en" ? "Utility Grid" : "Jaringan Grid";
  }
}

function nodeMetricText(project: HybridProjectConfig, node: TopologyNode, connected: boolean, lang: "id" | "en"): string {
  const { pv, bess, biomass, diesel } = project.components;
  switch (node.kind) {
    case "pv":
      return connected
        ? `${formatNumber(pv.capacity_kwp, lang, 0)} kWp | Inv ${formatNumber(pv.inverter_ac_kw, lang, 0)} kW`
        : (lang === "en" ? "Disconnected from AC Bus" : "Terputus dari AC Bus");
    case "bess":
      return connected
        ? `${formatNumber(bess.nominal_capacity_kwh, lang, 0)} kWh | ${formatNumber(bess.max_charge_kw, lang, 0)} kW`
        : (lang === "en" ? "Disconnected (Inactive)" : "Terputus (Nonaktif)");
    case "biomass":
      return connected
        ? `${formatNumber(biomass.rated_capacity_kw, lang, 0)} kW | ${biomass.fuel_preset.toUpperCase()}`
        : (lang === "en" ? "Disconnected (Inactive)" : "Terputus (Nonaktif)");
    case "diesel":
      return connected
        ? `${formatNumber(diesel.rated_capacity_kw, lang, 0)} kW | ${formatNumber(diesel.min_load_fraction * 100, lang, 0)}% min`
        : (lang === "en" ? "Disconnected (Inactive)" : "Terputus (Nonaktif)");
    case "ac_bus":
      return project.simulation.dispatch_strategy;
    case "load":
      return project.load_profile.mode === "csv"
        ? `CSV (${project.load_profile.csv_filename || "kustom"})`
        : `${formatNumber(project.load_profile.peak_load_kw, lang, 0)} kW ${lang === "en" ? "peak" : "puncak"}`;
    case "grid": {
      if (!connected) return lang === "en" ? "Off-grid (Disconnected)" : "Off-grid (Terputus)";
      const imp = project.simulation.dispatch_params.allow_grid_import;
      const exp = project.simulation.dispatch_params.allow_grid_export;
      if (imp && exp) return lang === "en" ? "Import & Export" : "Impor & Ekspor";
      if (imp) return lang === "en" ? "Import Only" : "Hanya Impor";
      if (exp) return lang === "en" ? "Export Only" : "Hanya Ekspor";
      return lang === "en" ? "Connected" : "Terhubung";
    }
  }
}

export default function SchematicCanvas({
  project,
  selectedNodeId,
  validation,
  onSelectNode,
  onChangeProject,
  onNotify,
}: {
  project: HybridProjectConfig;
  selectedNodeId: string;
  validation: TopologyValidationResult;
  onSelectNode: (nodeId: string) => void;
  onChangeProject: (next: HybridProjectConfig) => void;
  onNotify?: (message: string, tone: "info" | "success" | "error") => void;
}) {
  const { lang } = usePreferences();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const topology = useMemo(() => resolveProjectTopology(project), [project]);

  const [dragState, setDragState] = useState<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startNodeX: number;
    startNodeY: number;
    currentX: number;
    currentY: number;
    moved: boolean;
  } | null>(null);

  const [panState, setPanState] = useState<{
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
    currentPanX: number;
    currentPanY: number;
  } | null>(null);

  const [connectDraft, setConnectDraft] = useState<{
    fromNodeId: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);

  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  const activePanX = panState ? panState.currentPanX : topology.viewport.panX;
  const activePanY = panState ? panState.currentPanY : topology.viewport.panY;
  const zoom = topology.viewport.zoom;

  // Bangun daftar node efektif termasuk posisi drag sementara agar garis ikut bergerak mulus.
  const displayNodes = useMemo(() => {
    if (!dragState) return topology.nodes;
    return topology.nodes.map((n) =>
      n.id === dragState.nodeId ? { ...n, x: dragState.currentX, y: dragState.currentY } : n,
    );
  }, [topology.nodes, dragState]);

  const nodeMap = useMemo(() => new Map(displayNodes.map((n) => [n.id, n])), [displayNodes]);
  const acBusNode = useMemo(() => displayNodes.find((n) => n.kind === "ac_bus") ?? null, [displayNodes]);

  function clientToSvgCoords(clientX: number, clientY: number): { svgX: number; svgY: number } {
    const svg = svgRef.current;
    if (!svg) return { svgX: 0, svgY: 0 };
    const ctm = svg.getScreenCTM?.();
    if (ctm) {
      const inv = ctm.inverse();
      return {
        svgX: clientX * inv.a + clientY * inv.c + inv.e,
        svgY: clientX * inv.b + clientY * inv.d + inv.f,
      };
    }
    const rect = svg.getBoundingClientRect();
    const vbWidth = 840;
    const vbHeight = 500;
    return {
      svgX: ((clientX - rect.left) / Math.max(rect.width, 1)) * vbWidth,
      svgY: ((clientY - rect.top) / Math.max(rect.height, 1)) * vbHeight,
    };
  }

  function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const { svgX, svgY } = clientToSvgCoords(clientX, clientY);
    return {
      x: (svgX - activePanX) / zoom,
      y: (svgY - activePanY) / zoom,
    };
  }

  function handleNodePointerDown(e: React.PointerEvent<SVGGElement>, node: TopologyNode) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    onSelectNode(node.id);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDragState({
      nodeId: node.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
      currentX: node.x,
      currentY: node.y,
      moved: false,
    });
  }

  function handleNodePointerMove(e: React.PointerEvent<SVGGElement>) {
    if (!dragState) return;
    const startWorld = clientToWorld(dragState.startClientX, dragState.startClientY);
    const currWorld = clientToWorld(e.clientX, e.clientY);
    const dx = currWorld.x - startWorld.x;
    const dy = currWorld.y - startWorld.y;
    const moved = dragState.moved || Math.hypot(e.clientX - dragState.startClientX, e.clientY - dragState.startClientY) > 4;
    setDragState({
      ...dragState,
      currentX: snapToGrid(dragState.startNodeX + dx),
      currentY: snapToGrid(dragState.startNodeY + dy),
      moved,
    });
  }

  function handleNodePointerUp(e: React.PointerEvent<SVGGElement>) {
    if (!dragState) return;
    e.stopPropagation();
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (dragState.moved) {
      const next = moveTopologyNode(project, dragState.nodeId, dragState.currentX, dragState.currentY);
      onChangeProject(next);
      setLiveAnnouncement(`Posisi komponen dipindahkan ke ${dragState.currentX}, ${dragState.currentY}.`);
    }
    setDragState(null);
  }

  function handlePortPointerDown(e: React.PointerEvent<SVGCircleElement>, node: TopologyNode, px: number, py: number) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    onSelectNode(node.id);
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setConnectDraft({
      fromNodeId: node.id,
      x1: px,
      y1: py,
      x2: px,
      y2: py,
    });
  }

  function handleBgPointerDown(e: React.PointerEvent<SVGRectElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setPanState({
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: topology.viewport.panX,
      startPanY: topology.viewport.panY,
      currentPanX: topology.viewport.panX,
      currentPanY: topology.viewport.panY,
    });
  }

  function handleSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (connectDraft) {
      const w = clientToWorld(e.clientX, e.clientY);
      setConnectDraft({ ...connectDraft, x2: w.x, y2: w.y });
      return;
    }
    if (panState) {
      const startSvg = clientToSvgCoords(panState.startClientX, panState.startClientY);
      const currSvg = clientToSvgCoords(e.clientX, e.clientY);
      setPanState({
        ...panState,
        currentPanX: Math.round(panState.startPanX + (currSvg.svgX - startSvg.svgX)),
        currentPanY: Math.round(panState.startPanY + (currSvg.svgY - startSvg.svgY)),
      });
    }
  }

  function handleSvgPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (connectDraft) {
      svgRef.current?.releasePointerCapture?.(e.pointerId);
      const world = clientToWorld(e.clientX, e.clientY);
      const hitTarget = displayNodes.find((n) => {
        if (n.id === connectDraft.fromNodeId) return false;
        const r = getNodeRect(n);
        return (
          world.x >= r.x - 16 &&
          world.x <= r.x + r.width + 16 &&
          world.y >= r.y - 16 &&
          world.y <= r.y + r.height + 16
        );
      });
      if (hitTarget) {
        const res = connectTopologyNodes(project, connectDraft.fromNodeId, hitTarget.id);
        if (res.error) {
          onNotify?.(res.error.messageId, "error");
          setLiveAnnouncement(res.error.messageId);
        } else {
          onChangeProject(res.project);
          onNotify?.("Koneksi ke AC Bus berhasil disambungkan.", "success");
          setLiveAnnouncement("Koneksi ke AC Bus berhasil disambungkan.");
        }
      }
      setConnectDraft(null);
      return;
    }

    if (panState) {
      svgRef.current?.releasePointerCapture?.(e.pointerId);
      if (panState.currentPanX !== panState.startPanX || panState.currentPanY !== panState.startPanY) {
        onChangeProject(setTopologyViewport(project, { panX: panState.currentPanX, panY: panState.currentPanY }));
      }
      setPanState(null);
    }
  }

  function handleNodeKeyDown(e: React.KeyboardEvent<SVGGElement>, node: TopologyNode) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectNode(node.id);
      setLiveAnnouncement(`${nodeTitle(node.kind, lang)} dipilih.`);
      return;
    }
    const delta = e.shiftKey ? 40 : 20;
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -delta;
    else if (e.key === "ArrowRight") dx = delta;
    else if (e.key === "ArrowUp") dy = -delta;
    else if (e.key === "ArrowDown") dy = delta;

    if (dx !== 0 || dy !== 0) {
      e.preventDefault();
      const next = moveTopologyNode(project, node.id, node.x + dx, node.y + dy);
      onChangeProject(next);
      setLiveAnnouncement(`${nodeTitle(node.kind, lang)} digeser ke koordinat ${node.x + dx}, ${node.y + dy}.`);
      return;
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      const removed = removeTopologyNode(project, node.id);
      if (!removed.removed) {
        const msg = removed.reason || "Komponen tidak dapat dihapus.";
        onNotify?.(msg, "error");
        setLiveAnnouncement(msg);
      } else {
        onChangeProject(removed.project);
        onSelectNode("node-ac-bus");
        onNotify?.(`${nodeTitle(node.kind, lang)} dihapus dari kanvas.`, "info");
        setLiveAnnouncement(`${nodeTitle(node.kind, lang)} dihapus dari kanvas.`);
      }
    }
  }

  function handleAddOptional(kind: TopologyNodeKind) {
    const existing = topology.nodes.find((n) => n.kind === kind);
    if (existing) {
      onSelectNode(existing.id);
      return;
    }
    const next = addTopologyNode(project, kind, { autoConnect: false });
    onChangeProject(next);
    const createdId = `node-${kind}`;
    onSelectNode(createdId);
    const msg = `${nodeTitle(kind, lang)} ditambahkan ke kanvas. Hubungkan ke AC Bus untuk mengaktifkannya.`;
    onNotify?.(msg, "info");
    setLiveAnnouncement(msg);
  }

  function handleConnectDirect(nodeId: string) {
    if (!acBusNode) return;
    const res = connectTopologyNodes(project, nodeId, acBusNode.id);
    if (res.error) {
      onNotify?.(res.error.messageId, "error");
    } else {
      onChangeProject(res.project);
      onNotify?.("Komponen terhubung ke AC Bus.", "success");
    }
  }

  function handleDisconnectDirect(nodeId: string) {
    const next = disconnectNodeFromBus(project, nodeId);
    onChangeProject(next);
    onNotify?.("Koneksi ke AC Bus diputuskan.", "info");
  }

  function handleRemoveOptional(nodeId: string, kind: TopologyNodeKind) {
    const res = removeTopologyNode(project, nodeId);
    if (!res.removed) {
      onNotify?.(res.reason || "Komponen wajib dikunci.", "error");
      return;
    }
    onChangeProject(res.project);
    if (selectedNodeId === nodeId) onSelectNode("node-ac-bus");
    onNotify?.(`${nodeTitle(kind, lang)} dihapus dari kanvas.`, "info");
  }

  const statusChip = !validation.valid
    ? { cls: "chip chip-unviable", label: `${validation.errors.length} Galat Topologi` }
    : validation.warnings.length > 0
      ? { cls: "chip chip-marginal", label: `${validation.warnings.length} Peringatan` }
      : { cls: "chip chip-viable", label: lang === "en" ? "Valid Topology" : "Topologi Valid" };

  return (
    <section className="card" aria-labelledby="h-canvas">
      <div className="card-header">
        <div>
          <h2 id="h-canvas">{lang === "en" ? "Interactive System Schematic" : "Kanvas Skema Sistem Interaktif"}</h2>
          <p className="note">
            Seret komponen untuk mengatur tata letak, tarik titik port ke AC Bus untuk menyambung, atau klik komponen untuk mengatur parameternya.
          </p>
        </div>
        <span className={statusChip.cls}>{statusChip.label}</span>
      </div>

      {/* Bilah alat kanvas */}
      <div className="canvas-toolbar" role="toolbar" aria-label={lang === "en" ? "Schematic canvas tools" : "Alat kanvas skema"}>
        <div className="actions-inline">
          {OPTIONAL_KINDS.map((item) => {
            const exists = topology.nodes.some((n) => n.kind === item.kind);
            return (
              <button
                key={item.kind}
                type="button"
                className={`btn btn-sm ${exists ? "ghost" : "primary"}`}
                onClick={() => handleAddOptional(item.kind)}
              >
                <ComponentIcon kind={item.kind} size={15} />
                {exists
                  ? (lang === "en" ? `Select ${item.labelEn}` : `Pilih ${item.labelId}`)
                  : (lang === "en" ? item.addEn : item.addId)}
              </button>
            );
          })}
        </div>

        <div className="actions-inline">
          <button
            type="button"
            className="btn btn-sm btn-icon ghost"
            aria-label={lang === "en" ? "Zoom out canvas" : "Perkecil tampilan kanvas"}
            title={lang === "en" ? "Zoom out" : "Perkecil tampilan"}
            disabled={zoom <= MIN_ZOOM}
            onClick={() => onChangeProject(setTopologyViewport(project, { zoom: zoom - ZOOM_STEP }))}
          >
            <IconZoomOut size={16} />
          </button>
          <span className="chip tabular-nums" aria-label="Tingkat perbesaran kanvas">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className="btn btn-sm btn-icon ghost"
            aria-label={lang === "en" ? "Zoom in canvas" : "Perbesar tampilan kanvas"}
            title={lang === "en" ? "Zoom in" : "Perbesar tampilan"}
            disabled={zoom >= MAX_ZOOM}
            onClick={() => onChangeProject(setTopologyViewport(project, { zoom: zoom + ZOOM_STEP }))}
          >
            <IconZoomIn size={16} />
          </button>
          <button
            type="button"
            className="btn btn-sm btn-icon ghost"
            aria-label={lang === "en" ? "Reset canvas layout" : "Reset tata letak kanvas"}
            title={lang === "en" ? "Reset layout" : "Reset Tata Letak"}
            onClick={() => {
              onChangeProject(resetTopologyLayout(project));
              onNotify?.("Tata letak kanvas dikembalikan ke posisi rapi awal.", "info");
            }}
          >
            <IconRotateCcw size={16} />
          </button>
        </div>
      </div>

      {/* Area kanvas SVG interaktif (desktop & tablet; tetap aman & pas pada 360px) */}
      <div className="canvas-stage">
        <svg
          ref={svgRef}
          className="canvas-svg"
          viewBox="0 0 900 520"
          role="region"
          aria-label={
            lang === "en"
              ? "Interactive hybrid system topology canvas. Use Tab and arrow keys to move components."
              : "Kanvas topologi sistem hybrid interaktif. Gunakan tombol Tab dan panah untuk memindahkan komponen."
          }
          onPointerMove={handleSvgPointerMove}
          onPointerUp={handleSvgPointerUp}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              const nextZoom = zoom + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
              onChangeProject(setTopologyViewport(project, { zoom: nextZoom }));
            }
          }}
        >
          <defs>
            <pattern id="canvas-grid-dots" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="10" cy="10" r="1" fill="var(--border)" />
            </pattern>
            <marker id="canvas-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 8 5 L 0 9 z" fill="var(--accent)" />
            </marker>
          </defs>

          {/* Latar belakang pan */}
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="url(#canvas-grid-dots)"
            style={{ cursor: panState ? "grabbing" : "grab" }}
            onPointerDown={handleBgPointerDown}
          />

          <g transform={`translate(${activePanX}, ${activePanY}) scale(${zoom})`}>
            {/* Garis koneksi (edges) */}
            {topology.edges.map((edge) => {
              const src = nodeMap.get(edge.source);
              const tgt = nodeMap.get(edge.target);
              if (!src || !tgt) return null;
              const geo = getEdgeGeometry(src, tgt);
              const compNode = src.kind === "ac_bus" ? tgt : src;
              const strokeColor = SERIES_COLOR_BY_KIND[compNode.kind];
              return (
                <g key={edge.id}>
                  <path
                    d={geo.pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={3}
                    markerEnd={compNode.kind === "bess" || compNode.kind === "grid" ? undefined : "url(#canvas-arrow)"}
                  />
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={`Putuskan koneksi ${nodeTitle(compNode.kind, lang)} dari AC Bus`}
                    style={{ cursor: "pointer" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDisconnectDirect(compNode.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleDisconnectDirect(compNode.id);
                      }
                    }}
                  >
                    <circle cx={geo.mx} cy={geo.my} r={11} fill="var(--surface)" stroke={strokeColor} strokeWidth={1.5} />
                    <path
                      d={`M ${geo.mx - 3.5} ${geo.my - 3.5} L ${geo.mx + 3.5} ${geo.my + 3.5} M ${geo.mx + 3.5} ${geo.my - 3.5} L ${geo.mx - 3.5} ${geo.my + 3.5}`}
                      stroke="var(--navytext)"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                    />
                  </g>
                </g>
              );
            })}

            {/* Pratinjau kabel saat pengguna menarik port */}
            {connectDraft && (
              <line
                x1={connectDraft.x1}
                y1={connectDraft.y1}
                x2={connectDraft.x2}
                y2={connectDraft.y2}
                stroke="var(--accent)"
                strokeWidth={2.5}
                strokeDasharray="6 4"
              />
            )}

            {/* Node komponen */}
            {displayNodes.map((node) => {
              const rect = getNodeRect(node);
              const isSelected = selectedNodeId === node.id;
              const isConnected = isKindConnectedToBus(topology, node.kind);
              const isBus = node.kind === "ac_bus";
              const isRequired = isRequiredNodeKind(node.kind);
              const color = SERIES_COLOR_BY_KIND[node.kind];
              const metric = nodeMetricText(project, node, isConnected, lang);

              // Titik port koneksi di sisi menghadap AC Bus (atau kanan untuk AC Bus)
              let portX = rect.x + rect.width;
              let portY = rect.cy;
              if (!isBus && acBusNode) {
                const busRect = getNodeRect(acBusNode);
                if (Math.abs(busRect.cx - rect.cx) >= Math.abs(busRect.cy - rect.cy)) {
                  portX = busRect.cx >= rect.cx ? rect.x + rect.width : rect.x;
                  portY = rect.cy;
                } else {
                  portX = rect.cx;
                  portY = busRect.cy >= rect.cy ? rect.y + rect.height : rect.y;
                }
              }

              return (
                <g
                  key={node.id}
                  data-node-id={node.id}
                  className="canvas-node"
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${nodeTitle(node.kind, lang)}, ${metric}, ${isConnected ? "terhubung ke AC Bus" : "belum terhubung ke AC Bus"}, posisi ${node.x} kali ${node.y}. Gunakan tombol panah untuk menggeser.`}
                  style={{ cursor: dragState?.nodeId === node.id ? "grabbing" : "grab" }}
                  onPointerDown={(e) => handleNodePointerDown(e, node)}
                  onPointerMove={handleNodePointerMove}
                  onPointerUp={handleNodePointerUp}
                  onKeyDown={(e) => handleNodeKeyDown(e, node)}
                >
                  {isSelected && (
                    <rect
                      x={rect.x - 4}
                      y={rect.y - 4}
                      width={rect.width + 8}
                      height={rect.height + 8}
                      rx={10}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      strokeDasharray="4 3"
                    />
                  )}

                  <rect
                    x={rect.x}
                    y={rect.y}
                    width={rect.width}
                    height={rect.height}
                    rx={isBus ? 8 : 6}
                    fill={isBus ? "var(--bg)" : "var(--surface-subtle)"}
                    stroke={isConnected ? color : "var(--warntext)"}
                    strokeWidth={isSelected ? 2.5 : 2}
                    strokeDasharray={isConnected ? undefined : "5 4"}
                  />

                  <ComponentSvgIcon
                    kind={node.kind}
                    x={isBus ? rect.cx - 8 : rect.x + 10}
                    y={isBus ? rect.y + 10 : rect.y + 11}
                    size={isBus ? 16 : 14}
                    color={isConnected ? color : "var(--warntext)"}
                  />

                  <text
                    x={isBus ? rect.cx : rect.x + 28}
                    y={isBus ? rect.y + 42 : rect.y + 22}
                    textAnchor={isBus ? "middle" : "start"}
                    style={{ fill: "var(--navytext)", fontWeight: 700, fontSize: isBus ? "13px" : "11.5px" }}
                  >
                    {nodeTitle(node.kind, lang)}
                  </text>

                  <text
                    x={isBus ? rect.cx : rect.x + 12}
                    y={isBus ? rect.y + 60 : rect.y + 44}
                    textAnchor={isBus ? "middle" : "start"}
                    style={{
                      fill: isConnected ? color : "var(--warntext)",
                      fontWeight: 600,
                      fontSize: "11.5px",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {metric}
                  </text>

                  <text
                    x={isBus ? rect.cx : rect.x + 12}
                    y={isBus ? rect.y + 78 : rect.y + 62}
                    textAnchor={isBus ? "middle" : "start"}
                    style={{ fill: "var(--muted)", fontSize: "10.5px" }}
                  >
                    {isBus
                      ? "Pusat Distribusi AC"
                      : isRequired
                        ? (isConnected ? "Wajib (Terkunci)" : "Wajib Terhubung!")
                        : (isConnected ? "Opsional (Aktif)" : "Opsional (Nonaktif)")}
                  </text>

                  {!isBus && (
                    <g>
                      <circle
                        cx={portX}
                        cy={portY}
                        r={14}
                        fill="transparent"
                        style={{ cursor: "crosshair" }}
                        onPointerDown={(e) => handlePortPointerDown(e, node, portX, portY)}
                      />
                      <circle
                        cx={portX}
                        cy={portY}
                        r={6}
                        fill={isConnected ? color : "var(--bg)"}
                        stroke={color}
                        strokeWidth={2}
                        style={{ pointerEvents: "none" }}
                      />
                    </g>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Mode ringkas ramah layar 360px dan daftar aksi cepat komponen */}
      <div className="canvas-mobile-list" aria-label="Daftar aksi cepat komponen skema">
        <p className="note" style={{ marginBottom: "0.5rem" }}>
          <strong>Kontrol Cepat Komponen:</strong> Ketuk untuk mengatur parameter atau menyambung ke AC Bus (target sentuh 44px).
        </p>
        <div className="canvas-mobile-grid">
          {topology.nodes.map((node) => {
            const isSelected = selectedNodeId === node.id;
            const isConnected = isKindConnectedToBus(topology, node.kind);
            const isBus = node.kind === "ac_bus";
            const isRequired = isRequiredNodeKind(node.kind);

            return (
              <div
                key={`card-${node.id}`}
                className={`canvas-mobile-card ${isSelected ? "is-selected" : ""}`}
              >
                <div className="actions-inline" style={{ justifyContent: "space-between", marginBottom: "0.375rem" }}>
                  <strong style={{ color: "var(--navytext)" }}>{nodeTitle(node.kind, lang)}</strong>
                  <span className={`chip ${isConnected ? "chip-viable" : "chip-marginal"}`}>
                    {isBus ? "Bus Utama" : isConnected ? "Terhubung" : "Terputus"}
                  </span>
                </div>
                <p className="note tabular-nums" style={{ marginBottom: "0.625rem" }}>
                  {nodeMetricText(project, node, isConnected, lang)}
                </p>
                <div className="actions-inline">
                  <button
                    type="button"
                    className={`btn btn-sm ${isSelected ? "primary" : "ghost"}`}
                    onClick={() => onSelectNode(node.id)}
                  >
                    Atur Parameter
                  </button>
                  {!isBus && (
                    isConnected ? (
                      <button
                        type="button"
                        className="btn btn-sm ghost"
                        onClick={() => handleDisconnectDirect(node.id)}
                      >
                        Putuskan
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-sm primary"
                        onClick={() => handleConnectDirect(node.id)}
                      >
                        Hubungkan ke AC Bus
                      </button>
                    )
                  )}
                  {!isRequired && (
                    <button
                      type="button"
                      className="btn btn-sm danger-ghost"
                      onClick={() => handleRemoveOptional(node.id, node.kind)}
                    >
                      Hapus
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Ringkasan teks aksesibel untuk pembaca layar */}
      <details className="more">
        <summary>Ringkasan Koneksi Topologi (Teks Aksesibel)</summary>
        <div className="tw tw-auto">
          <table className="sens-main">
            <caption>Daftar komponen pada skema sistem hybrid dan status koneksinya ke AC Bus</caption>
            <thead>
              <tr>
                <th>Komponen</th>
                <th>Peran</th>
                <th>Status Koneksi</th>
                <th>Posisi Kanvas (X, Y)</th>
              </tr>
            </thead>
            <tbody>
              {topology.nodes.map((node) => {
                const connected = isKindConnectedToBus(topology, node.kind);
                return (
                  <tr key={`row-${node.id}`}>
                    <th>{nodeTitle(node.kind, lang)}</th>
                    <td>{isRequiredNodeKind(node.kind) ? "Wajib" : "Opsional"}</td>
                    <td>{node.kind === "ac_bus" ? "Pusat AC Bus" : connected ? "Terhubung ke AC Bus" : "Terputus"}</td>
                    <td className="tabular-nums">{node.x}, {node.y}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>

      <p className="sr-only" role="status" aria-live="polite">
        {liveAnnouncement}
      </p>
    </section>
  );
}
