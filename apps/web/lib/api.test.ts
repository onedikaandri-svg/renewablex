import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, parseProblems, runPreliminary } from "./api";
import type { ApiIssue } from "./errors-id";

// Bentuk item galat diambil dari respons 422 asli mesin hitung (FastAPI + Pydantic v2),
// tanpa kolom `input`. Satu baris per batas di docs/api.md.
const bound = (section: string, field: string, type: string, key: string, value: number) => ({
  type,
  code: type,
  loc: ["body", section, field],
  msg: "Input should be ...",
  ctx: { [key]: value },
});

const LIMITS: [string, ReturnType<typeof bound>, string][] = [
  ["capacity_kwp gt 0", bound("project", "capacity_kwp", "greater_than", "gt", 0), "Harus lebih besar dari 0."],
  ["capacity_kwp le 10 juta", bound("project", "capacity_kwp", "less_than_equal", "le", 1e7), "Tidak boleh lebih dari 10.000.000."],
  ["lifetime_years ge 1", bound("project", "lifetime_years", "greater_than_equal", "ge", 1), "Tidak boleh kurang dari 1."],
  ["lifetime_years le 40", bound("project", "lifetime_years", "less_than_equal", "le", 40), "Tidak boleh lebih dari 40."],
  ["yield gt 0", bound("technical", "specific_yield_kwh_per_kwp_year", "greater_than", "gt", 0), "Harus lebih besar dari 0."],
  ["yield le 10000", bound("technical", "specific_yield_kwh_per_kwp_year", "less_than_equal", "le", 1e4), "Tidak boleh lebih dari 10.000."],
  ["loss ge 0", bound("technical", "performance_loss_fraction", "greater_than_equal", "ge", 0), "Tidak boleh kurang dari 0%."],
  ["loss lt 1", bound("technical", "performance_loss_fraction", "less_than", "lt", 1), "Harus lebih kecil dari 100%."],
  ["degradasi ge 0", bound("technical", "degradation_fraction_per_year", "greater_than_equal", "ge", 0), "Tidak boleh kurang dari 0%."],
  ["degradasi lt 1", bound("technical", "degradation_fraction_per_year", "less_than", "lt", 1), "Harus lebih kecil dari 100%."],
  ["capex ge 0", bound("financial", "capex_amount", "greater_than_equal", "ge", 0), "Tidak boleh kurang dari 0."],
  ["capex le 1e18", bound("financial", "capex_amount", "less_than_equal", "le", 1e18), "Tidak boleh lebih dari 1.000.000.000.000.000.000."],
  ["opex ge 0", bound("financial", "annual_opex_amount", "greater_than_equal", "ge", 0), "Tidak boleh kurang dari 0."],
  ["opex le 1e18", bound("financial", "annual_opex_amount", "less_than_equal", "le", 1e18), "Tidak boleh lebih dari 1.000.000.000.000.000.000."],
  ["tarif ge 0", bound("financial", "tariff_per_kwh", "greater_than_equal", "ge", 0), "Tidak boleh kurang dari 0."],
  ["tarif le 1e9", bound("financial", "tariff_per_kwh", "less_than_equal", "le", 1e9), "Tidak boleh lebih dari 1.000.000.000."],
  ["discount gt -1", bound("financial", "discount_rate_fraction", "greater_than", "gt", -1), "Harus lebih besar dari -100%."],
  ["discount le 1", bound("financial", "discount_rate_fraction", "less_than_equal", "le", 1), "Tidak boleh lebih dari 100%."],
  ["eskalasi tarif gt -1", bound("financial", "annual_tariff_escalation_fraction", "greater_than", "gt", -1), "Harus lebih besar dari -100%."],
  ["eskalasi tarif le 1", bound("financial", "annual_tariff_escalation_fraction", "less_than_equal", "le", 1), "Tidak boleh lebih dari 100%."],
  ["eskalasi opex gt -1", bound("financial", "annual_opex_escalation_fraction", "greater_than", "gt", -1), "Harus lebih besar dari -100%."],
  ["eskalasi opex le 1", bound("financial", "annual_opex_escalation_fraction", "less_than_equal", "le", 1), "Tidak boleh lebih dari 100%."],
];

