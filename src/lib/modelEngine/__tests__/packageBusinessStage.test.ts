import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const { packageBusinessStage, loadPackageBusinessStage } = createRequire(import.meta.url)("../packageBusinessStage") as typeof import("../packageBusinessStage");

test("only an explicit saved pre-opening stage admits the startup basis", () => {
  for (const facts of [{}, { business: { annual_revenue: 0, is_startup: true } },
    { package_answers: { A11: { value: "startup" } } },
    { package_answers: { B07: { value: "The business is already operating" } } },
    { package_answers: { B07: { value: "The business is being acquired" } } }]) {
    assert.equal(packageBusinessStage(facts), "operating_or_unknown");
  }
  assert.equal(packageBusinessStage({ package_answers: { B07: { value: "The business is preparing to open" } } }), "pre_opening");
});
test("existing franchise purchases and expansions cannot lose historical requirements", () => {
  for (const value of ["Purchase of an operating franchise location", "Expansion of an existing franchise business"]) {
    assert.throws(() => packageBusinessStage({ package_answers: { B07: { value: "The business is preparing to open" }, K02: { value } } }), /conflict/);
  }
});
test("stage reads fail closed on tenant mismatch and storage failure", async () => {
  let mismatch = true;
  const sb = { from(table: string) { const q: any = { select: () => q, eq: () => q, maybeSingle: async () => table === "deals"
    ? { data: { bank_id: mismatch ? "other" : "bank" }, error: null }
    : { data: null, error: { message: "unavailable" } } }; return q; } };
  await assert.rejects(loadPackageBusinessStage(sb, "deal", "bank"), /mismatch/);
  mismatch = false;
  await assert.rejects(loadPackageBusinessStage(sb, "deal", "bank"), /stage_read_failed/);
});
