import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
let released = false, signed = 0;
require.cache[require.resolve("@/lib/brokerage/borrowerArtifactRelease")] = {
  id: "release", filename: "release", loaded: true,
  exports: { getBorrowerArtifactRelease: async () => ({ released, reason: released ? "released" : "bank_selection_required" }) },
} as any;
require.cache[require.resolve("@/lib/brokerage/sessionToken")] = {
  id: "session", filename: "session", loaded: true,
  exports: { getBorrowerSession: async () => ({ deal_id: "d" }) },
} as any;
require.cache[require.resolve("@/lib/brokerage/trident/portalTokenAuth")] = {
  id: "token", filename: "token", loaded: true,
  exports: { resolvePortalToken: async () => ({ dealId: "d" }) },
} as any;
require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "admin", filename: "admin", loaded: true,
  exports: { supabaseAdmin: () => ({
    from: () => {
      const q: any = { select: () => q, eq: () => q, is: () => q, maybeSingle: async () => ({ data: {
        id: "bundle", deal_id: "d", mode: "preview", status: "succeeded", version: 1,
        business_plan_pdf_path: "private-business-plan", projections_pdf_path: "private-forecast",
        projections_xlsx_path: "private-workbook", feasibility_pdf_path: "private-study",
      }, error: null }) };
      return q;
    },
    storage: { from: () => ({ createSignedUrl: async () => { signed++; return { data: { signedUrl: "https://example.test/private" } }; } }) },
  }) },
} as any;
const cookie = require("../../../../app/api/brokerage/deals/[dealId]/trident/latest-preview/route") as typeof import("../../../../app/api/brokerage/deals/[dealId]/trident/latest-preview/route");
const portal = require("../../../../app/api/portal/[token]/trident/latest-preview/route") as typeof import("../../../../app/api/portal/[token]/trident/latest-preview/route");
test("locked cookie preview retains completion status but signs no artifacts", async () => {
  released = false; signed = 0;
  const response = await cookie.GET({} as any, { params: Promise.resolve({ dealId: "d" }) });
  const body = await response.json();
  assert.equal(body.bundle.id, "bundle");
  assert.deepEqual(body.artifacts, {});
  assert.equal(body.release.released, false);
  assert.equal(signed, 0);
  assert.doesNotMatch(JSON.stringify(body), /private-/);
});
test("locked portal preview stops polling without disclosing paths", async () => {
  released = false; signed = 0;
  const response = await portal.GET({} as any, { params: Promise.resolve({ token: "t" }) });
  const body = await response.json();
  assert.equal(body.bundle.status, "succeeded");
  assert.equal(body.bundle.businessPlanPdfPath, null);
  assert.equal(body.release.released, false);
  assert.doesNotMatch(JSON.stringify(body), /private-/);
});
test("accepted cookie preview can sign its four authorized artifacts", async () => {
  released = true; signed = 0;
  const response = await cookie.GET({} as any, { params: Promise.resolve({ dealId: "d" }) });
  const body = await response.json();
  assert.equal(Object.keys(body.artifacts).length, 4);
  assert.equal(signed, 4);
});
