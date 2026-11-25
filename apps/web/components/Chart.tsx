import { useEffect, useRef, useState } from "react";
import type { AnnualRow } from "@/lib/api";
import { fmt, money } from "@/lib/format";

const H = 260, pl = 56, pr = 20, pt = 16, pb = 32;
const MIN_W = 280;

export default function Chart({ rows, currency }: { rows: AnnualRow[]; currency: string }) {
  // Lebar mengikuti wadah, jadi 1 satuan SVG = 1 px dan teks sumbu tetap terbaca di layar 375 px.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(MIN_W, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = rows.length - 1;
  const cum = rows.map((r) => r.cumulative_cash_flow);
  const lo = Math.min(0, ...cum);
  const hi = Math.max(0, ...cum);
  const span = hi - lo || 1;
  const sx = (i: number) => pl + (i * (W - pl - pr)) / (n || 1);
  const sy = (v: number) => pt + ((hi - v) * (H - pt - pb)) / span;
  const points = cum.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");

  // Label sumbu tidak boleh bertumpuk: lewati yang terlalu dekat dengan label sebelumnya.
  const yTicks = [lo, 0, hi]
    .filter((v, i, a) => a.indexOf(v) === i)
    .filter((v, i, a) => i === 0 || Math.abs(sy(v) - sy(a[i - 1])) >= 16);
  const xTicks = cum.map((_, i) => i).filter((i) => i % 5 === 0 || (i === n && (n < 5 || n % 5 >= 3)));
  const label = `Arus kas kumulatif dari ${money(cum[0], currency)} di tahun 0 menjadi ${money(cum[n], currency)} di tahun ${n}. Rinciannya ada di tabel di bawah.`;

  return (
    <div ref={box}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {/* Horizontal hairline grid */}
        {yTicks.map((v) => (
          <line
            key={`grid-${v}`}
            x1={pl}
            x2={W - pr}
            y1={sy(v)}
            y2={sy(v)}
            stroke={v === 0 ? "var(--field)" : "var(--border)"}
            strokeWidth={1}
            strokeDasharray={v === 0 ? "4 3" : undefined}
          />
        ))}

        {/* Cumulative cash flow line */}
        <polyline
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* End point marker */}
        <circle cx={sx(n)} cy={sy(cum[n])} r={4.5} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />

        {/* Axis labels */}
        {yTicks.map((v) => (
          <text key={`y-${v}`} x={pl - 8} y={sy(v) + 4} textAnchor="end">
            {fmt(v / 1e9, 1)}
          </text>
        ))}
        {xTicks.map((i) => (
          <text key={`x-${i}`} x={sx(i)} y={H - 10} textAnchor="middle">
            {i}
          </text>
        ))}
        <text x={0} y={H - 10}>tahun</text>
      </svg>
    </div>
  );
}
