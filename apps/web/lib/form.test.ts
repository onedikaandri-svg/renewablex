import { describe, expect, it } from "vitest";
import { byVisualOrder } from "./form";

describe("byVisualOrder", () => {
  it("mengurutkan kunci sesuai urutan tampil, bukan urutan dari mesin", () => {
    // Mesin menyebut capacity_kwp (grup Energi) sebelum currency_code (grup Proyek).
    expect(byVisualOrder(["project.capacity_kwp", "financial.capex_amount", "project.currency_code"])).toEqual([
      "project.currency_code",
      "project.capacity_kwp",
      "financial.capex_amount",
    ]);
  });

  it("kunci yang tidak dikenal ditaruh di akhir dan input tidak diubah", () => {
    const input = ["x.unknown", "project.project_name"];
    expect(byVisualOrder(input)).toEqual(["project.project_name", "x.unknown"]);
    expect(input).toEqual(["x.unknown", "project.project_name"]);
  });
});
