import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

// sbaFormDispatch.ts has `import "server-only"` (transitively via the
// render*.ts modules it dispatches to) — same require()-after-patch
// pattern as geminiClient.test.ts / samGov/client.test.ts.
mockServerOnly();
const require = createRequire(import.meta.url);
const { isDispatchedSbaTemplateCode, renderSbaPackageItem } = require("../sbaFormDispatch") as typeof import("../sbaFormDispatch");

/**
 * Every table query below resolves empty/null regardless of filters — no
 * official templates are ingested in this environment (sba.gov/irs.gov
 * blocked, same as every prior phase), so these tests exercise the
 * dispatcher's applicability/completeness gating, not actual PDF bytes.
 */
class EmptyQuery {
  select() {
    return this;
  }
  eq() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  is() {
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: null, error: null });
  }
  then(resolve: any, reject?: any) {
    return Promise.resolve({ data: [], error: null }).then(resolve, reject);
  }
}

const emptySupabase = { from: () => new EmptyQuery() } as any;

test("isDispatchedSbaTemplateCode: recognizes all 7 ARC-00 form codes, rejects unknown", () => {
  for (const code of ["SBA_1919", "SBA_1244", "SBA_413", "SBA_912", "SBA_155", "SBA_159", "IRS_4506C"]) {
    assert.equal(isDispatchedSbaTemplateCode(code), true);
  }
  assert.equal(isDispatchedSbaTemplateCode("SBA_1920"), false);
  assert.equal(isDispatchedSbaTemplateCode("SOME_OTHER_TEMPLATE"), false);
});

test("renderSbaPackageItem: unknown template code -> no_dispatch_handler", async () => {
  const result = await renderSbaPackageItem("NOT_A_REAL_CODE", { dealId: "d1", bankId: "b1", supabase: emptySupabase });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "no_dispatch_handler");
});

test("renderSbaPackageItem: SBA_1919 on empty deal -> form_incomplete, not a fabricated PDF", async () => {
  const result = await renderSbaPackageItem("SBA_1919", { dealId: "d1", bankId: "b1", supabase: emptySupabase });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "form_incomplete");
});

test("renderSbaPackageItem: SBA_1244 on empty deal -> form_incomplete, not a fabricated PDF", async () => {
  const result = await renderSbaPackageItem("SBA_1244", { dealId: "d1", bankId: "b1", supabase: emptySupabase });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "form_incomplete");
});

test("renderSbaPackageItem: SBA_912 with no triggering owners -> not_applicable", async () => {
  const result = await renderSbaPackageItem("SBA_912", { dealId: "d1", bankId: "b1", supabase: emptySupabase });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "not_applicable");
});

test("renderSbaPackageItem: SBA_155 with no seller note equity -> not_applicable", async () => {
  const result = await renderSbaPackageItem("SBA_155", { dealId: "d1", bankId: "b1", supabase: emptySupabase });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "not_applicable");
});

test("renderSbaPackageItem: SBA_159 with no agent_used -> not_applicable", async () => {
  const result = await renderSbaPackageItem("SBA_159", { dealId: "d1", bankId: "b1", supabase: emptySupabase });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "not_applicable");
});

test("renderSbaPackageItem: SBA_413 with no signers -> no_signers", async () => {
  const result = await renderSbaPackageItem("SBA_413", { dealId: "d1", bankId: "b1", supabase: emptySupabase });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "no_signers");
});

test("renderSbaPackageItem: IRS_4506C with no signers -> no_signers", async () => {
  const result = await renderSbaPackageItem("IRS_4506C", { dealId: "d1", bankId: "b1", supabase: emptySupabase });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "no_signers");
});
