import { GROUPS, idOf, isVisible, type Values } from "@/lib/form";

interface Props {
  values: Values;
  errors: Record<string, string>;
  busy: boolean;
  onChange: (key: string, value: string) => void;
  onSubmit: () => void;
  onReset: () => void;
}

export default function ScreeningForm({ values, errors, busy, onChange, onSubmit, onReset }: Props) {
  return (
    <form noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) onSubmit(); }}>
      {GROUPS.map((g) => (
        <fieldset key={g.title}>
          <legend>{g.title}</legend>
          {g.fields.filter((f) => isVisible(f, values)).map((f) => {
            const id = idOf(f.key);
            const err = errors[f.key];
            const common = {
              id,
              name: id,
              value: values[f.key] ?? "",
              "aria-required": true,
              "aria-invalid": err ? true : false,
              "aria-describedby": `e-${id}`,
            };
            return (
              <div className="fld" key={f.key}>
                <label htmlFor={id}>
                  {f.label}
                  {f.unit && <> <span className="unit">({f.unit})</span></>}
                </label>
                {f.kind === "select" ? (
                  <select {...common} onChange={(e) => onChange(f.key, e.target.value)}>
                    {f.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ) : (
                  <input
                    {...common}
                    type={f.kind}
                    inputMode={f.kind === "number" ? "decimal" : undefined}
                    step={f.kind === "number" ? "any" : undefined}
                    onChange={(e) => onChange(f.key, e.target.value)}
                  />
                )}
                {err && <p className="err" id={`e-${id}`}>{err}</p>}
              </div>
            );
          })}
        </fieldset>
      ))}
      <div className="row">
        <button className="btn primary" type="submit" aria-disabled={busy}>
          {busy ? "Menghitung..." : "Hitung Estimasi"}
        </button>
        <button className="btn ghost" type="button" aria-disabled={busy} onClick={() => { if (!busy) onReset(); }}>
          Kosongkan Form
        </button>
      </div>
    </form>
  );
}
