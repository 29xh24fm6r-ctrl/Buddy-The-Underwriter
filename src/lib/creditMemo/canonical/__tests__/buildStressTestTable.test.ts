import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("buildStressTestTable governed evidence contract", () => {
  let buildStressTestTable: typeof import("../buildStressTestTable").buildStressTestTable;

  beforeAll(async () => {
    ({ buildStressTestTable } = await import("../buildStressTestTable"));
  });

  it("uses the resolved policy floor and labels EBITDA cushion accurately", () => {
    const result = buildStressTestTable({
      ebitda: 360_000,
      annualDebtService: 150_000,
      revenue: 2_400_000,
      grossMargin: 0.45,
      dscrFloor: 1.2,
      policyCitation: "governed test policy",
      inputsCertified: true,
    });

    expect(result.policy_dscr_floor).toBe(1.2);
    expect(result.breakeven_ebitda_125x).toBe(180_000);
    expect(result.ebitda_cushion_pct).toBe(50);
    expect(result.revenue_cushion_pct).toBeNull();
    expect(result.narrative).toContain("EBITDA can decline");
    expect(result.narrative).not.toContain("Revenue");
  });

  it("withholds all quantitative stress claims when inputs are not governed", () => {
    const result = buildStressTestTable({
      ebitda: 360_000,
      annualDebtService: 150_000,
      revenue: 2_400_000,
      grossMargin: 0.45,
      dscrFloor: 1.2,
      inputsCertified: false,
    });

    expect(result.baseline_dscr).toBeNull();
    expect(result.worst_case_dscr).toBeNull();
    expect(result.scenarios.every((row) => row.assessment === "N/A")).toBe(true);
    expect(result.narrative).toContain("withheld");
  });
});
