"use client";

import { useEffect, useState } from "react";
import Results from "@/components/Results";
import ScreeningForm from "@/components/ScreeningForm";
import Sensitivity from "@/components/Sensitivity";
import { ApiError, runPreliminary, type PVResponse } from "@/lib/api";
import { buildRequest, byVisualOrder, DEFAULTS, EMPTY, idOf, labelOf, type Values } from "@/lib/form";
import { slowEngineNoteFor } from "@/lib/format";
import { tr, usePreferences } from "@/lib/preferences";

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
  const { lang } = usePreferences();
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
      else setState({ kind: "failed", message: err instanceof Error ? err.message : tr(lang, "An error occurred.", "Ada kendala saat menghitung.", "エラーが発生しました。") });
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>
          {tr(
            lang,
            "Quick PV Screening: Energy, NPV, IRR & Payback",
            "Screening Cepat PLTS: Hitung Energi, NPV, IRR & Balik Modal",
            "太陽光発電 (PV) 簡易試算: 発電量・NPV・IRR・回収期間",
          )}
        </h1>
        <p className="lead">
          {tr(
            lang,
            "Enter your project assumptions to inspect lifetime cash flows. Results are preliminary pre-tax, unlevered estimates.",
            "Masukkan asumsi proyek buat cek arus kas sepanjang umur PLTS. Hasilnya berupa estimasi awal sebelum pajak dan tanpa skema pinjaman.",
            "プロジェクトの前提条件を入力し、事業期間にわたるキャッシュフローを試算します（税引前・自己資本100%ベースの初期試算）。",
          )}
        </p>
      </div>

      <div className="grid">
        <section className="card" aria-labelledby="h-in">
          <p className="eyebrow">{tr(lang, "Step 1", "Langkah 1", "ステップ 1")}</p>
          <h2 id="h-in">{tr(lang, "Project Assumptions", "Asumsi Proyek", "プロジェクト前提条件")}</h2>
          <p className="note">
            {tr(
              lang,
              <>Pre-filled with illustrative sample values from <code>examples/sample-pv-project.json</code>. Not a benchmark or investment recommendation.</>,
              <>Form sudah terisi angka contoh dari <code>examples/sample-pv-project.json</code> biar langsung siap dicoba. Bukan patokan baku atau saran investasi.</>,
              <><code>examples/sample-pv-project.json</code> のサンプル値が初期入力されています（投資推奨値やベンチマークではありません）。</>,
            )}
          </p>
          <p className="note">{tr(lang, "All fields are required.", "Semua kolom wajib diisi ya.", "すべての項目が必須です。")}</p>
          <ScreeningForm
            values={values}
            errors={errors}
            busy={state.kind === "loading"}
            onChange={(k, v) => setValues((p) => ({ ...p, [k]: v }))}
            onSubmit={submit}
            onReset={() => {
              setValues(EMPTY);
              setErrors({});
              setState({ kind: "idle" });
              setNotice(tr(lang, "Form cleared.", "Sip, form sudah dikosongkan.", "フォームをクリアしました。"));
              focusFirst("project-project_name");
            }}
          />
        </section>

        <section aria-labelledby="h-out">
          <p className="eyebrow">{tr(lang, "Step 2", "Langkah 2", "ステップ 2")}</p>
          <h2 id="h-out" tabIndex={-1}>
            {tr(lang, "Financial Results & Cash Flow", "Hasil Analisis & Arus Kas", "試算結果・キャッシュフロー")}
          </h2>
          <div className="status" role="status">
            {state.kind === "loading" && (
              <div className="state">
                <p>{tr(lang, "Calculating cash flows...", "Lagi menghitung arus kas...", "キャッシュフローを計算中...")}</p>
                {slow && (
                  <div style={{ marginTop: "1rem", padding: "1rem", backgroundColor: "var(--surface-subtle)", borderRadius: "var(--radius-md)" }}>
                    <p className="note" style={{ color: "var(--text)", fontWeight: 600 }}>
                      {tr(lang, "The calculation engine is waking up.", "Mesin hitung lagi bangun dari mode tidur.", "計算エンジンを起動しています。")}
                    </p>
                    <p className="note">{slowEngineNoteFor(lang)}</p>
                  </div>
                )}
              </div>
            )}
            {state.kind !== "loading" && notice && <p className="note">{notice}</p>}
          </div>
          
          {state.kind === "idle" && (
            <div className="state">
              <h3>{tr(lang, "No results yet", "Belum ada hasil hitungan", "まだ試算結果がありません")}</h3>
              <p>
                {tr(
                  lang,
                  'Check the assumptions on the left and press "Calculate Estimate" to view results here.',
                  'Cek asumsi di kiri, lalu klik "Hitung Estimasi". Hasilnya langsung muncul di sini!',
                  '左側の前提条件を確認し、「試算を実行」を押すとここに結果が表示されます。',
                )}
              </p>
            </div>
          )}
          {state.kind === "invalid" && (
            <div className="state bad" role="alert" id="invalid-box" tabIndex={-1}>
              <h3>{tr(lang, "Invalid input values", "Ada isian yang belum pas", "入力内容にエラーがあります")}</h3>
              <ul>{state.messages.map((m) => <li key={m}>{m}</li>)}</ul>
              <p>
                {tr(
                  lang,
                  'Fix the highlighted fields and press "Calculate Estimate" again.',
                  'Perbaiki kolom yang ditandai, terus klik "Hitung Estimasi" lagi ya.',
                  '赤枠の項目を修正してから、もう一度「試算を実行」を押してください。',
                )}
              </p>
            </div>
          )}
          {state.kind === "failed" && (
            <div className="state bad" role="alert">
              <h3>{tr(lang, "Calculation engine unreachable", "Mesin hitung belum bisa dihubungi", "計算エンジンに接続できません")}</h3>
              <p>
                {state.message}{" "}
                {tr(
                  lang,
                  "Please try again in a moment. Your inputs are preserved.",
                  "Coba lagi sebentar lagi ya, isian form kamu aman kok tidak hilang.",
                  "しばらくしてから再度お試しください。入力内容は保持されています。",
                )}
              </p>
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
        {tr(
          lang,
          <>Source: user-supplied assumptions. Formulas follow <code>docs/calculation-methodology.md</code> and run on the RenewableX calculation engine (<code>docs/api.md</code>).</>,
          <>Sumber: asumsi input pengguna. Rumus mengacu ke <code>docs/calculation-methodology.md</code> dan dihitung langsung oleh mesin backend RenewableX (<code>docs/api.md</code>).</>,
          <>出典: ユーザー入力条件。計算式は <code>docs/calculation-methodology.md</code> に準拠し、RenewableX 計算エンジン (<code>docs/api.md</code>) で実行されます。</>,
        )}
      </p>
    </>
  );
}
