import { afterEach, describe, expect, it, vi } from "vitest";
import { 
  ApiError, 
  NetworkError, 
  parseProblems, 
  runSensitivity, 
  type SensitivityResponse, 
  type SensitivityVariableResult, 
  type SensitivityCase 
} from "./api";
import sampleJson from "./fixtures/sensitivity-sample.json";
import {
  buildSensitivityView,
  formatInput,
  irrText,
  paybackText,
  problemMessages,
  shiftLabel,
  signed,
} from "./sensitivity";

// Respons asli mesin 0.3.0 untuk examples/sample-pv-project.json.
const sample = sampleJson as unknown as SensitivityResponse;
const clone = (): SensitivityResponse => structuredClone(sample);

describe("buildSensitivityView: respons asli", () => {
  const view = buildSensitivityView(sample);

  it("baris mengikuti urutan dari mesin, dengan nama Indonesia dari form", () => {
    expect(view.rows.map((r) => r.variable)).toEqual(["specific_yield", "tariff", "capex", "discount_rate", "opex"]);
    expect(view.rows.map((r) => r.label)).toEqual(["Yield spesifik", "Tarif jual", "CAPEX tahun 0", "Discount rate", "OPEX tahunan"]);
  });

  it("nilai dasar selalu bersatuan", () => {
    expect(view.rows.map((r) => r.baseValue)).toEqual([
      "1.470 kWh/kWp/tahun",
      "1.100 IDR per kWh",
      "12 miliar IDR",
      "10% per tahun",
      "150 juta IDR per tahun",
    ]);
  });

  it("judul kolom pergeseran dan satuan tabel", () => {
    expect(view.shifts).toEqual(["-20%", "-10%", "+10%", "+20%"]);
    expect(view.unit).toBe("miliar");
    expect(view.currency).toBe("IDR");
  });

  it("selisih NPV bertanda, dalam miliar dengan 2 desimal", () => {
    expect(view.rows[0].deltas).toEqual(["-2,83", "-1,41", "+1,41", "+2,83"]);
    expect(view.rows[2].deltas).toEqual(["+2,40", "+1,20", "-1,20", "-2,40"]);
    expect(view.rows[3].deltas).toEqual(["+2,19", "+1,02", "-0,90", "-1,70"]);
    expect(view.rows[4].deltas).toEqual(["+0,27", "+0,14", "-0,14", "-0,27"]);
  });

  it("input_value dibulatkan untuk tampilan (13200000000.000002)", () => {
    const row = view.details.find((d) => d.key === "capex-0.1");
    expect(row?.input).toBe("13,2 miliar IDR");
    expect(row?.shift).toBe("+10%");
  });

  it("rincian dimulai dari hasil dasar, lalu 4 kasus per variabel", () => {
    expect(view.details[0]).toMatchObject({ key: "base", label: "Semua nilai dasar", npv: "0,78 miliar IDR", irr: "10,86%", payback: "8,3 tahun" });
    expect(view.details).toHaveLength(1 + 5 * 4);
  });

  it("tidak ada nilai dasar nol di contoh", () => {
    expect(view.zeroBaseLabels).toEqual([]);
  });

  it("disclaimer ditulis ulang dalam bahasa Indonesia berdasarkan scope", () => {
    expect(view.disclaimer).toContain("sebelum pajak dan tanpa pendanaan");
    expect(view.disclaimer).not.toContain("Preliminary");
    expect(view.provenance).toBe(`Mesin v${sample.engine_version}, metodologi v${sample.methodology_version}, dihitung ${sample.calculated_at}.`);
  });
});

