import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

// Membaca berkas globals.css dari folder app
const cssPath = path.resolve(__dirname, "../app/globals.css");
const css = fs.readFileSync(cssPath, "utf-8");

function extractVars(cssContent: string, isDark: boolean): Record<string, string> {
  const vars: Record<string, string> = {};
  let targetBlock = cssContent;

  if (isDark) {
    // Mengambil blok :root di dalam prefers-color-scheme: dark
    const darkMatch = cssContent.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*{\s*:root\s*{([^}]+)}/);
    if (darkMatch) targetBlock = darkMatch[1];
    else return {};
  } else {
    // Mengambil blok :root pertama (mode terang)
    const lightMatch = cssContent.match(/:root\s*{([^}]+)}/);
    if (lightMatch) targetBlock = lightMatch[1];
    else return {};
  }

  // Regex yang tahan terhadap spasi dan baris baru (format Stripe Modern)
  const regex = /--([\w-]+):\s*([^;]+);/g;
  let match;
  while ((match = regex.exec(targetBlock)) !== null) {
    vars[match[1]] = match[2].trim();
  }
  return vars;
}

const light = extractVars(css, false);
const dark = extractVars(css, true);

function luminance(hex: string) {
  const h = hex.length === 4 ? [...hex.slice(1)].map((c) => c + c).join("") : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fg: string, bg: string) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

const TEXT = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "errbg"],
  ["text", "warnbg"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["navytext", "bg"],
  ["navytext", "surface"],
  ["accent", "bg"],
  ["accent", "surface"],
  ["onnavy", "navy"],
  ["btntext", "btn"],
  ["btntext", "btnhover"],
  ["errtext", "errbg"],
  ["errtext", "surface"],
];

const NON_TEXT = [
  ["field", "bg"],
  ["field", "surface"],
  ["accent", "bg"],
  ["accent", "surface"],
  ["errtext", "bg"],
  ["errtext", "surface"],
  ["btn", "bg"],
  ["btn", "surface"],
  ["btnhover", "surface"],
];

describe.each([["terang", light], ["gelap", dark]] as const)("kontras mode %s", (_, vars) => {
  it("token dasar terbaca dari globals.css", () => {
    const required = ["bg", "surface", "text", "muted", "navy", "navytext", "accent", "field", "errtext", "warnbg", "btn", "btnhover", "btntext"];
    for (const k of required) {
      expect(vars[k], `Token --${k} tidak ditemukan di mode ${_}`).toBeDefined();
    }
  });

  it.each(TEXT)("teks %s di atas %s minimal 4,5:1", (fg, bg) => {
    expect(ratio(vars[fg], vars[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT)("non-teks %s terhadap %s minimal 3:1", (fg, bg) => {
    expect(ratio(vars[fg], vars[bg])).toBeGreaterThanOrEqual(3);
  });
});

describe("pembaca kontras", () => {
  it("cocok dengan nilai acuan", () => {
    // Putih vs Hitam adalah 21:1
    expect(ratio("#FFFFFF", "#000000")).toBeCloseTo(21, 0);
  });
});
