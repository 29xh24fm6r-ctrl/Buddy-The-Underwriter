import test from "node:test";
import assert from "node:assert/strict";

import { makeBuilderDealReadyCore, mintBuilderDealCore } from "@/lib/builder/builderDealsCore";
import { verifyUnderwriteCore } from "@/lib/deals/verifyUnderwriteCore";
import { getLatestLockedQuoteId } from "@/lib/pricing/getLatestLockedQuote";

function createFakeSupabase(tables: Record<string, any[]>) {
  return {
    from(tableName: string) {
      const filters: Array<{ key: string; value: any }> = [];
      const orders: Array<{ key: string; ascending: boolean }> = [];
      let limitCount: number | null = null;
      let selectOptions: any = null;

      const execute = (single: boolean) => {
        let rows = [...(tables[tableName] ?? [])];
        if (filters.length) {
          rows = rows.filter((row) => filters.every((f) => row[f.key] === f.value));
        }
        if (orders.length) {
          rows.sort((a, b) => {
            for (const ord of orders) {
              const av = a?.[ord.key];
              const bv = b?.[ord.key];
              if (av === bv) continue;
              if (av === null || av === undefined) return 1;
              if (bv === null || bv === undefined) return -1;
              if (av < bv) return ord.ascending ? -1 : 1;
              if (av > bv) return ord.ascending ? 1 : -1;
            }
            return 0;
          });
        }
        if (typeof limitCount === "number") {
          rows = rows.slice(0, limitCount);
        }
        if (selectOptions?.count === "exact" && selectOptions?.head) {
          return { data: null, error: null, count: rows.length };
        }
        if (single) {
          return { data: rows[0] ?? null, error: null };
        }
        return { data: rows, error: null };
      };

      const builder: any = {
        select(_cols?: string, options?: any) {
          selectOptions = options ?? null;
          return builder;
        },
        eq(key: string, value: any) {
          filters.push({ key, value });
          return builder;
        },
        order(key: string, opts?: { ascending?: boolean }) {
          orders.push({ key, ascending: opts?.ascending !== false });
          return builder;
        },
        limit(n: number) {
          limitCount = n;
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(execute(true));
        },
        then(resolve: any) {
          return Promise.resolve(resolve(execute(false)));
        },
      };

      return builder;
    },
  } as any;
}

test("builder deal core can mint and make ready", async () => {
  const now = () => new Date().toISOString();
  const tables: Record<string, any[]> = {
    deals: [],
    deal_checklist_items: [],
    financial_snapshot_decisions: [],
    deal_pricing_quotes: [],
  };

  const ops = {
    createDeal: async (payload: Record<string, any>) => {
      const id = payload.id ?? `deal-${tables.deals.length + 1}`;
      tables.deals.push({ id, ...payload });
      return { id };
    },
    updateDeal: async (dealId: string, payload: Record<string, any>) => {
      const row = tables.deals.find((d) => d.id === dealId);
      if (row) Object.assign(row, payload);
    },
    ensureChecklist: async (dealId: string) => {
      if (!tables.deal_checklist_items.length) {
        tables.deal_checklist_items.push(
          { deal_id: dealId, required: true, checklist_key: "PFS", received_at: null },
          { deal_id: dealId, required: true, checklist_key: "TAX", received_at: null },
        );
      }
    },
    markChecklistReceived: async (dealId: string) => {
      for (const item of tables.deal_checklist_items) {
        if (item.deal_id === dealId && item.required) {
          item.received_at = now();
        }
      }
    },
    ensureFinancialSnapshotDecision: async (dealId: string, bankId: string) => {
      tables.financial_snapshot_decisions.push({
        id: `snap-${dealId}`,
        deal_id: dealId,
        bank_id: bankId,
        created_at: now(),
      });
    },
    ensureLockedQuote: async (dealId: string) => {
      tables.deal_pricing_quotes.push({
        id: `quote-${dealId}`,
        deal_id: dealId,
        status: "locked",
        locked_at: now(),
        created_at: now(),
      });
    },
  };

  const minted = await mintBuilderDealCore({
    bankId: "bank-1",
    now,
    randomUUID: () => "borrower-1",
    ops,
  });

  assert.equal(minted.mode, "blocked");
  assert.ok(minted.dealId);

  await makeBuilderDealReadyCore({
    dealId: minted.dealId,
    bankId: "bank-1",
    now,
    randomUUID: () => "borrower-1",
    ops,
  });

  const sb = createFakeSupabase(tables);

  const verify = await verifyUnderwriteCore({
    dealId: minted.dealId,
    actor: "system",
    deps: {
      sb,
      logLedgerEvent: async () => undefined,
      getLatestLockedQuoteId,
    },
  });

  assert.equal(verify.ok, true);
});
