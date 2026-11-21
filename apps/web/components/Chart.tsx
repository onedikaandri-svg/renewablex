import type { AnnualRow } from "@/lib/api";
import { fmt, money } from "@/lib/format";

export default function Chart({ rows, currency }: { rows: AnnualRow[]; currency: string }) {
  const W = 640, H = 240, pl = 52, pr = 16, pt = 12, pb = 30;
  const n = rows.length - 1;
  const cum = rows.map((r) => r.cumulative_cash_flow);
  const lo = Math.min(0, ...cum), hi = Math.max(0, ...cum), span = hi - lo || 1;
  const sx = (i: number) => pl + (i * (W - pl - pr)) / (n || 1);
  const sy = (v: number) => pt + ((hi - v) * (H - pt - pb)) / span;
  const points = cum.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const yTicks = [lo, 0, hi].filter((v, i, a) => a.indexOf(v) === i);
  const xTicks = cum.map((_, i) => i).filter((i) => i % 5 === 0 || i === n);
  const label = `Arus kas kumulatif dari ${money(cum[0], currency)} di tahun 0 menjadi ${money(cum[n], currency)} di tahun ${n}. Rinciannya ada di tabel di bawah.`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <line x1={pl} x2={W - pr} y1={sy(0)} y2={sy(0)} stroke="var(--field)" strokeWidth={1} strokeDasharray="4 3" />
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={3} strokeLinejoin="round" />
      <circle cx={sx(n)} cy={sy(cum[n])} r={4} fill="var(--accent)" />
      {yTicks.map((v) => <text key={v} x={pl - 6} y={sy(v) + 4} textAnchor="end">{fmt(v / 1e9, 1)}</text>)}
      {xTicks.map((i) => <text key={i} x={sx(i)} y={H - 10} textAnchor="middle">{i}</text>)}
      <text x={W - pr} y={H - 10} textAnchor="end">tahun</text>
    </svg>
  );
}
