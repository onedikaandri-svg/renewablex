import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "./api";
import {
  buildHybridSimulatePayload,
  getHybridJob,
  previewHybridLoad,
  previewHybridWeather,
  runHybridSimulate,
  submitHybridJob,
} from "./hybrid-api";
import { buildSampleProject } from "./hybrid-storage";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hybrid-api", () => {
  it("membangun payload simulasi sesuai kontrak v0.5 tanpa field UI cache", () => {
    const cfg = buildSampleProject("test-id");
    const payload = buildHybridSimulatePayload(cfg);
    expect(payload.contract_version).toBe("0.5");
    expect((payload as Record<string, unknown>).weatherPreview).toBeUndefined();
    expect((payload as Record<string, unknown>).loadPreview).toBeUndefined();
    expect((payload.components as Record<string, unknown>).pv).toBeDefined();
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
        .mockResolvedValueOnce(new Response(JSON.stringify({ contract_version: "0.5" }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ job_id: "j1", status: "queued" }), { status: 202 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ job_id: "j1", status: "completed" }), { status: 200 })),
    );

    const sim = await runHybridSimulate(cfg);
    expect(sim.contract_version).toBe("0.5");

    const job = await submitHybridJob(cfg);
    expect(job.job_id).toBe("j1");

    const status = await getHybridJob("j1");
    expect(status.status).toBe("completed");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")));
    await expect(runHybridSimulate(cfg)).rejects.toBeInstanceOf(NetworkError);
  });
});