describe("buildSensitivityView: kasus khusus", () => {
  it("nilai dasar 0 (discount rate 0) ditandai dengan catatan, deltanya 0", () => {
    const res = clone();
    const v = res.variables.find((x: SensitivityVariableResult) => x.variable === "discount_rate")!;
    v.base_value = 0;
    v.cases.forEach((c: SensitivityCase) => { c.npv_delta = 0; c.input_value = 0; });
    const view = buildSensitivityView(res);
    expect(view.zeroBaseLabels).toEqual(["Discount rate"]);
    expect(view.rows.find((r) => r.variable === "discount_rate")?.deltas).toEqual(["0,00", "0,00", "0,00", "0,00"]);
    expect(view.rows.find((r) => r.variable === "discount_rate")?.baseValue).toBe("0% per tahun");
  });

  it("selisih kecil memakai satuan juta", () => {
    const res = clone();
    res.variables = res.variables.filter((v: SensitivityVariableResult) => v.variable === "opex");
    const view = buildSensitivityView(res);
    expect(view.unit).toBe("juta");
    expect(view.rows[0].deltas).toEqual(["+272,3", "+136,2", "-136,2", "-272,3"]);
  });

  it("status IRR dan payback tampil sebagai teks, bukan angka kosong", () => {
    const res = clone();
    const c = res.variables[1].cases[0];
    c.project_irr_fraction = null;
    c.irr_status = "no_sign_change";
    c.simple_payback_years = null;
    c.payback_status = "not_recovered";
    const row = buildSensitivityView(res).details.find((d) => d.key === `tariff-${c.shift_fraction}`)!;
    expect(row.irr).toBe("Tidak tersedia: arus kas tidak berganti tanda");
    expect(row.payback).toBe("Belum kembali dalam umur proyek");
  });

  it("tanpa variabel: baris kosong, tanpa galat", () => {
    const res = clone();
    res.variables = [];
    const view = buildSensitivityView(res);
    expect(view.rows).toEqual([]);
    expect(view.shifts).toEqual([]);
    expect(view.unit).toBe("juta");
  });
});

describe("pemformat", () => {
  it("signed: tanda, pembulatan, dan nol tanpa tanda", () => {
    expect(signed(1.234, 2)).toBe("+1,23");
    expect(signed(-1.5, 1)).toBe("-1,5");
    expect(signed(0, 2)).toBe("0,00");
    expect(signed(-0.001, 2)).toBe("0,00");
  });
  it("shiftLabel", () => {
    expect(shiftLabel(0.2)).toBe("+20%");
    expect(shiftLabel(-0.1)).toBe("-10%");
    expect(shiftLabel(0.125)).toBe("+12,5%");
    expect(shiftLabel(0.3)).toBe("+30%");
  });
  it("formatInput membulatkan sisa floating point", () => {
    expect(formatInput("tariff", 1210.0000000000002, "IDR")).toBe("1.210 IDR per kWh");
    expect(formatInput("discount_rate", 0.11, "IDR")).toBe("11% per tahun");
    expect(formatInput("capex", 13200000000.000002, "IDR")).toBe("13,2 miliar IDR");
    expect(formatInput("variabel_baru", 5, "IDR")).toBe("5");
  });
  it("irrText dan paybackText", () => {
    const ok = { npv_amount: 0, project_irr_fraction: 0.1086, irr_status: "ok", simple_payback_years: 8.3478, payback_status: "recovered" } as const;
    expect(irrText(ok)).toBe("10,86%");
    expect(paybackText(ok)).toBe("8,3 tahun");
    expect(irrText({ ...ok, project_irr_fraction: null, irr_status: "ambiguous" })).toContain("lebih dari sekali");
    expect(irrText({ ...ok, project_irr_fraction: null, irr_status: "not_found" })).toContain("-99%");
  });
});

// Item galat asli dari mesin 0.3.0.
const BASE_FIELD = [{ type: "greater_than", code: "greater_than", loc: ["body", "base", "project", "capacity_kwp"], msg: "Input should be greater than 0", ctx: { gt: 0 } }];
const BASE_SECTION = [{ type: "value_error", code: "double_counted_loss", loc: ["body", "base", "technical"], msg: "Value error, performance_loss_fraction must be 0 when the yield is already net, or losses count twice." }];
const SHIFT_RANGE = [{ type: "value_error", code: "shift_out_of_range", loc: ["body", "shifts"], msg: "A shift of +20% moves specific_yield outside its allowed range." }];