describe("parseProblems: setiap batas di docs/api.md", () => {
  it.each(LIMITS)("%s", (_name, item, expected) => {
    const key = `${item.loc[1]}.${item.loc[2]}`;
    const p = parseProblems([item]);
    expect(p.fields[key]).toBe(expected);
    expect(p.general).toEqual([]);
  });
});

describe("parseProblems: bentuk lain dari mesin", () => {
  // Item asli dari mesin 0.3.0 (kolom `code`, tanpa `ctx` untuk galat kustom).
  const CUSTOM: [string, ApiIssue, string][] = [
    ["location_based_unavailable", { type: "value_error", code: "location_based_unavailable", loc: ["body", "technical"], msg: "Value error, location_based needs a configured resource provider. Use manual_specific_yield." }, "Mode berbasis lokasi (location_based) belum tersedia. Isi yield spesifik secara manual."],
    ["yield_required", { type: "value_error", code: "yield_required", loc: ["body", "technical"], msg: "Value error, specific_yield_kwh_per_kwp_year is required for manual_specific_yield." }, "Yield spesifik wajib diisi untuk metode yield manual."],
    ["double_counted_loss", { type: "value_error", code: "double_counted_loss", loc: ["body", "technical"], msg: "Value error, performance_loss_fraction must be 0 when the yield is already net, or losses count twice." }, "Yield bersih sudah memperhitungkan loss, jadi performance loss harus 0 agar loss tidak terhitung dua kali."],
    ["unsupported_revenue_method", { type: "value_error", code: "unsupported_revenue_method", loc: ["body", "financial"], msg: "Value error, Only fixed_tariff is supported in this version." }, "Saat ini hanya pendapatan dengan tarif tetap (fixed_tariff) yang didukung."],
    ["non_finite_result", { type: "value_error", code: "non_finite_result", loc: ["body"], msg: "The result is not a finite number. Check for extreme inputs." }, "Hasil perhitungan bukan angka yang terhingga. Periksa lagi nilai yang sangat ekstrem."],
  ];

  it.each(CUSTOM)("kode %s tingkat bagian masuk ke general", (_code, item, expected) => {
    const p = parseProblems([item]);
    expect(p.fields).toEqual({});
    expect(p.general).toEqual([expected]);
    expect(p.issues[0].code).toBe(item.code);
  });

  it("item tanpa code (mesin lama) tetap diterjemahkan lewat teks", () => {
    const p = parseProblems([
      { type: "value_error", loc: ["body", "financial"], msg: "Value error, Only fixed_tariff is supported in this version.", ctx: { error: {} } },
    ]);
    expect(p.general).toEqual(["Saat ini hanya pendapatan dengan tarif tetap (fixed_tariff) yang didukung."]);
  });

  it("detail berupa teks dari HTTPException", () => {
    const p = parseProblems("The result is not a finite number. Check for extreme inputs.");
    expect(p.general).toEqual(["Hasil perhitungan bukan angka yang terhingga. Periksa lagi nilai yang sangat ekstrem."]);
  });

  it("beberapa galat sekaligus, type dan ctx disimpan utuh", () => {
    const items = [
      { type: "missing", code: "missing", loc: ["body", "financial", "capex_amount"], msg: "Field required" },
      { type: "string_pattern_mismatch", code: "string_pattern_mismatch", loc: ["body", "project", "currency_code"], msg: "x", ctx: { pattern: "^[A-Z]{3}$" } },
    ];
    const p = parseProblems(items);
    expect(p.fields["financial.capex_amount"]).toBe("Wajib diisi.");
    expect(p.fields["project.currency_code"]).toBe("Harus 3 huruf kapital (A sampai Z).");
    expect(p.issues).toEqual(items);
  });

  it("bentuk tak terduga tidak membuat galat baru", () => {
    expect(parseProblems({ foo: 1 }).general).toEqual(["Input tidak valid."]);
    expect(parseProblems([{ nope: true }]).general).toEqual(["Input tidak valid."]);
  });
});

describe("runPreliminary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("422 menjadi ApiError berisi pesan Indonesia dan item asli", async () => {
    const detail = [bound("project", "lifetime_years", "less_than_equal", "le", 40)];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail }), { status: 422 })));
    const err = await runPreliminary({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const problems = (err as ApiError).problems;
    expect(problems.fields["project.lifetime_years"]).toBe("Tidak boleh lebih dari 40.");
    expect(problems.issues[0].ctx).toEqual({ le: 40 });
  });
});
