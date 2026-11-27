import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "./api";
import {
  buildHybridSimulatePayload,
  cancelHybridSweepJob,
  downloadHybridExcelReport,
  getHybridJob,
  getHybridSweepJob,
  previewHybridLoad,
  previewHybridWeather,
  runHybridSensitivity,
  runHybridSimulate,
  submitHybridJob,
  submitHybridSweepJob,
} from "./hybrid-api";
import { buildSampleProject } from "./hybrid-storage";
import type { HybridSimulateResponse } from "./hybrid-types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hybrid-api", () => {
  it("membangun payload simulasi sesuai kontrak v0.7 tanpa field UI cache", () => {
    const cfg = buildSampleProject("test-id");
    const payload = buildHybridSimulatePayload(cfg);
    expect(payload.contract_version).toBe("0.7");
    expect((payload as Record<string, unknown>).weatherPreview).toBeUndefined();
    expect((payload as Record<string, unknown>).loadPreview).toBeUndefined();
    expect((payload.components as Record<string, unknown>).pv).toBeDefined();
    expect((payload.components as Record<string, unknown>).diesel).toEqual({ enabled: false });
  });

  it("menyertakan weather_data kustom, daily_profile, monthly_factors, dan parameter fisik SAM lengkap", async () => {
    const cfg = buildSampleProject("sam-test-id");
    const ones8760 = Array.from({ length: 8760 }, () => 100);
    cfg.simulation.weather_source = "custom_json";
    cfg.simulation.weather_data = {
      metadata: { provider: "custom_epw", dataset: "test.epw" },
      hourly: {
        ghi_w_m2: ones8760,
        dni_w_m2: ones8760,
        dhi_w_m2: ones8760,
        temp_air_c: Array.from({ length: 8760 }, () => 27.5),
        wind_speed_m_s: Array.from({ length: 8760 }, () => 2.1),
      },
    };
    cfg.load_profile.daily_profile = Array.from({ length: 24 }, (_, i) => (i >= 8 && i <= 17 ? 1.0 : 0.4));
    cfg.load_profile.monthly_factors = Array.from({ length: 12 }, () => 1.05);
    cfg.components.pv.dc_model = "single_diode";
    cfg.components.pv.soiling_monthly = Array.from({ length: 12 }, () => 0.025);
    cfg.components.pv.night_tare_kw = 0.35;
    cfg.components.bess.aux_load_kw = 1.2;
    cfg.components.biomass.fuel_price_per_ton = 400000;
    cfg.components.biomass.logistics_cost_per_ton = 125000;
    cfg.components.biomass.moisture_fraction = 0.38;
    cfg.finance.tax_model = "after_tax";
    cfg.finance.corporate_tax_rate = 0.22;
    cfg.finance.tax_credit_fraction = 0.1;

    const payload = buildHybridSimulatePayload(cfg);
    const simPayload = payload.simulation as Record<string, unknown>;
    expect(simPayload.weather_source).toBe("custom_json");
    expect(simPayload.weather_data).toBeDefined();

    const lpPayload = payload.load_profile as Record<string, unknown>;
    expect(lpPayload.daily_profile).toHaveLength(24);
    expect(lpPayload.monthly_factors).toHaveLength(12);

    const comps = payload.components as Record<string, Record<string, unknown>>;
    expect(comps.pv.dc_model).toBe("single_diode");
    expect(comps.pv.i_sc).toBe(13.8);
    expect(comps.pv.soiling_monthly).toHaveLength(12);
    expect(comps.pv.night_tare_kw).toBe(0.35);
    expect(comps.bess.aux_load_kw).toBe(1.2);
    expect(comps.biomass.fuel_price_per_ton).toBe(400000);
    expect(comps.biomass.logistics_cost_per_ton).toBe(125000);
    expect(comps.biomass.moisture_fraction).toBe(0.38);

    const finPayload = payload.finance as Record<string, unknown>;
    expect(finPayload.tax_model).toBe("after_tax");
    expect(finPayload.corporate_tax_rate).toBe(0.22);
    expect(finPayload.tax_credit_fraction).toBe(0.1);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ annual_summary: { steps_count: 8760 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ summary: { total_load_kwh: 2000 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await previewHybridWeather(cfg);
    const weatherReqBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(weatherReqBody.weather_source).toBe("custom_json");
    expect(weatherReqBody.weather_data.hourly.ghi_w_m2).toHaveLength(8760);

    await previewHybridLoad(cfg);
    const loadReqBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(loadReqBody.load_profile.daily_profile).toHaveLength(24);
    expect(loadReqBody.load_profile.monthly_factors).toHaveLength(12);
  });

  it("memetakan respons sukses dan galat 422 dengan code stabil", async () => {
    const cfg = buildSampleProject("test-id");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ summary: { total_load_kwh: 1000 } }), { status: 200 }),
      ),
    );
    const loadRes = await previewHybridLoad(cfg);
    expect(loadRes.summary.total_load_kwh).toBe(1000);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: [{ type: "value_error", code: "out_of_coverage", loc: ["body"], msg: "Sea" }],
          }),
          { status: 422 },
        ),
      ),
    );
    await expect(previewHybridWeather(cfg)).rejects.toBeInstanceOf(ApiError);
  });

  it("mendukung simulasi sinkron, submit job, polling job, dan network error", async () => {
    const cfg = buildSampleProject("test-id");
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ contract_version: "0.7" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ job_id: "j1", status: "queued" }), { status: 202 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ job_id: "j1", status: "completed" }), { status: 200 })),
    );

    const sim = await runHybridSimulate(cfg);
    expect(sim.contract_version).toBe("0.7");

    const job = await submitHybridJob(cfg);
    expect(job.job_id).toBe("j1");

    const status = await getHybridJob("j1");
    expect(status.status).toBe("completed");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")));
    await expect(runHybridSimulate(cfg)).rejects.toBeInstanceOf(NetworkError);
  });

  it("mendukung sapuan kombinasi, pembatalan, sensitivitas hybrid, dan ekspor Excel", async () => {
    const cfg = buildSampleProject("test-id");
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ job_id: "sw1", total_combinations: 4, status: "queued" }), { status: 202 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ job_id: "sw1", status: "completed" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ job_id: "sw1", status: "cancelled" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ contract_version: "0.7", variables: [] }), { status: 200 }))
        .mockResolvedValueOnce(
          new Response(new Uint8Array([80, 75, 3, 4]), {
            status: 200,
            headers: {
              "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "Content-Disposition": 'attachment; filename="cikarang-laporan-hybrid.xlsx"',
            },
          }),
        ),
    );

    const sw = await submitHybridSweepJob(cfg, {
      pv_capacity_kwp_values: [300, 500],
      bess_capacity_kwh_values: [0, 400],
      biomass_capacity_kw_values: [0],
      diesel_capacity_kw_values: [0, 200],
      pv_inverter_sizing_mode: "keep_dc_ac_ratio",
      scale_replacement_costs: true,
      max_unmet_load_fraction: 0.05,
      min_renewable_fraction: null,
      sort_by: "lcoe_asc",
      feasible_first: true,
    });
    expect(sw.job_id).toBe("sw1");

    const swStatus = await getHybridSweepJob("sw1");
    expect(swStatus.status).toBe("completed");

    const swCancel = await cancelHybridSweepJob("sw1");
    expect(swCancel.status).toBe("cancelled");

    const sens = await runHybridSensitivity(cfg, { variables: ["capex_total"], shifts: [-0.1, 0.1] });
    expect(sens.contract_version).toBe("0.7");

    const fakeResult = {
      project_name: "Cikarang",
      summary: {},
      monthly: [],
      cashflow_schedule: [],
      hourly_year_1: { steps_count: 8760 },
    } as unknown as HybridSimulateResponse;
    const excel = await downloadHybridExcelReport({ cfg, result: fakeResult, language: "id" });
    expect(excel.filename).toBe("cikarang-laporan-hybrid.xlsx");
    expect(excel.blob.size).toBe(4);
  });
});