describe("galat dari endpoint sensitivitas (loc berawalan body, base)", () => {
  it("isian di dalam base dipetakan ke kolom form yang benar", () => {
    const p = parseProblems(BASE_FIELD, 2);
    expect(p.fields).toEqual({ "project.capacity_kwp": "Harus lebih besar dari 0." });
    expect(p.general).toEqual([]);
  });

  it("galat tingkat bagian di base masuk ke general, bukan kolom palsu base.technical", () => {
    const p = parseProblems(BASE_SECTION, 2);
    expect(p.fields).toEqual({});
    expect(p.general[0]).toContain("tidak terhitung dua kali");
  });

  it("shift_out_of_range dijelaskan dengan kalimat yang jelas, bukan teks Inggris", () => {
    const p = parseProblems(SHIFT_RANGE, 2);
    expect(p.fields).toEqual({});
    expect(p.general[0]).toContain("salah satu pergeseran");
    expect(p.general[0]).not.toContain("A shift of");
  });

  it("problemMessages: isian diurutkan menurut form, memakai nama isian", () => {
    const p = parseProblems(
      [
        { type: "missing", code: "missing", loc: ["body", "base", "financial", "capex_amount"], msg: "Field required" },
        { type: "missing", code: "missing", loc: ["body", "base", "project", "currency_code"], msg: "Field required" },
      ],
      2,
    );
    expect(problemMessages(p)).toEqual(["Mata uang: Wajib diisi.", "CAPEX tahun 0: Wajib diisi."]);
  });
});

describe("runSensitivity", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (impl: () => Promise<Response>) => vi.stubGlobal("fetch", vi.fn(impl));

  it("mengirim base saja ke /v1/pv/sensitivity dan mengembalikan respons", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(sample), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const base = { project: { capacity_kwp: 1000 } };
    const res = await runSensitivity(base);
    expect(res.variables).toHaveLength(5);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/v1/pv/sensitivity")).toBe(true);
    expect(JSON.parse(init.body as string)).toEqual({ base });
  });

  it("422 menjadi ApiError dengan isian base yang dipetakan benar", async () => {
    stub(async () => new Response(JSON.stringify({ detail: BASE_FIELD }), { status: 422 }));
    const err = await runSensitivity({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).problems.fields["project.capacity_kwp"]).toBe("Harus lebih besar dari 0.");
    expect((err as ApiError).problems.issues[0].code).toBe("greater_than");
  });

  it("422 shift_out_of_range menjadi satu kalimat umum yang jelas", async () => {
    stub(async () => new Response(JSON.stringify({ detail: SHIFT_RANGE }), { status: 422 }));
    const err = (await runSensitivity({}).catch((e: unknown) => e)) as ApiError;
    expect(err.problems.general).toHaveLength(1);
    expect(err.problems.general[0]).toContain("melewati batas");
  });

  it("gagal terhubung menjadi NetworkError berbahasa Indonesia", async () => {
    stub(async () => { throw new TypeError("fetch failed"); });
    const err = await runSensitivity({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).toContain("Tidak bisa terhubung");
  });

  it("status bukan 2xx atau 422 menjadi NetworkError dengan nomor HTTP", async () => {
    stub(async () => new Response("x", { status: 500 }));
    const err = await runSensitivity({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).toContain("HTTP 500");
  });

  it("permintaan yang dibatalkan tidak dianggap galat jaringan", async () => {
    const ctl = new AbortController();
    ctl.abort();
    stub(async () => { throw new DOMException("aborted", "AbortError"); });
    const err = await runSensitivity({}, ctl.signal).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(NetworkError);
    expect((err as Error).name).toBe("AbortError");
  });
});
