import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSampleProject,
  createBlankProject,
  createSampleProject,
  deleteProject,
  duplicateProject,
  exportProjectJson,
  getProject,
  getSimulationResult,
  importProjectJson,
  listProjects,
  saveSimulationResult,
} from "./hybrid-storage";
import type { HybridSimulateResponse } from "./hybrid-types";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(k: string) { return this.map.get(k) ?? null; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  removeItem(k: string) { this.map.delete(k); }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

beforeEach(() => {
  Object.defineProperty(globalThis, "window", {
    value: { localStorage: new MemoryStorage() },
    configurable: true,
    writable: true,
  });
});

describe("hybrid-storage", () => {
  it("membuat, menduplikat, mengekspor, mengimpor, dan menghapus proyek", () => {
    const sample = createSampleProject();
    expect(listProjects()).toHaveLength(1);
    expect(getProject(sample.id)?.project.project_name).toContain("[REAL DATA]");

    const blank = createBlankProject("Pabrik Baru");
    expect(listProjects()).toHaveLength(2);

    const copy = duplicateProject(blank.id);
    expect(copy?.project.project_name).toBe("Pabrik Baru (Salinan)");
    expect(listProjects()).toHaveLength(3);

    const jsonText = exportProjectJson(sample);
    const imported = importProjectJson(jsonText);
    expect(imported.id).not.toBe(sample.id);
    expect(listProjects()).toHaveLength(4);

    deleteProject(blank.id);
    expect(getProject(blank.id)).toBeNull();
  });

  it("menolak JSON proyek yang tidak valid atau tidak lengkap", () => {
    expect(() => importProjectJson("{bukan json")).toThrow("JSON");
    expect(() => importProjectJson(JSON.stringify({ hello: "world" }))).toThrow("tidak lengkap");
  });

  it("menyimpan dan membaca hasil simulasi terakhir", () => {
    const p = buildSampleProject("p1");
    const fakeResult = {
      engine_version: "0.5.0",
      contract_version: "0.5",
      config_hash: "sha256:abc",
    } as unknown as HybridSimulateResponse;
    saveSimulationResult(p.id, fakeResult);
    expect(getSimulationResult(p.id)?.config_hash).toBe("sha256:abc");
  });
});
