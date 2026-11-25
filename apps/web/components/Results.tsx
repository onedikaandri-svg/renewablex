import type { IrrStatus, PVResponse } from "@/lib/api";
import { disclaimerId, fmt, money } from "@/lib/format";
import Chart from "./Chart";

const IRR_NOTE: Record<IrrStatus, string> = {
  ok: "sebelum pajak, tanpa pendanaan",
  no_sign_change: "Tidak ada IRR: arus kas tidak pernah berganti tanda.",
  ambiguous: "IRR ambigu: arus kas berganti tanda lebih dari sekali.",
  not_found: "IRR tidak ditemukan pada rentang -99% sampai 10.000%.",
};

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "pos" | "neg" | "accent" }) {
  return (
    <div className="kpi">
      <span>{label}</span>
      <b className={tone}>{value}</b>
      <span>{note}</span>
    </div>
  );
}

export default function Results({ res }: { res: PVResponse }) {
  const c = res.currency_code;
  const life = res.annual_results.length - 1;
  return (
    <>
      {res.warnings.length > 0 && (
        <div className="warn" role="note">
          <h3>Perhatian</h3>
          <ul>{res.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      <div className="kpis">
        <Kpi
          label="Energi tahun 1"
          value={`${fmt(res.year_1_energy_kwh)} kWh`}
          note="kapasitas × yield bersih"
        />
        <Kpi
          label="NPV"
          value={money(res.npv_amount, c)}
          note="pada discount rate yang Anda isi"
          tone={res.npv_amount >= 0 ? "pos" : "neg"}
        />
        <Kpi
          label="IRR proyek"
          value={res.project_irr_fraction === null ? "Tidak tersedia" : `${fmt(res.project_irr_fraction * 100, 2)}%`}
          note={IRR_NOTE[res.irr_status]}
          tone={res.project_irr_fraction !== null && res.project_irr_fraction > 0 ? "accent" : undefined}
        />
        <Kpi
          label="Payback sederhana"
          value={res.simple_payback_years === null ? "Belum kembali" : `${fmt(res.simple_payback_years, 1)} tahun`}
          note={res.simple_payback_years === null ? `dalam umur proyek ${life} tahun` : "estimasi, diinterpolasi dalam tahun"}
        />
      </div>

      <div className="sec chart-card">
        <div className="chart-head">
          <h3>Arus kas kumulatif per tahun</h3>
          <span className="chip">miliar {c}</span>
        </div>
        <Chart rows={res.annual_results} currency={c} />
      </div>

      <div className="sec">
        <div className="tw" tabIndex={0} role="region" aria-label="Tabel hasil per tahun, bisa digulir">
          <table>
            <caption>Hasil per tahun, dalam {c} dan kWh</caption>
            <thead>
              <tr>
                <th scope="col">Tahun</th>
                <th scope="col">Energi (kWh)</th>
                <th scope="col">Pendapatan ({c})</th>
                <th scope="col">OPEX ({c})</th>
                <th scope="col">Arus kas ({c})</th>
                <th scope="col">Kumulatif ({c})</th>
              </tr>
            </thead>
            <tbody>
              {res.annual_results.map((r) => (
                <tr key={r.year}>
                  <th scope="row">{r.year}</th>
                  <td>{fmt(r.energy_kwh)}</td>
                  <td>{fmt(r.revenue)}</td>
                  <td>{fmt(r.opex)}</td>
                  <td className={r.cash_flow >= 0 ? "num-pos" : "num-neg"}>{fmt(r.cash_flow)}</td>
                  <td className={r.cumulative_cash_flow >= 0 ? "num-pos" : "num-neg"}>{fmt(r.cumulative_cash_flow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="note sec">
        {disclaimerId(res.scope)} Mesin v{res.engine_version}, metodologi v{res.methodology_version}, dihitung {res.calculated_at}.
      </p>
    </>
  );
}
