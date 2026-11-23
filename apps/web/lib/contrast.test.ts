import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Pagar kontras: membaca token warna langsung dari app/globals.css, jadi mengubah warna
// tanpa menghitung ulang akan membuat tes ini gagal. Rumus WCAG 2.x, rasio tidak dibulatkan.
const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([a-z]+):(#[0-9a-fA-F]{3,6})/g)].map((m) => [m[1], m[2]]));
}

const lightBlock = css.slice(css.indexOf(":root{"), css.indexOf("}", css.indexOf(":root{")));
const darkStart = css.indexOf("prefers-color-scheme:dark");
const darkBlock = css.slice(css.indexOf(":root{", darkStart), css.indexOf("}", css.indexOf(":root{", darkStart)));
const light = tokens(lightBlock);
const dark = { ...light, ...tokens(darkBlock) };

function channel(c: number) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string) {
  const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join("") : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [warna depan, latar]: teks biasa, minimal 4,5:1.
const TEXT: [string, string][] = [
  ["text", "bg"], ["text", "surface"], ["text", "errbg"], ["text", "warnbg"],
  ["muted", "bg"], ["muted", "surface"],
  ["navytext", "bg"], ["navytext", "surface"],
  ["accent", "bg"], ["accent", "surface"],
  ["onnavy", "navy"], ["btntext", "btn"], ["btntext", "btnhover"],
  ["errtext", "errbg"], ["errtext", "surface"],
];

// Batas input dan tombol, cincin fokus, garis grafik, batas isian galat: minimal 3:1.
const NON_TEXT: [string, string][] = [
  ["field", "bg"], ["field", "surface"],
  ["accent", "bg"], ["accent", "surface"],
  ["errtext", "bg"], ["errtext", "surface"],
  ["btn", "bg"], ["btn", "surface"], ["btnhover", "surface"],
];

describe.each([["terang", light], ["gelap", dark]] as const)("kontras mode %s", (_mode, t) => {
  it("token dasar terbaca dari globals.css", () => {
    for (const k of ["bg", "surface", "text", "muted", "accent", "field", "errtext", "errbg"]) expect(t[k]).toBeDefined();
  });
  it.each(TEXT)("teks %s di atas %s minimal 4,5:1", (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(NON_TEXT)("non-teks %s terhadap %s minimal 3:1", (fg, bg) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(3);
  });
});

describe("pembaca kontras", () => {
  it("cocok dengan nilai acuan", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(ratio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(ratio("#777777", "#ffffff")).toBeLessThan(4.5);
  });
});
