import type { TopologyNodeKind } from "@/lib/hybrid-types";

export interface IconProps {
  size?: number;
  className?: string;
}

function SvgIcon({
  size = 16,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `ui-icon ${className}` : "ui-icon"}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconSun(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </SvgIcon>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
    </SvgIcon>
  );
}

export function IconZap(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M13 2L4 14h7l-1 8 10-12h-7l0-8z" />
    </SvgIcon>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 3L2 8l10 5 10-5-10-5z" />
      <path d="M2 12.5l10 5 10-5" />
      <path d="M2 17l10 5 10-5" />
    </SvgIcon>
  );
}

export function IconBookOpen(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z" />
      <path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" />
    </SvgIcon>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </SvgIcon>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </SvgIcon>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 15V3" />
      <path d="M7 8l5-5 5 5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </SvgIcon>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </SvgIcon>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 5v14M5 12h14" />
    </SvgIcon>
  );
}

export function IconZoomIn(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
      <path d="M11 8v6M8 11h6" />
    </SvgIcon>
  );
}

export function IconZoomOut(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
      <path d="M8 11h6" />
    </SvgIcon>
  );
}

export function IconRotateCcw(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </SvgIcon>
  );
}

export function IconClose(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M18 6L6 18M6 6l12 12" />
    </SvgIcon>
  );
}

export function IconSliders(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </SvgIcon>
  );
}

export function IconBarChart(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3 3v18h18" />
      <path d="M7 16v-5M12 16V7M17 16v-8" />
    </SvgIcon>
  );
}

export function IconActivity(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M22 12h-4l-3 8-6-16-3 8H2" />
    </SvgIcon>
  );
}

export function IconGrid(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </SvgIcon>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h14v4H5a2 2 0 0 1-2-2z" />
      <path d="M3 7v11a2 2 0 0 0 2 2h15v-9H5" />
      <circle cx="16.5" cy="14.5" r="1" />
    </SvgIcon>
  );
}

export function IconChevronLeft(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M15 18l-6-6 6-6" />
    </SvgIcon>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M9 18l6-6-6-6" />
    </SvgIcon>
  );
}

export const COMPONENT_ICON_PATHS: Record<TopologyNodeKind, string[]> = {
  pv: [
    "M3 5h18v11H3z",
    "M3 10.5h18",
    "M9 5v11",
    "M15 5v11",
    "M12 16v4",
    "M8 20h8",
  ],
  bess: [
    "M6 6h12v15H6z",
    "M9 3h6v3H9z",
    "M9 11h6",
    "M9 15h6",
  ],
  biomass: [
    "M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z",
    "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12",
  ],
  diesel: [
    "M4 7h10v13H4z",
    "M6 4h6v3H6z",
    "M14 10h3l2 2v6a1 1 0 0 1-1 1h-1",
    "M7 11h4v4H7z",
  ],
  ac_bus: [
    "M13 2L4 14h7l-1 8 10-12h-7l0-8z",
  ],
  load: [
    "M3 10.5L12 3l9 7.5",
    "M5 9.5V20h14V9.5",
    "M10 20v-6h4v6",
  ],
  grid: [
    "M12 3v18",
    "M6 8h12",
    "M4 13h16",
    "M8 21l4-18 4 18",
    "M7 17h10",
  ],
};

export function ComponentIcon({
  kind,
  size = 16,
  className,
}: IconProps & { kind: TopologyNodeKind }) {
  return (
    <SvgIcon size={size} className={className}>
      {COMPONENT_ICON_PATHS[kind].map((d, idx) => (
        <path key={idx} d={d} />
      ))}
    </SvgIcon>
  );
}

export function ComponentSvgIcon({
  kind,
  x,
  y,
  size = 16,
  color,
}: {
  kind: TopologyNodeKind;
  x: number;
  y: number;
  size?: number;
  color: string;
}) {
  const scale = size / 24;
  return (
    <g
      transform={`translate(${x}, ${y}) scale(${scale})`}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {COMPONENT_ICON_PATHS[kind].map((d, idx) => (
        <path key={idx} d={d} />
      ))}
    </g>
  );
}
