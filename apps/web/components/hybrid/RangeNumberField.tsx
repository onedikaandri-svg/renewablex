"use client";

export default function RangeNumberField({
  id,
  label,
  unit,
  value,
  min,
  max,
  step,
  error,
  onChange,
}: {
  id: string;
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  error?: string;
  onChange: (nextValue: number) => void;
}) {
  const sliderVal = Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);

  return (
    <div className="fld">
      <div className="label-row">
        <label htmlFor={id}>{label}</label>
        {unit && <span className="unit">{unit}</span>}
      </div>
      <input
        id={id}
        type="number"
        className="tabular-nums"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        step="any"
        aria-invalid={error ? "true" : undefined}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed)) onChange(parsed);
        }}
      />
      <input
        type="range"
        className="range-slider"
        aria-label={`${label} slider`}
        min={min}
        max={max}
        step={step}
        value={sliderVal}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {error && <p className="err">{error}</p>}
    </div>
  );
}
