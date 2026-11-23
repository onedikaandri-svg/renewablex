import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { SLOW_ENGINE_NOTE } from "@/lib/format";
import { buildSensitivityView, problemMessages, runSensitivity, type SensitivityView } from "@/lib/sensitivity";

type State =
  | { kind: "loading" }
  | { kind: "done"; view: SensitivityView }
  | { kind: "invalid"; messages: string[] }
  | { kind: "failed"; message: string };

// `request` adalah isi permintaan yang sama dengan hasil utama di atasnya, bukan isi form saat ini.
export default function Sensitivity({ request }: { request: unknown }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const ctl = new AbortController();
    setState({ kind: "loading" });
    runSensitivity(request, ctl.signal)
      .then((res) => setState({ kind: "done", view: buildSensitivityView(res) }))
      .catch((err: unknown) => {
        if (ctl.signal.aborted) return;
        if (err instanceof ApiError) setState({ kind: "invalid", messages: problemMessages(err.problems) });
        else setState({ kind: "failed", message: err instanceof Error ? err.message : "Terjadi kesalahan." });
      });
    return () => ctl.abort();
  }, [request, attempt]);

  useEffect(() => {
    if (state.kind !== "loading") { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, [state.kind]);

  return (
    <section className="sec" aria-labelledby="h-sens">
      <h3 id="h-sens">Sensitivitas NPV: Asumsi Mana yang Paling Menggeser Hasil?</h3>
      <div className="status" role="status">
        {state.kind === "loading" && (
          <div className="state">
            <p>Menghitung sensitivitas&hellip;</p>
            {slow && <p className="note">{SLOW_ENGINE_NOTE}</p>}
          </div>
        )}
        {state.kind === "done" && <p className="sr-only">Analisis sensitivitas siap, ada di bawah hasil utama.</p>}
      </div>
      {state.kind === "invalid" && (
        <div className="state bad" role="alert">
          <h4>Sensitivitas belum bisa dihitung</h4>
          <ul>{state.messages.map((m) => <li key={m}>{m}</li>)}</ul>
          <p>Hasil utama di atas tidak terpengaruh. Ubah asumsi di form, lalu hitung ulang.</p>
        </div>
      )}
      {state.kind === "failed" && (
        <div className="state bad" role="alert">
          <h4>Mesin hitung tidak bisa dijangkau</h4>
          <p>{state.message} Hasil utama di atas tidak terpengaruh.</p>
          <div className="row">
            <button className="btn ghost" type="button" onClick={() => setAttempt((a) => a + 1)}>Coba lagi</button>
          </div>
        </div>
      )}
      {state.kind === "done" && <Panel view={state.view} />}
    </section>
  );
}

function Panel({ view }: { view: SensitivityView }) {
  if (view.rows.length === 0) {
    return <div className="state"><h4>Belum ada hasil sensitivitas</h4><p>Mesin tidak mengembalikan asumsi untuk dianalisis.</p></div>;
  }
  const c = view.currency;
  return (
    <>
      <p className="note">Tiap asumsi digeser sendiri secara relatif (+10% berarti nilainya dikali 1,1), asumsi lain tetap.</p>
      <div className="tw tw-auto sec" tabIndex={0} role="region" aria-label="Tabel sensitivitas NPV, bisa digulir">
        <table className="sens sens-main">
          <caption>Selisih NPV terhadap NPV dasar, dalam {view.unit} {c}. Urut dari asumsi yang paling berpengaruh.</caption>
          <thead>
            <tr>
              <th scope="col">Asumsi dan nilai dasar</th>
              {view.shifts.map((s) => <th scope="col" key={s}>{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => (
              <tr key={r.variable}>
                <th scope="row">{r.label}<span className="sub">{r.baseValue}</span></th>
                {r.deltas.map((d, i) => <td key={view.shifts[i]}>{d}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.zeroBaseLabels.length > 0 && (
        <p className="note sec">
          Nilai dasar {view.zeroBaseLabels.join(" dan ")} adalah 0, jadi pergeseran relatif tidak mengubahnya dan selisih NPV-nya selalu 0. Ini bukan galat.
        </p>
      )}
      <details className="more">
        <summary>Lihat IRR dan payback tiap kasus</summary>
        <div className="tw" tabIndex={0} role="region" aria-label="Tabel IRR dan payback tiap kasus, bisa digulir">
          <table className="sens">
            <caption>NPV, IRR, dan payback tiap kasus. IRR sebelum pajak dan tanpa pendanaan.</caption>
            <thead>
              <tr>
                <th scope="col">Asumsi</th>
                <th scope="col">Pergeseran</th>
                <th scope="col">Nilai yang diuji</th>
                <th scope="col">NPV ({c})</th>
                <th scope="col">IRR</th>
                <th scope="col">Payback</th>
              </tr>
            </thead>
            <tbody>
              {view.details.map((d) => (
                <tr key={d.key}>
                  <th scope="row">{d.label}</th>
                  <td>{d.shift}</td>
                  <td>{d.input}</td>
                  <td>{d.npv}</td>
                  <td>{d.irr}</td>
                  <td>{d.payback}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="note sec">{view.disclaimer} {view.provenance}</p>
    </>
  );
}
