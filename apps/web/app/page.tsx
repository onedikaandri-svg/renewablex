"use client";

import { useEffect, useState } from "react";
import Results from "@/components/Results";
import ScreeningForm from "@/components/ScreeningForm";
import Sensitivity from "@/components/Sensitivity";
import { ApiError, runPreliminary, type PVResponse } from "@/lib/api";
import { buildRequest, byVisualOrder, DEFAULTS, EMPTY, idOf, labelOf, type Values } from "@/lib/form";
import { SLOW_ENGINE_NOTE } from "@/lib/format";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "invalid"; messages: string[] }
  | { kind: "failed"; message: string }
  | { kind: "done"; res: PVResponse; body: unknown };

function focusFirst(...ids: string[]) {
  requestAnimationFrame(() => {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) { el.focus(); return; }
    }
  });
}

export default function Page() {
  const [values, setValues] = useState<Values>(DEFAULTS);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<State>({ kind: "idle" });
  const [notice, setNotice] = useState("");
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (state.kind !== "loading") { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 3000); // 3 detik
    return () => clearTimeout(t);
  }, [state.kind]);

  function reject(fields: Record<string, string>, general: string[]) {
    const keys = byVisualOrder(Object.keys(fields));
    setNotice("");
    setErrors(fields);
    setState({ kind: "invalid", messages: [...keys.map((k) => `${labelOf(k)}: ${fields[k]}`), ...general] });
    focusFirst(...keys.map(idOf), "invalid-box");
  }

  async function submit() {
    const { body, errors: local } = buildRequest(values);
    if (Object.keys(local).length) return reject(local, []);
    setErrors({});
    setNotice("");
    setState({ kind: "loading" });
    try {
      setState({ kind: "done", res: await runPreliminary(body), body });
      focusFirst("h-out");
    } catch (err) {
      if (err instanceof ApiError) reject(err.problems.fields, err.problems.general);
      else setState({ kind: "failed", message: err instanceof Error ? err.message : "Terjadi kesalahan." });
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Screening PV: Hitung Energi, NPV, IRR, dan Payback</h1>
        <p className="lead">
          Isi asumsi proyek, lalu lihat arus kas selama umur proyek. Hasilnya estimasi pendahuluan, sebelum pajak dan tanpa pendanaan.
        </p>
      </div>

      <div className="grid">
        <section className="card" aria-labelledby="h-in">
          <p className="eyebrow">Langkah 1</p>
          <h2 id="h-in">Asumsi Proyek</h2>
          <p className="note">Form terisi contoh ilustratif dari <code>examples/sample-pv-project.json</code>. Bukan benchmark dan bukan rekomendasi investasi.</p>
          <p className="note">Semua isian wajib diisi.</p>
          <ScreeningForm
            values={values}
            errors={errors}
            busy={state.kind === "loading"}
            onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))}
            onSubmit={submit}
            onReset={() => { setValues(EMPTY); setErrors({}); setState({ kind: "idle" }); setNotice("Form dikosongkan."); focusFirst("project-project_name"); }}
          />
        </section>

        <section aria-labelledby="h-out">
          <p className="eyebrow">Langkah 2</p>
          <h2 id="h-out" tabIndex={-1}>Hasil Analisis &amp; Arus Kas</h2>
          <div className="status" role="status">
            {state.kind === "loading" && (
              <div className="state">
                <p>Menghitung arus kas&hellip;</p>
                {slow && (
                  <div style={{ marginTop: "1rem", padding: "1rem", backgroundColor: "var(--surface-subtle)", borderRadius: "var(--radius-md)" }}>
                    <p className="note" style={{ color: "var(--text)", fontWeight: 600 }}>Mesin hitung sedang bangun.</p>
                    <p className="note">{SLOW_ENGINE_NOTE}</p>
                    <p className="note">Mohon tunggu, jangan tutup halaman ini. Prosesnya memakan waktu hingga 50 detik.</p>
                  </div>
                )}
              </div>
            )}
            {state.kind !== "loading" && notice && <p className="note">{notice}</p>}
          </div>
          
          {state.kind === "idle" && (
            <div className="state">
              <h3>Belum ada hasil</h3>
              <p>Periksa asumsi di form, lalu tekan &ldquo;Hitung Estimasi&rdquo;. Hasil muncul di sini.</p>
            </div>
          )}
          {state.kind === "invalid" && (
            <div className="state bad" role="alert" id="invalid-box" tabIndex={-1}>
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
          {state.kind === "done" && (
            <>
              <Results res={state.res} />
              <Sensitivity request={state.body} />
            </>
          )}
        </section>
      </div>

      <p className="src">
        Sumber: asumsi dari pengguna. Rumus mengikuti <code>docs/calculation-methodology.md</code> dan dijalankan oleh mesin hitung RenewableX (<code>docs/api.md</code>).
      </p>
    </>
  );
}
