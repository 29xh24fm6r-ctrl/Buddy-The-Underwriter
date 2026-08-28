import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

/**
 * Preview generation is admitted and executed by the durable workflow, so the
 * POST returns 202 and the artifacts do not exist yet. The staff status
 * endpoint was hard-wired to `.eq("mode","final")`, which meant the
 * borrower-facing path had no observable progress or failure reason anywhere
 * in the product — the only way to see why a preview died was to query
 * buddy_trident_bundles by hand.
 *
 * Production makes the cost concrete: 883 preview runs, none successful, and
 * the largest cluster recorded a failure reason no surface could display.
 *
 * Behavioural rather than source-text: this drives the real route handler and
 * asserts which bundle comes back.
 */

const state: { rows: Record<string, unknown>[]; stages: Record<string, unknown>[] } = {
  rows: [],
  stages: [],
};

require.cache[require.resolve("@/lib/auth/requireBrokerageStaff")] = {
  id: "staff-stub", filename: "staff-stub", loaded: true,
  exports: { requireBrokerageStaff: async () => ({ userId: "staff-1" }) },
} as never;

require.cache[require.resolve("@/lib/tenant/brokerage")] = {
  id: "tenant-stub", filename: "tenant-stub", loaded: true,
  exports: { getBrokerageBankId: async () => "bank-1" },
} as never;

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "sb-stub", filename: "sb-stub", loaded: true,
  exports: {
    supabaseAdmin: () => ({
      from(table: string) {
        const filters: Record<string, unknown> = {};
        const q = {
          select() { return q; },
          eq(k: string, v: unknown) { filters[k] = v; return q; },
          order() { return q; },
          limit() { return q; },
          async maybeSingle() {
            const match = state.rows.find((r) =>
              Object.entries(filters).every(([k, v]) => r[k] === v));
            return { data: match ?? null, error: null };
          },
        };
        if (table === "buddy_trident_bundle_stages") {
          return {
            select: () => ({
              eq: () => ({ order: async () => ({ data: state.stages, error: null }) }),
            }),
          } as never;
        }
        return q as never;
      },
    }),
  },
} as never;

const { GET } = require(
  "../../../../app/api/brokerage/deals/[dealId]/trident/generate/route",
) as typeof import("../../../../app/api/brokerage/deals/[dealId]/trident/generate/route");

async function statusFor(mode?: string) {
  const url = new URL(`https://x/api?${mode ? `mode=${mode}` : ""}`);
  const res = await GET({ nextUrl: url } as never, {
    params: Promise.resolve({ dealId: "deal-1" }),
  });
  return { status: res.status, body: await res.json() };
}

function seed() {
  state.rows = [
    { id: "final-1", deal_id: "deal-1", bank_id: "bank-1", mode: "final",
      status: "failed", current_stage: "canonical_credit",
      generation_error: "institutional review did not pass" },
    { id: "preview-1", deal_id: "deal-1", bank_id: "bank-1", mode: "preview",
      status: "failed", current_stage: "sba_package",
      generation_error: "SBA package generation failed: Assumption validation failed — Loan amount is required" },
  ];
  state.stages = [];
}

test("[observability] a preview run can be observed through the staff status endpoint", async () => {
  seed();
  const { status, body } = await statusFor("preview");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mode, "preview");
  assert.equal(body.bundle.id, "preview-1", "must return the PREVIEW bundle");
  assert.match(
    body.bundle.generation_error,
    /Loan amount is required/,
    "the recorded failure reason must reach the surface that displays it",
  );
});

test("[observability] final remains the default so existing callers are unaffected", async () => {
  seed();
  for (const mode of [undefined, "final", "nonsense"]) {
    const { body } = await statusFor(mode);
    assert.equal(body.mode, "final", `mode=${String(mode)} must resolve to final`);
    assert.equal(body.bundle.id, "final-1");
  }
});

test("[observability] the two modes never bleed into each other", async () => {
  seed();
  const preview = await statusFor("preview");
  const final = await statusFor("final");
  assert.notEqual(preview.body.bundle.id, final.body.bundle.id);
  assert.equal(preview.body.bundle.mode, "preview");
  assert.equal(final.body.bundle.mode, "final");
});
