import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

/**
 * Regression suite for "Verify ID does nothing when clicked".
 *
 * createDiditSession THROWS on a vendor error and initiateKyc does not catch
 * it, so the handler used to 500 with a non-JSON body. The browser's
 * res.json() then rejected, the panel's bare catch swallowed it, and the
 * borrower got no feedback at all. Production logged
 *   Didit API /session/ failed: 400 — {"workflow_id":"Invalid workflow_id."}
 * on this exact route 8 times between 2026-08-06 and 2026-08-21 while the
 * borrower saw a button that did nothing.
 */

const DEAL = "b296dec2-66c6-4946-8ddc-850daa7f968f";
const OWNER = "oe-1";

let diditThrows: Error | null = null;
let ownerRow: Record<string, unknown> | null = { id: OWNER, display_name: "Sebrina Colon" };

/**
 * Table-aware, and returns PostgREST envelopes. initiateKyc first looks for
 * a reusable pending verification and only calls the vendor when there is
 * none, so a stub that answers every table with the same row never reaches
 * the vendor path at all.
 */
function sbStub() {
  function builder(table: string) {
    const q: any = {
      select: () => q,
      insert: () => q,
      eq: () => q,
      in: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({
        data: table === "ownership_entities" ? ownerRow : null,
        error: null, count: null, status: 200,
      }),
      single: async () => ({
        data: table === "borrower_identity_verifications" ? { id: "v1" } : null,
        error: null, count: null, status: 200,
      }),
      then: (res: any, rej: any) =>
        Promise.resolve({ data: [], error: null, count: 0, status: 200 }).then(res, rej),
    };
    return q;
  }
  return { from: builder };
}

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "sb", filename: "sb", loaded: true, exports: { supabaseAdmin: () => sbStub() },
} as any;

require.cache[require.resolve("@/lib/borrower/resolvePortalContext")] = {
  id: "ctx", filename: "ctx", loaded: true,
  exports: { resolvePortalContext: async () => ({ dealId: DEAL, bankId: "bank1" }) },
} as any;

require.cache[require.resolve("@/lib/identity/kyc/didit")] = {
  id: "didit", filename: "didit", loaded: true,
  exports: {
    createDiditSession: async () => {
      if (diditThrows) throw diditThrows;
      return { session_id: "s1", status: "Not Started", url: "https://verify.didit.me/s/1" };
    },
    fetchDiditSession: async () => ({ session_id: "s1", status: "Not Started", workflow_id: "w", url: "u" }),
    getDiditSessionDecision: async () => ({ session_id: "s1", status: "Not Started" }),
  },
} as any;

const { POST } = require("../route") as typeof import("../route");

function ctx() {
  return { params: Promise.resolve({ token: DEAL }) };
}
function req(body: unknown): any {
  return { json: async () => body, headers: { get: () => null } };
}

test("a vendor failure returns a JSON error the borrower can be shown", async () => {
  process.env.DIDIT_WORKFLOW_ID = "a-stale-or-draft-workflow-id";
  diditThrows = new Error(
    'Didit API /session/ failed: 400 Bad Request — {"workflow_id":"Invalid workflow_id."}',
  );

  // Must not reject: an uncaught throw here is what produced the dead button.
  const res = await POST(req({ ownershipEntityId: OWNER }), ctx());
  const body = (await res.json()) as any;

  assert.equal(res.status, 502, "a vendor failure must be a definite, typed response");
  assert.equal(body.ok, false);
  assert.equal(body.error, "VENDOR_SESSION_FAILED");
  assert.ok(
    typeof body.message === "string" && body.message.length > 0,
    "the response must carry a message the panel can render",
  );
  assert.match(String(body.detail), /Invalid workflow_id/, "the real cause must be preserved for logs");
});

test("a missing workflow id is reported as configuration, not as success", async () => {
  delete process.env.DIDIT_WORKFLOW_ID;
  diditThrows = null;

  const res = await POST(req({ ownershipEntityId: OWNER }), ctx());
  const body = (await res.json()) as any;

  assert.equal(res.status, 503);
  assert.equal(body.error, "NOT_CONFIGURED");
  assert.ok(typeof body.message === "string" && body.message.length > 0);
});

test("a successful start still returns the session url", async () => {
  process.env.DIDIT_WORKFLOW_ID = "520730c2-18d1-49a4-a9d3-c98001c0a0f7";
  diditThrows = null;
  ownerRow = { id: OWNER, display_name: "Sebrina Colon" };

  const res = await POST(req({ ownershipEntityId: OWNER }), ctx());
  const body = (await res.json()) as any;

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.sessionUrl, "https://verify.didit.me/s/1");
});

test("every failure path carries a borrower-facing message", async () => {
  // OWNER_NOT_FOUND previously returned only a machine reason, which the
  // panel had no way to render.
  process.env.DIDIT_WORKFLOW_ID = "520730c2-18d1-49a4-a9d3-c98001c0a0f7";
  diditThrows = null;
  ownerRow = null;

  const res = await POST(req({ ownershipEntityId: "missing" }), ctx());
  const body = (await res.json()) as any;

  assert.equal(res.status, 404);
  assert.equal(body.ok, false);
  assert.ok(typeof body.message === "string" && body.message.length > 0);
  ownerRow = { id: OWNER, display_name: "Sebrina Colon" };
});
