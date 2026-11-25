import { describe, expect, it } from "vitest";
import { disclaimerId, fixed, fmt, money } from "./format";

describe("format", () => {
  it("fmt dan money tidak berubah", () => {
    expect(fmt(1470000)).toBe("1.470.000");
    expect(fmt(10.86, 1)).toBe("10,9");
    expect(money(784492869.07, "IDR")).toBe("0,78 miliar IDR");
  });
  it("fixed memakai jumlah desimal tetap", () => {
    expect(fixed(2.4, 2)).toBe("2,40");
    expect(fixed(0, 1)).toBe("0,0");
  });
  it("disclaimerId berdasarkan scope, selalu berbahasa Indonesia", () => {
    expect(disclaimerId("pre_tax_unlevered")).toBe(
      "Estimasi pendahuluan, sebelum pajak dan tanpa pendanaan. Periksa ulang semua asumsi secara mandiri.",
    );
    expect(disclaimerId("scope_baru")).toBe("Estimasi pendahuluan. Periksa ulang semua asumsi secara mandiri.");
  });
});
