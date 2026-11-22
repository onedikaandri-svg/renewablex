import { describe, expect, it } from "vitest";
import { translateDetailText, translateIssue, type ApiIssue } from "./errors-id";

const issue = (type: string, msg: string, ctx?: Record<string, unknown>): ApiIssue => ({
  type,
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

describe("value_error kustom mesin", () => {
  const ve = (msg: string) => translateIssue(issue("value_error", `Value error, ${msg}`));

  it("hitung ganda loss pada yield bersih", () => {
    expect(ve("performance_loss_fraction must be 0 when the yield is already net, or losses count twice.")).toBe(
      "Yield bersih sudah memperhitungkan loss, jadi performance loss harus 0 agar loss tidak terhitung dua kali.",
    );
  });
  it("location_based belum tersedia", () => {
    expect(ve("location_based needs a configured resource provider. Use manual_specific_yield.")).toContain("location_based");
  });
  it("hanya fixed_tariff", () => {
    expect(ve("Only fixed_tariff is supported in this version.")).toBe(
      "Saat ini hanya pendapatan dengan tarif tetap (fixed_tariff) yang didukung.",
    );
  });
  it("yield manual wajib diisi", () => {
    expect(ve("specific_yield_kwh_per_kwp_year is required for manual_specific_yield.")).toBe(
      "Yield spesifik wajib diisi untuk metode yield manual.",
    );
  });
  it("teks tidak dikenal ditampilkan apa adanya", () => {
    expect(ve("sesuatu yang baru")).toBe("Value error, sesuatu yang baru");
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
