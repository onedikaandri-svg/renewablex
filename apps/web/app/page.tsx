"use client";

import { useEffect, useState } from "react";
import Results from "@/components/Results";
import ScreeningForm from "@/components/ScreeningForm";
import { ApiError, runPreliminary, type PVResponse } from "@/lib/api";
import { buildRequest, DEFAULTS, EMPTY, idOf, labelOf, type Values } from "@/lib/form";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "invalid"; messages: string[] }
  | { kind: "failed"; message: string }
  | { kind: "done"; res: PVResponse };

export default function Page() {
  const [values, setValues] = useState<Values>(DEFAULTS);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<State>({ kind: "idle" });
  const [slow, setSlow] = useState(false);

  // A free-tier server can take up to a minute to wake, so say so after a few seconds.
  useEffect(() => {
    if (state.kind !== "loading") { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(t);
  }, [state.kind]);

  function reject(fields: Record<string, string>, general: string[]) {
    setErrors(fields);
    setState({ kind: "invalid", messages: [...Object.entries(fields).map(([k, m]) => `${labelOf(k)}: ${m}`), ...general] });
    const first = Object.keys(fields)[0];
    if (first) requestAnimationFrame(() => document.getElementById(idOf(first))?.focus());
  }

  async function submit() {
    const { body, errors: local } = buildRequest(values);
    if (Object.keys(local).length) return reject(local, []);
    setErrors({});
    setState({ kind: "loading" });
    try {
      setState({ kind: "done", res: await runPreliminary(body) });
    } catch (err) {
      if (err instanceof ApiError) reject(err.problems.fields, err.problems.general);
      else setState({ kind: "failed", message: err instanceof Error ? err.message : "Terjadi kesalahan." });
    }
  }

  return (
    <>
      <h1>Screening PV: Hitung Energi, NPV, IRR, dan Payback</h1>
      <p className="lead">Isi asumsi proyek, lalu lihat arus kas selama umur proyek. Hasilnya estimasi pendahuluan, sebelum pajak dan tanpa pendanaan.</p>
      <div className="grid">
        <section className="card" aria-labelledby="h-in">
          <p className="eyebrow">Langkah 1</p>
          <h2 id="h-in">Asumsi Proyek: Masukkan Data Anda</h2>
          <p className="note">Form terisi contoh ilustratif dari <code>examples/sample-pv-project.json</code>. Bukan benchmark dan bukan rekomendasi investasi.</p>
          <ScreeningForm
            values={values}
            errors={errors}
            busy={state.kind === "loading"}
            onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))}
            onSubmit={submit}
            onReset={() => { setValues(EMPTY); setErrors({}); setState({ kind: "idle" }); requestAnimationFrame(() => document.getElementById("project-project_name")?.focus()); }}
          />
        </section>
        <section aria-labelledby="h-out">
          <p className="eyebrow">Langkah 2</p>
          <h2 id="h-out">Hasil: Arus Kas Selama Umur Proyek</h2>
          <div aria-live="polite">
            {state.kind === "idle" && (
              <div className="state"><h3>Belum ada hasil</h3><p>Periksa asumsi di form, lalu tekan &ldquo;Hitung Estimasi&rdquo;. Hasil muncul di sini.</p></div>
            )}
            {state.kind === "loading" && (
              <div className="state" role="status">
                <p>Menghitung arus kas&hellip;</p>
                {slow && <p className="note">Mesin hitung sedang bangun. Ini bisa sampai satu menit pada pemakaian pertama.</p>}
              </div>
            )}
            {state.kind === "invalid" && (
              <div className="state bad" role="alert">
                <h3>Input belum valid</h3>
                <ul>{state.messages.map((m) => <li key={m}>{m}</li>)}</ul>
                <p>Perbaiki kolom bertanda, lalu tekan &ldquo;Hitung Estimasi&rdquo; lagi.</p>
              </div>
            )}
            {state.kind === "failed" && (
              <div className="state bad" role="alert">
                <h3>Mesin hitung tidak bisa dijangkau</h3>
                <p>{state.message} Coba lagi sebentar lagi. Isian Anda tidak hilang.</p>
              </div>
            )}
            {state.kind === "done" && <Results res={state.res} />}
          </div>
        </section>
      </div>
      <p className="src">
        Sumber: asumsi dari pengguna. Rumus mengikuti <code>docs/calculation-methodology.md</code> dan dijalankan oleh mesin hitung RenewableX (<code>docs/api.md</code>).
      </p>
    </>
  );
}
