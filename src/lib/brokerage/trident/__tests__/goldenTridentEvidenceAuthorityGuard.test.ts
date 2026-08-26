import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Golden Trident evidence-authority architecture", () => {
  it("keeps memo stress policy in the canonical registry", () => {
    const builder = read("src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts");
    const stress = read("src/lib/creditMemo/canonical/buildStressTestTable.ts");
    const narrative = read("src/lib/creditMemo/canonical/narrativeAssembly.ts");

    expect(builder).toContain('resolvePolicy("dscr_floor"');
    expect(stress).not.toMatch(/institutional minimum|1\.25x policy floor/);
    expect(narrative).not.toMatch(/1\.25x institutional|breaching 1\.25x/);
    expect(narrative).toContain("governed DSCR floor");
  });

  it("does not represent EBITDA decline tolerance as revenue decline", () => {
    const stress = read("src/lib/creditMemo/canonical/buildStressTestTable.ts");
    expect(stress).toContain("ebitda_cushion_pct");
    expect(stress).toContain("revenue_cushion_pct: null");
    expect(stress).not.toContain("Revenue (or EBITDA) can decline");
  });

  it("filters inferred ratio inputs before committee narrative assembly", () => {
    const ratios = read("src/lib/creditMemo/canonical/buildRatioAnalysisSuite.ts");
    expect(ratios).toContain("isGovernedRatioInput");
    expect(ratios).toContain("source_canonical_type");
    expect(ratios).toContain("provenance");
  });
});
