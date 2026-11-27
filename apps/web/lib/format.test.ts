import { describe, expect, it } from "vitest";
import { disclaimerId, fixed, fmt, formatNumber, localeFor, money, slowEngineNoteFor } from "./format";
import { tr } from "./preferences";

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
  it("mendukung 3 bahasa (en default, id, ja) untuk tr, localeFor, formatNumber, dan slowEngineNoteFor", () => {
    expect(localeFor("en")).toBe("en-US");
    expect(localeFor("id")).toBe("id-ID");
    expect(localeFor("ja")).toBe("ja-JP");

    expect(tr("en", "Run Simulation", "Gas Jalankan Simulasi", "シミュレーションを実行")).toBe("Run Simulation");
    expect(tr("id", "Run Simulation", "Gas Jalankan Simulasi", "シミュレーションを実行")).toBe("Gas Jalankan Simulasi");
    expect(tr("ja", "Run Simulation", "Gas Jalankan Simulasi", "シミュレーションを実行")).toBe("シミュレーションを実行");

    expect(formatNumber(12500, "en", 0)).toBe("12,500");
    expect(formatNumber(12500, "id", 0)).toBe("12.500");
    expect(formatNumber(12500, "ja", 0)).toBe("12,500");

    expect(slowEngineNoteFor("en")).toContain("50 seconds");
    expect(slowEngineNoteFor("id")).toContain("bangun dari mode tidur");
    expect(slowEngineNoteFor("ja")).toContain("50秒");
  });
});
