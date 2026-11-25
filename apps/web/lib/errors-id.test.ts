import { describe, expect, it } from "vitest";
import { translateDetailText, translateIssue, type ApiIssue } from "./errors-id";

// Seperti mesin 0.3.0: setiap item punya `code`, dan kode bawaan sama dengan `type`.
const issue = (type: string, msg: string, ctx?: Record<string, unknown>, code: string | null = type): ApiIssue => ({
  type,
  ...(code === null ? {} : { code }),
  loc: ["body", "project", "x"],
  msg,
  ctx,
});

describe("batas numerik", () => {
  it("menyebut batas dengan format Indonesia", () => {
    expect(translateIssue(issue("greater_than", "", { gt: 0 }))).toBe("Harus lebih besar dari 0.");
    expect(translateIssue(issue("greater_than_equal", "", { ge: 1 }))).toBe("Tidak boleh kurang dari 1.");
    expect(translateIssue(issue("less_than", "", { lt: 5 }))).toBe("Harus lebih kecil dari 5.");
    expect(translateIssue(issue("less_than_equal", "", { le: 10000000 }))).toBe("Tidak boleh lebih dari 10.000.000.");
    expect(translateIssue(issue("less_than_equal", "", { le: 0.5 }))).toBe("Tidak boleh lebih dari 0,5.");
  });

  it("menerima batas berupa string (Decimal)", () => {
    expect(translateIssue(issue("less_than_equal", "", { le: "40" }))).toBe("Tidak boleh lebih dari 40.");
  });

  it("isian persen: batas pecahan ditampilkan sebagai persen", () => {
    expect(translateIssue(issue("less_than", "", { lt: 1 }), { percent: true })).toBe("Harus lebih kecil dari 100%.");
    expect(translateIssue(issue("greater_than", "", { gt: -1 }), { percent: true })).toBe("Harus lebih besar dari -100%.");
    expect(translateIssue(issue("less_than_equal", "", { le: 0.1 }), { percent: true })).toBe("Tidak boleh lebih dari 10%.");
  });

  it("tanpa batas di ctx, teks asli dipakai", () => {
    expect(translateIssue(issue("less_than_equal", "Input should be less than or equal to 40"))).toBe(
      "Input should be less than or equal to 40",
    );
  });
});

describe("tipe lain", () => {
  it("missing dan parsing", () => {
    expect(translateIssue(issue("missing", "Field required"))).toBe("Wajib diisi.");
    expect(translateIssue(issue("int_parsing", ""))).toBe("Harus berupa bilangan bulat.");
    expect(translateIssue(issue("float_parsing", ""))).toBe("Harus berupa angka.");
    expect(translateIssue(issue("int_from_float", ""))).toBe("Harus berupa bilangan bulat tanpa pecahan.");
  });

  it("string_pattern_mismatch", () => {
    expect(translateIssue(issue("string_pattern_mismatch", "", { pattern: "^[A-Z]{2}$" }))).toBe(
      "Harus 2 huruf kapital (A sampai Z).",
    );
    expect(translateIssue(issue("string_pattern_mismatch", "", { pattern: "^[A-Z]{3}$" }))).toBe(
      "Harus 3 huruf kapital (A sampai Z).",
    );
    expect(translateIssue(issue("string_pattern_mismatch", "", { pattern: "^\\d+$" }))).toBe(
      "Format tidak sesuai pola ^\\d+$.",
    );
  });

  it("literal_error", () => {
    expect(
      translateIssue(issue("literal_error", "", { expected: "'ground_mounted', 'rooftop', 'floating' or 'carport'" })),
    ).toBe("Harus salah satu dari: ground_mounted, rooftop, floating, carport.");
    expect(translateIssue(issue("literal_error", "", { expected: "'solar_pv'" }))).toBe("Harus salah satu dari: solar_pv.");
  });

  it("panjang teks", () => {
    expect(translateIssue(issue("string_too_short", "", { min_length: 1 }))).toBe("Minimal 1 karakter.");
    expect(translateIssue(issue("string_too_long", "", { max_length: 120 }))).toBe("Maksimal 120 karakter.");
  });
});

