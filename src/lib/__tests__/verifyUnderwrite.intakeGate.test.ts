import test from "node:test";
import assert from "node:assert/strict";

import {
  verifyUnderwriteCore,
  type VerifyUnderwriteResult,
} from "@/lib/deals/verifyUnderwriteCore";

type Row = Record<string, any>;

type FakeTables = {
  deals: Row[];
  deal_checklist_items: Row[];
  financial_snapshot_decisions: Row[];
  deal_pricing_inputs: Row[];
  // SPEC-BORROWER-ENTITY-SPONSOR-SEPARATION-1: legal borrower identity falls back
  // to deal_borrower_story.legal_name, so the fake must serve this table too.
  deal_borrower_story?: Row[];
};

function createFakeSupabase(seed: FakeTables) {
  const tables: Record<string, Row[]> = {
    deals: [...seed.deals],
    deal_checklist_items: [...seed.deal_checklist_items],
    financial_snapshot_decisions: [...seed.financial_snapshot_decisions],
    deal_pricing_inputs: [...seed.deal_pricing_inputs],
    deal_borrower_story: [...(seed.deal_borrower_story ?? [])],
  };

  function applyFilters(rows: Row[], filters: Array<{ key: string; value: any }>) {
    return (rows ?? []).filter((row) => filters.every((f) => row[f.key] === f.value));
  }

  return {
    from(tableName: string) {
      const filters: Array<{ key: string; value: any }> = [];
      let countMode = false;
      const builder: any = {
        select(_columns?: string, options?: { count?: string; head?: boolean }) {
          if (options?.count) {
            countMode = true;
          }
          return builder;
        },
        eq(key: string, value: any) {
          filters.push({ key, value });
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle: async () => {
          const rows = applyFilters(tables[tableName], filters);
          return { data: rows[0] ?? null, error: null };
        },
        then: (resolve: any) => {
          const rows = applyFilters(tables[tableName], filters);
          if (countMode) {
            return Promise.resolve(resolve({ count: rows.length, error: null }));
          }
          return Promise.resolve(resolve({ data: rows, error: null }));
        },
      };
      return builder;
    },
  };
}

async function runVerify(seed: FakeTables) {
  const fake = createFakeSupabase(seed);
  return verifyUnderwriteCore({
    dealId: "deal-1",
    logAttempt: false,
    deps: {
      sb: fake as any,
      logLedgerEvent: async () => undefined,
    },
  });
}

test("missing deal name blocks complete_intake", async () => {
  const result = await runVerify({
    deals: [
      {
        id: "deal-1",
        bank_id: "bank-1",
        display_name: null,
        nickname: null,
        borrower_id: "borrower-1",
        stage: "collecting",
      },
    ],
    deal_checklist_items: [],
    financial_snapshot_decisions: [{ id: "snap-1", deal_id: "deal-1" }],
    deal_pricing_inputs: [{ deal_id: "deal-1" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.recommendedNextAction, "complete_intake");
  assert.ok(result.diagnostics.missing?.includes("deal_name"));
});

test("missing deal returns deal_not_found with diagnostics", async () => {
  const result = await runVerify({
    deals: [],
    deal_checklist_items: [],
    financial_snapshot_decisions: [],
    deal_pricing_inputs: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.recommendedNextAction, "deal_not_found");
  assert.equal(result.diagnostics.foundIn?.supabaseDeals, false);
  assert.deepEqual(result.diagnostics.lookedIn, ["supabase.deals"]);
});

test("missing borrower blocks complete_intake", async () => {
  // SPEC-BORROWER-ENTITY-SPONSOR-SEPARATION-1: legal borrower identity is now
  // satisfied by borrower_id OR any deal-level name field OR the story legal_name.
  // To exercise the borrower gate, the deal must have NO legal identity at all —
  // a management/sponsor profile would NOT satisfy it (it's a different concept).
  const result = await runVerify({
    deals: [
      {
        id: "deal-1",
        bank_id: "bank-1",
        display_name: null,
        name: null,
        borrower_name: null,
        nickname: null,
        borrower_id: null,
        stage: "collecting",
      },
    ],
    deal_checklist_items: [],
    financial_snapshot_decisions: [{ id: "snap-1", deal_id: "deal-1" }],
    deal_pricing_inputs: [{ deal_id: "deal-1" }],
    deal_borrower_story: [{ id: "story-1", deal_id: "deal-1", legal_name: null }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.recommendedNextAction, "complete_intake");
  assert.ok(result.diagnostics.missing?.includes("borrower"));
});

test("deal-level name satisfies legal borrower identity (no borrower_id)", async () => {
  // SPEC-BORROWER-ENTITY-SPONSOR-SEPARATION-1 acceptance: an existing deal with a
  // borrower/display name but no borrower_id must NOT report a missing borrower.
  const result = await runVerify({
    deals: [
      {
        id: "deal-1",
        bank_id: "bank-1",
        display_name: "Omnicare 6-18-2026",
        name: "Omnicare 6-18-2026",
        borrower_name: "Omnicare 6-18-2026",
        nickname: null,
        borrower_id: null,
        stage: "collecting",
      },
    ],
    deal_checklist_items: [],
    financial_snapshot_decisions: [{ id: "snap-1", deal_id: "deal-1" }],
    deal_pricing_inputs: [{ deal_id: "deal-1" }],
  });

  // VerifyUnderwriteResult is a union discriminated by `ok`; only the blocked
  // (ok: false) variant carries `diagnostics`. This deal still fails other intake
  // gates, so narrow to the blocked variant, then prove borrower identity is NOT
  // among the missing reasons (a deal-level name satisfies legal identity).
  if (result.ok) {
    throw new Error(`Expected blocked result, got ok=${result.ok}`);
  }
  assert.ok(
    !result.diagnostics.missing?.includes("borrower"),
    "a deal with a name must not emit a missing-borrower",
  );
});

test("partial lifecycle blocks complete_intake", async () => {
  const result = await runVerify({
    deals: [
      {
        id: "deal-1",
        bank_id: "bank-1",
        display_name: "Acme",
        nickname: null,
        borrower_id: "borrower-1",
        stage: "intake",
      },
    ],
    deal_checklist_items: [],
    financial_snapshot_decisions: [{ id: "snap-1", deal_id: "deal-1" }],
    deal_pricing_inputs: [{ deal_id: "deal-1" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.recommendedNextAction, "complete_intake");
  assert.ok(result.diagnostics.missing?.includes("intake_lifecycle"));
});

test("valid deal returns ok", async () => {
  const result = (await runVerify({
    deals: [
      {
        id: "deal-1",
        bank_id: "bank-1",
        display_name: "Acme",
        nickname: null,
        borrower_id: "borrower-1",
        stage: "collecting",
      },
    ],
    deal_checklist_items: [
      {
        deal_id: "deal-1",
        checklist_key: "PFS",
        required: true,
        received_at: "2024-01-01",
        status: "received",
      },
    ],
    financial_snapshot_decisions: [{ id: "snap-1", deal_id: "deal-1" }],
    deal_pricing_inputs: [{ deal_id: "deal-1" }],
  })) as VerifyUnderwriteResult;

  assert.equal(result.ok, true);
});

test("missing pricing assumptions blocks pricing_assumptions_required", async () => {
  const result = await runVerify({
    deals: [
      {
        id: "deal-1",
        bank_id: "bank-1",
        display_name: "Acme",
        nickname: null,
        borrower_id: "borrower-1",
        stage: "collecting",
      },
    ],
    deal_checklist_items: [
      {
        deal_id: "deal-1",
        checklist_key: "PFS",
        required: true,
        received_at: "2024-01-01",
        status: "received",
      },
    ],
    financial_snapshot_decisions: [{ id: "snap-1", deal_id: "deal-1" }],
    deal_pricing_inputs: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.recommendedNextAction, "pricing_assumptions_required");
});
