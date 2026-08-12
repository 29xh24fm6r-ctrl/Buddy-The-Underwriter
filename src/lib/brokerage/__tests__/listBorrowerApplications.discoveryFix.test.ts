import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

/**
 * SPEC-BORROWER-APPLICATION-DISCOVERY-1 — regression coverage for the
 * listBorrowerApplications() fix.
 *
 * Root cause fixed: the `deals` query selected `loan_purpose`, a column
 * that does not exist on `deals` in production (confirmed live — it lives
 * on brokerage_leads/deal_loan_requests/loan_requests/borrower_applications
 * instead). Every call 400'd, and the failure was folded into the SAME
 * return value ([]) as "borrower genuinely has zero applications" — so a
 * real borrower with real applications could be told "no applications
 * found." This file proves: (1) the invalid column reference is gone, (2)
 * a genuine empty result still returns [], (3) a query failure now throws
 * ApplicationLookupError instead of silently becoming [], and (4) bucket
 * mapping is unchanged.
 *
 * Follows this codebase's established require.cache stub convention for
 * @/lib/supabase/admin (see rateLimits.test.ts) — pure in-memory, never
 * hits a real DB.
 */

mockServerOnly();
const require = createRequire(import.meta.url);

type Row = Record<string, any>;

const state: {
  deals: Row[];
  dealStatus: Row[];
  dealsError: { message: string } | null;
  statusError: { message: string } | null;
} = { deals: [], dealStatus: [], dealsError: null, statusError: null };

function resetState() {
  state.deals = [];
  state.dealStatus = [];
  state.dealsError = null;
  state.statusError = null;
}

function builder(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let limit: number | null = null;

  const chain: any = {
    select(_cols?: string) {
      return chain;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => r[col] === val);
      return chain;
    },
    in(col: string, vals: unknown[]) {
      filters.push((r) => vals.includes(r[col]));
      return chain;
    },
    order() {
      return chain;
    },
    limit(n: number) {
      limit = n;
      return chain;
    },
    then(onFulfilled: any, onRejected?: any) {
      return resolve().then(onFulfilled, onRejected);
    },
  };

  function resolve(): Promise<{ data: any; error: any }> {
    if (table === "deals" && state.dealsError) {
      return Promise.resolve({ data: null, error: state.dealsError });
    }
    if (table === "deal_status" && state.statusError) {
      return Promise.resolve({ data: null, error: state.statusError });
    }
    const source = table === "deals" ? state.deals : table === "deal_status" ? state.dealStatus : [];
    let result = source.filter((r) => filters.every((f) => f(r)));
    if (limit != null) result = result.slice(0, limit);
    return Promise.resolve({ data: result, error: null });
  }

  return chain;
}

require.cache[require.resolve("@/lib/supabase/admin")] = {
  id: "supabase-admin-stub",
  filename: "supabase-admin-stub",
  loaded: true,
  exports: { supabaseAdmin: () => ({ from: (t: string) => builder(t) }) },
} as any;

const { listBorrowerApplications, ApplicationLookupError, bucketForStage } =
  require("../listBorrowerApplications") as typeof import("../listBorrowerApplications");

const BANK = "bank-1";
const EMAIL = "borrower@example.com";

