import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { auditClassicSpread, type AuditInput } from "../spreadAccuracyAudit";
import type { PeriodMaps } from "../../classicSpreadRatios";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../..");
const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

function pm(rows: Record<string, Record<string, number | null>>): PeriodMaps {
  const m: PeriodMaps = new Map();
  for (const [period, facts] of Object.entries(rows)) m.set(period, new Map(Object.entries(facts)));
  return m;
}

/** SPEC-CLASSIC-SPREAD-STATEMENT-TRUTH-RESOLVER-1 #6 — audit uses the resolver, OmniCare stays BLOCKER. */

const baseInput = (byPeriod: PeriodMaps): AuditInput => ({
  periods: [{ iso: "2024-12-31", label: "2024" }],
  byPeriod,
  balanceSheet: [],
  incomeStatement: [],
  cashFlow: [],
});

describe("audit integrates the statement truth resolver under resolve:true", () => {
  const byPeriod = pm({
    "2024-12-31": {
      SL_TOTAL_ASSETS: 6_800_000,
      SL_ACCOUNTS_PAYABLE: 71_364, SL_LOANS_FROM_SHAREHOLDERS: 1_930_705, SL_OTHER_LIABILITIES: 284_993,
      SL_RETAINED_EARNINGS: 4_512_938, SL_TOTAL_EQUITY: 6_800_000,
    },
  });

  it("surfaces the rejected direct-equity source value as a blocker finding", () => {
    const r = auditClassicSpread({ ...baseInput(byPeriod), resolve: true });
    const f = r.findings.find((x) => x.rowLabel === "TOTAL NET WORTH" && x.issueType === "rejected_source_value");
    assert.ok(f, "resolver finding must appear in the audit");
    assert.equal(f!.severity, "blocker");
    assert.equal(r.status, "blocker");
  });

  it("is opt-in: without resolve:true the resolver findings are absent", () => {
    const r = auditClassicSpread(baseInput(byPeriod));
    assert.equal(r.findings.find((x) => x.issueType === "rejected_source_value"), undefined);
  });

  it("the loader runs the audit with resolve:true", () => {
    assert.match(read("src/lib/classicSpread/classicSpreadLoader.ts"), /resolve: true/);
  });
});
