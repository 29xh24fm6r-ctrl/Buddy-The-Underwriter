import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

let lastRpc: { name: string; args: any } | null = null;
let mockResponse: { data: unknown; error: { message: string } | null } = {
  data: [{ deal_id: "d", bank_id: "b", label: "l" }],
  error: null,
};

const adminStub = {
  supabaseAdmin: () =>
    ({
      rpc: (name: string, args: any) => {
        lastRpc = { name, args };
        return Promise.resolve(mockResponse);
      },
    } as never),
};
require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "supabase-admin-stub",
  filename: "supabase-admin-stub",
  loaded: true,
  exports: adminStub,
} as any;

const mod = require("../portalLinkState") as typeof import("../portalLinkState");

test("__test_classify maps pg error messages to typed codes", () => {
  // Known codes pass through.
  assert.equal(mod.__test_classify("link_not_found"), "link_not_found");
  assert.equal(mod.__test_classify("link_expired (extra detail)"), "link_expired");
  assert.equal(mod.__test_classify("link_consumed"), "link_consumed");
  assert.equal(mod.__test_classify("link_revoked"), "link_revoked");
  // Anything else collapses to portal_link_rpc_failed (strict whitelist).
  assert.equal(mod.__test_classify("some_other_pg_error"), "portal_link_rpc_failed");
  assert.equal(mod.__test_classify("UPPERCASE"), "portal_link_rpc_failed");
  assert.equal(mod.__test_classify(null), "portal_link_rpc_failed");
  assert.equal(mod.__test_classify(undefined), "portal_link_rpc_failed");
});

test("PortalLinkError carries the expected HTTP status per code", () => {
  const cases: Array<[string, number]> = [
    ["link_not_found", 404],
    ["link_expired", 410],
    ["link_consumed", 410],
    ["link_revoked", 410],
    ["portal_link_rpc_failed", 500],
  ];
  for (const [code, status] of cases) {
    const err = new mod.PortalLinkError(code as any);
    assert.equal(err.code, code);
    assert.equal(err.status, status);
    assert.equal(err.name, "PortalLinkError");
  }
});

test("consumeBorrowerPortalLink calls the consume RPC and returns the row", async () => {
  mockResponse = {
    data: [{ deal_id: "d-1", bank_id: "b-1", label: "Test" }],
    error: null,
  };
  const out = await mod.consumeBorrowerPortalLink("tok-abc");
  assert.equal(lastRpc?.name, "consume_borrower_portal_link");
  assert.deepEqual(lastRpc?.args, { p_token: "tok-abc" });
  assert.deepEqual(out, { deal_id: "d-1", bank_id: "b-1", label: "Test" });
});

test("consumeBorrowerPortalLink throws PortalLinkError on link_expired", async () => {
  mockResponse = { data: null, error: { message: "link_expired" } };
  await assert.rejects(
    mod.consumeBorrowerPortalLink("tok-xyz"),
    (err: any) =>
      err instanceof mod.PortalLinkError &&
      err.code === "link_expired" &&
      err.status === 410,
  );
});

test("peekBorrowerPortalLink calls the peek RPC (does not mark used)", async () => {
  mockResponse = {
    data: [{ deal_id: "d-2", bank_id: "b-2", label: null }],
    error: null,
  };
  const out = await mod.peekBorrowerPortalLink("tok-2");
  assert.equal(lastRpc?.name, "peek_borrower_portal_link");
  assert.equal(out.deal_id, "d-2");
  assert.equal(out.label, null);
});

test("peekBorrowerPortalLink surfaces link_revoked", async () => {
  mockResponse = { data: null, error: { message: "link_revoked some text" } };
  await assert.rejects(
    mod.peekBorrowerPortalLink("tok-3"),
    (err: any) => err.code === "link_revoked" && err.status === 410,
  );
});
