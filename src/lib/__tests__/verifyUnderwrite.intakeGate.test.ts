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
  deal_pricing_quotes: Row[];
};

function createFakeSupabase(seed: FakeTables) {
  const tables: FakeTables = {
    deals: [...seed.deals],
    deal_checklist_items: [...seed.deal_checklist_items],
    financial_snapshot_decisions: [...seed.financial_snapshot_decisions],
    deal_pricing_quotes: [...seed.deal_pricing_quotes],
  };

  function applyFilters(rows: Row[], filters: Array<{ key: string; value: any }>) {
    return rows.filter((row) => filters.every((f) => row[f.key] === f.value));
  }

  return {
    from(tableName: keyof FakeTables) {
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
      getLatestLockedQuoteId: async (_sb: any, dealId: string) => {
        const rows = seed.deal_pricing_quotes.filter(
          (row) => row.deal_id === dealId && row.status === "locked",
        );
        return rows[0]?.id ?? null;
      },
    },
  });
}

test("missing deal name blocks complete_intake", async () => {
  const result = await runVerify({
    deals: [
      {
        id: "deal-1",
        bank_id: "bank-1",
        name: "NEEDS NAME",
        borrower_id: "borrower-1",
        lifecycle_stage: "collecting",
      },
    ],
    deal_checklist_items: [],
    financial_snapshot_decisions: [{ id: "snap-1", deal_id: "deal-1" }],
    deal_pricing_quotes: [{ id: "quote-1", deal_id: "deal-1", status: "locked" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.recommendedNextAction, "complete_intake");
  assert.ok(result.diagnostics.missing?.includes("deal_name"));
});

test("missing borrower blocks complete_intake", async () => {
  const result = await runVerify({
    deals: [
      {
        id: "deal-1",
        bank_id: "bank-1",
        name: "Acme",
        borrower_id: null,
        lifecycle_stage: "collecting",
      },
    ],
    deal_checklist_items: [],
    financial_snapshot_decisions: [{ id: "snap-1", deal_id: "deal-1" }],
    deal_pricing_quotes: [{ id: "quote-1", deal_id: "deal-1", status: "locked" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.recommendedNextAction, "complete_intake");
  assert.ok(result.diagnostics.missing?.includes("borrower"));
});

test("partial lifecycle blocks complete_intake", async () => {
  const result = await runVerify({
    deals: [
      {
        id: "deal-1",
        bank_id: "bank-1",
        name: "Acme",
        borrower_id: "borrower-1",
        lifecycle_stage: "intake",
      },
    ],
    deal_checklist_items: [],
    financial_snapshot_decisions: [{ id: "snap-1", deal_id: "deal-1" }],
    deal_pricing_quotes: [{ id: "quote-1", deal_id: "deal-1", status: "locked" }],
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
        name: "Acme",
        borrower_id: "borrower-1",
        lifecycle_stage: "collecting",
      },
    ],
    deal_checklist_items: [
      {
        deal_id: "deal-1",
        checklist_key: "PFS",
        required: true,
        received_at: "2024-01-01",
      },
    ],
    financial_snapshot_decisions: [{ id: "snap-1", deal_id: "deal-1" }],
    deal_pricing_quotes: [{ id: "quote-1", deal_id: "deal-1", status: "locked" }],
  })) as VerifyUnderwriteResult;

  assert.equal(result.ok, true);
});
