import test from "node:test";
import assert from "node:assert/strict";

import { ensureUnderwritingActivatedCore } from "@/lib/deals/underwriting/ensureUnderwritingActivatedCore";

type Row = Record<string, any>;

type FakeTables = {
  deals: Row[];
  deal_checklist_items: Row[];
};

function createFakeSupabase(seed: FakeTables) {
  const tables: FakeTables = {
    deals: [...seed.deals],
    deal_checklist_items: [...seed.deal_checklist_items],
  };

  function applyFilters(rows: Row[], filters: Array<{ key: string; value: any }>) {
    return rows.filter((row) => filters.every((f) => row[f.key] === f.value));
  }

  return {
    tables,
    from(tableName: keyof FakeTables) {
      const filters: Array<{ key: string; value: any }> = [];
      const builder: any = {
        select() {
          return builder;
        },
        eq(key: string, value: any) {
          filters.push({ key, value });
          return builder;
        },
        maybeSingle: async () => {
          const rows = applyFilters(tables[tableName], filters);
          return { data: rows[0] ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

test("ensureUnderwritingActivated is idempotent when already underwriting", async () => {
  const fake = createFakeSupabase({
    deals: [{ id: "deal-1", bank_id: "bank-1", lifecycle_stage: "underwriting" }],
    deal_checklist_items: [],
  });
  const ledger: any[] = [];

  const result = await ensureUnderwritingActivatedCore({
    dealId: "deal-1",
    bankId: "bank-1",
    deps: {
      sb: fake as any,
      logLedgerEvent: async (e: any) => {
        ledger.push(e);
      },
      emitBuilderLifecycleSignal: async () => undefined,
      advanceDealLifecycle: async () => ({ ok: true, already: true, stage: "underwriting" }) as any,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "already_activated");
  assert.ok(ledger.some((e) => e.eventKey === "underwriting.already_activated"));
});

test("ensureUnderwritingActivated blocks when required items missing", async () => {
  const fake = createFakeSupabase({
    deals: [{ id: "deal-2", bank_id: "bank-2", lifecycle_stage: "collecting" }],
    deal_checklist_items: [
      { deal_id: "deal-2", checklist_key: "PFS", required: true, received_at: null },
    ],
  });
  const ledger: any[] = [];

  const result = await ensureUnderwritingActivatedCore({
    dealId: "deal-2",
    bankId: "bank-2",
    deps: {
      sb: fake as any,
      logLedgerEvent: async (e: any) => {
        ledger.push(e);
      },
      emitBuilderLifecycleSignal: async () => undefined,
      advanceDealLifecycle: async () => ({ ok: true }) as any,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "blocked");
  assert.ok(Array.isArray((result as any).missing));
  assert.ok(ledger.some((e) => e.eventKey === "underwriting.activate_failed"));
});