function dealRow(overrides: Partial<Row> = {}): Row {
  return {
    id: `deal-${Math.random().toString(36).slice(2, 8)}`,
    bank_id: BANK,
    borrower_email: EMAIL,
    display_name: "Test Business",
    name: null,
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── 1. Zero real applications → legitimate empty result ──────────────────

test("REGRESSION: a borrower with zero real applications gets a legitimate empty array", async () => {
  resetState();
  const result = await listBorrowerApplications({ email: EMAIL, bankId: BANK });
  assert.deepEqual(result, []);
});

// ── 2. One real application → returned ────────────────────────────────────

test("REGRESSION: a borrower with one real application gets that application back", async () => {
  resetState();
  const deal = dealRow({ id: "deal-solo" });
  state.deals = [deal];
  state.dealStatus = [{ deal_id: "deal-solo", stage: "intake" }];

  const result = await listBorrowerApplications({ email: EMAIL, bankId: BANK });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "deal-solo");
  assert.equal(result[0].businessName, "Test Business");
  assert.equal(result[0].bucket, "active");
});

// ── 3. Multiple applications → all authorized ones returned ──────────────

test("REGRESSION: a borrower with multiple applications gets all of them back, scoped to email+bank", async () => {
  resetState();
  const mine1 = dealRow({ id: "deal-mine-1" });
  const mine2 = dealRow({ id: "deal-mine-2" });
  const someoneElse = dealRow({ id: "deal-other", borrower_email: "someone-else@example.com" });
  const otherBank = dealRow({ id: "deal-other-bank", bank_id: "bank-2" });
  state.deals = [mine1, mine2, someoneElse, otherBank];
  state.dealStatus = [
    { deal_id: "deal-mine-1", stage: "intake" },
    { deal_id: "deal-mine-2", stage: "funded" },
    { deal_id: "deal-other", stage: "intake" },
    { deal_id: "deal-other-bank", stage: "intake" },
  ];

  const result = await listBorrowerApplications({ email: EMAIL, bankId: BANK });
  const ids = result.map((a) => a.id).sort();
  assert.deepEqual(ids, ["deal-mine-1", "deal-mine-2"]);
});

// ── 4. Bucketing unchanged ─────────────────────────────────────────────────

test("REGRESSION: active/completed/previous/unknown bucketing is unchanged by this fix", async () => {
  resetState();
  state.deals = [
    dealRow({ id: "d-active" }),
    dealRow({ id: "d-completed" }),
    dealRow({ id: "d-previous" }),
    dealRow({ id: "d-unknown" }),
  ];
  state.dealStatus = [
    { deal_id: "d-active", stage: "underwriting" },
    { deal_id: "d-completed", stage: "funded" },
    { deal_id: "d-previous", stage: "declined" },
    // d-unknown has no deal_status row at all.
  ];

  const result = await listBorrowerApplications({ email: EMAIL, bankId: BANK });
  const byId = new Map(result.map((a) => [a.id, a]));
  assert.equal(byId.get("d-active")?.bucket, "active");
  assert.equal(byId.get("d-completed")?.bucket, "completed");
  assert.equal(byId.get("d-previous")?.bucket, "previous");
  assert.equal(byId.get("d-unknown")?.bucket, "unknown");

  // bucketForStage itself is untouched — pin the exact same mapping this
  // fix must not redesign.
  assert.equal(bucketForStage("underwriting"), "active");
  assert.equal(bucketForStage("funded"), "completed");
  assert.equal(bucketForStage("declined"), "previous");
  assert.equal(bucketForStage("nonexistent_stage"), "unknown");
});

// ── 5. Query failure is NEVER represented as zero applications ───────────

test("REGRESSION (root cause): a deals query failure throws ApplicationLookupError, never returns []", async () => {
  resetState();
  state.dealsError = { message: 'column deals.loan_purpose does not exist' };

  await assert.rejects(
    () => listBorrowerApplications({ email: EMAIL, bankId: BANK }),
    (err: unknown) => {
      assert.ok(err instanceof ApplicationLookupError, "must throw ApplicationLookupError specifically");
      return true;
    },
  );
});

test("REGRESSION: a deal_status query failure also throws ApplicationLookupError, never silently drops statuses", async () => {
  resetState();
  state.deals = [dealRow({ id: "deal-x" })];
  state.statusError = { message: "connection reset" };

  await assert.rejects(
    () => listBorrowerApplications({ email: EMAIL, bankId: BANK }),
    (err: unknown) => err instanceof ApplicationLookupError,
  );
});

// ── 6. The nonexistent column is gone ─────────────────────────────────────

test("REGRESSION: the deals select no longer references the nonexistent loan_purpose column", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const { resolve } = require("node:path") as typeof import("node:path");
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/brokerage/listBorrowerApplications.ts"),
    "utf8",
  );
  const selectMatch = src.match(/\.from\("deals"\)\s*\.select\("([^"]+)"\)/);
  assert.ok(selectMatch, "expected a .from(\"deals\").select(\"...\") call");
  assert.doesNotMatch(selectMatch![1], /loan_purpose/);
});

test("REGRESSION: loanPurpose is explicitly null (not silently mapped to a wrong column)", async () => {
  resetState();
  state.deals = [dealRow({ id: "deal-y" })];
  state.dealStatus = [{ deal_id: "deal-y", stage: "intake" }];
  const result = await listBorrowerApplications({ email: EMAIL, bankId: BANK });
  assert.equal(result[0].loanPurpose, null);
});