describe("kode buatan mesin (code)", () => {
  // Teks msg sengaja diganti: terjemahan harus mengikuti `code`, bukan teks.
  const byCode = (code: string, msg = "teks apa pun") => translateIssue(issue("value_error", msg, undefined, code));

  it("double_counted_loss", () => {
    expect(byCode("double_counted_loss")).toBe(
      "Yield bersih sudah memperhitungkan loss, jadi performance loss harus 0 agar loss tidak terhitung dua kali.",
    );
  });
  it("location_based_unavailable", () => {
    expect(byCode("location_based_unavailable")).toContain("location_based");
  });
  it("yield_required", () => {
    expect(byCode("yield_required")).toBe("Yield spesifik wajib diisi untuk metode yield manual.");
  });
  it("unsupported_revenue_method", () => {
    expect(byCode("unsupported_revenue_method")).toBe(
      "Saat ini hanya pendapatan dengan tarif tetap (fixed_tariff) yang didukung.",
    );
  });
  it("non_finite_result", () => {
    expect(byCode("non_finite_result")).toBe(
      "Hasil perhitungan bukan angka yang terhingga. Periksa lagi nilai yang sangat ekstrem.",
    );
  });
  it("code mengalahkan teks: msg yang mirip kode lain tidak menyesatkan", () => {
    expect(byCode("yield_required", "Value error, Only fixed_tariff is supported in this version.")).toBe(
      "Yield spesifik wajib diisi untuk metode yield manual.",
    );
  });
  it("code tidak dikenal: teks asli, tanpa mencocokkan potongan teks", () => {
    expect(byCode("kode_baru", "Value error, Only fixed_tariff is supported in this version.")).toBe(
      "Value error, Only fixed_tariff is supported in this version.",
    );
  });
});

describe("kode endpoint sensitivitas", () => {
  const byCode = (code: string, msg: string) => translateIssue(issue("value_error", msg, undefined, code));

  it("shift_out_of_range: kalimat jelas, bukan teks Inggris", () => {
    const text = byCode("shift_out_of_range", "A shift of +20% moves specific_yield outside its allowed range.");
    expect(text).toContain("salah satu pergeseran");
    expect(text).toContain("melewati batas");
  });
  it("shift_out_of_bounds, duplicate_variables, duplicate_shifts", () => {
    expect(byCode("shift_out_of_bounds", "Value error, x")).toBe("Pergeseran harus berada antara -90% dan +100%, dan tidak boleh 0%.");
    expect(byCode("duplicate_variables", "Value error, x")).toBe("Daftar asumsi yang digeser tidak boleh berulang.");
    expect(byCode("duplicate_shifts", "Value error, x")).toBe("Daftar pergeseran tidak boleh berulang.");
  });
});

describe("cadangan untuk item tanpa code", () => {
  const noCode = (msg: string) => translateIssue(issue("value_error", `Value error, ${msg}`, undefined, null));

  it("hitung ganda loss", () => {
    expect(noCode("performance_loss_fraction must be 0 when the yield is already net, or losses count twice.")).toBe(
      "Yield bersih sudah memperhitungkan loss, jadi performance loss harus 0 agar loss tidak terhitung dua kali.",
    );
  });
  it("location_based, fixed_tariff, dan yield manual", () => {
    expect(noCode("location_based needs a configured resource provider. Use manual_specific_yield.")).toContain("location_based");
    expect(noCode("Only fixed_tariff is supported in this version.")).toContain("tarif tetap");
    expect(noCode("specific_yield_kwh_per_kwp_year is required for manual_specific_yield.")).toContain("wajib diisi");
  });
  it("teks tidak dikenal ditampilkan apa adanya", () => {
    expect(noCode("sesuatu yang baru")).toBe("Value error, sesuatu yang baru");
  });
  it("tipe bawaan tanpa code tetap diterjemahkan lewat type", () => {
    expect(translateIssue(issue("less_than_equal", "", { le: 40 }, null))).toBe("Tidak boleh lebih dari 40.");
  });
  it("tipe tidak dikenal ditampilkan apa adanya", () => {
    expect(translateIssue(issue("extra_forbidden", "Extra inputs are not permitted"))).toBe("Extra inputs are not permitted");
  });
});

describe("detail berupa teks", () => {
  it("menerjemahkan hasil tidak terhingga", () => {
    expect(translateDetailText("The result is not a finite number. Check for extreme inputs.")).toBe(
      "Hasil perhitungan bukan angka yang terhingga. Periksa lagi nilai yang sangat ekstrem.",
    );
  });
  it("teks lain apa adanya", () => {
    expect(translateDetailText("Not Found")).toBe("Not Found");
  });
});