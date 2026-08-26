import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

describe("Golden Trident evidence-authority architecture", () => {
  it("keeps memo stress policy in the canonical registry", () => {
    const builder = read("src/lib/creditMemo/canonical/buildCanonicalCreditMemo.ts");
    const stress = read("src/lib/creditMemo/canonical/buildStressTestTable.ts");
    const narrative = read("src/lib/creditMemo/canonical/narrativeAssembly.ts");

    assert.match(builder, /resolvePolicy\("dscr_floor"/);
    assert.doesNotMatch(stress, /institutional minimum|1\.25x policy floor/);
    assert.doesNotMatch(narrative, /1\.25x institutional|breaching 1\.25x/);
    assert.match(narrative, /governed DSCR floor/);
  });

  it("does not represent EBITDA decline tolerance as revenue decline", () => {
    const stress = read("src/lib/creditMemo/canonical/buildStressTestTable.ts");
    assert.match(stress, /ebitda_cushion_pct/);
    assert.match(stress, /revenue_cushion_pct: null/);
    assert.doesNotMatch(stress, /Revenue \(or EBITDA\) can decline/);
  });

  it("filters inferred ratio inputs before committee narrative assembly", () => {
    const ratios = read("src/lib/creditMemo/canonical/buildRatioAnalysisSuite.ts");
    assert.match(ratios, /isGovernedRatioInput/);
    assert.match(ratios, /source_canonical_type/);
    assert.match(ratios, /provenance/);
  });
});
