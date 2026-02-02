import test from "node:test";
import assert from "node:assert/strict";

import { igniteDeal } from "@/lib/deals/igniteDealCore";
import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycleCore";
import {
  isBorrowerUploadAllowed,
  canAccessUnderwrite,
  buildUnderwriteStartGate,
} from "@/lib/deals/lifecycleGuards";

type Row = Record<string, any>;

type FakeTables = {
  deals: Row[];
  deal_intake: Row[];
  deal_checklist_items: Row[];
};

function createFakeSupabase(seed: FakeTables) {
  const tables: FakeTables = {
    deals: [...seed.deals],
    deal_intake: [...seed.deal_intake],
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
        single: async () => {
          const rows = applyFilters(tables[tableName], filters);
          if (!rows[0]) {
            return { data: null, error: new Error("not_found") };
          }
          return { data: rows[0], error: null };
        },
        update(patch: Row) {
          return {
            eq: async (key: string, value: any) => {
              const rows = applyFilters(tables[tableName], [{ key, value }]);
              rows.forEach((row) => Object.assign(row, patch));
              return { data: rows[0] ?? null, error: null };
            },
          };
        },
        upsert: async (rows: Row[]) => {
          rows.forEach((row) => {
            const existing = tables[tableName].find(
              (r) => r.deal_id === row.deal_id && r.checklist_key === row.checklist_key,
            );
            if (!existing) tables[tableName].push({ ...row });
          });
          return { error: null };
        },
        insert: async (rows: Row | Row[]) => {
          const list = Array.isArray(rows) ? rows : [rows];
          list.forEach((row) => tables[tableName].push({ ...row }));
          return { data: list[0] ?? null, error: null };
        },
      };
      return builder;
    },
  };
}

function createDeps(fakeSb: ReturnType<typeof createFakeSupabase>, events: any[], pipeline: any[]) {
  return {
    sb: fakeSb as any,
    writeEvent: async (e: any) => {
      events.push(e);
      return { ok: true };
    },
    logLedgerEvent: async (e: any) => {
      pipeline.push(e);
    },
    emitBuddySignalServer: async () => undefined,
    ensureDefaultPortalStatus: async () => undefined,
    buildChecklistForLoanType: () => [
      { checklist_key: "PFS_CURRENT", title: "PFS", required: true },
    ],
  };
}

test("banker upload ignites deal", async () => {
  const fake = createFakeSupabase({
    deals: [{ id: "deal-1", bank_id: "bank-1", stage: "created" }],
    deal_intake: [{ deal_id: "deal-1", loan_type: "CRE" }],
    deal_checklist_items: [],
  });
  const events: any[] = [];
  const pipeline: any[] = [];

  const deps = createDeps(fake, events, pipeline);
  await igniteDeal({
    dealId: "deal-1",
    bankId: "bank-1",
    source: "banker_upload",
    triggeredByUserId: "user-1",
    deps: {
      ...deps,
      advanceDealLifecycle: (args) => advanceDealLifecycle({ ...args, deps }),
    },
  });

  const updated = fake.tables.deals.find((d) => d.id === "deal-1");
  assert.equal(updated?.stage, "collecting");
  assert.ok(events.some((e) => e.kind === "deal.ignited"));
});

test("borrower upload blocked pre-ignite", () => {
  assert.equal(isBorrowerUploadAllowed("created"), false);
  assert.equal(isBorrowerUploadAllowed("intake"), true);
});

test("invite ignites deal", async () => {
  const fake = createFakeSupabase({
    deals: [{ id: "deal-2", bank_id: "bank-1", stage: "created" }],
    deal_intake: [{ deal_id: "deal-2", loan_type: "CRE" }],
    deal_checklist_items: [],
  });
  const events: any[] = [];
  const pipeline: any[] = [];

  const deps = createDeps(fake, events, pipeline);
  await igniteDeal({
    dealId: "deal-2",
    bankId: "bank-1",
    source: "banker_invite",
    triggeredByUserId: "user-2",
    deps: {
      ...deps,
      advanceDealLifecycle: (args) => advanceDealLifecycle({ ...args, deps }),
    },
  });

  const ignited = events.find((e) => e.kind === "deal.ignited");
  assert.equal(ignited?.input?.source, "banker_invite");
});

test("underwrite route blocked before underwriting", () => {
  assert.equal(canAccessUnderwrite("collecting"), false);
  assert.equal(canAccessUnderwrite("intake"), false);
  assert.equal(canAccessUnderwrite("underwriting"), true);
  assert.equal(canAccessUnderwrite("ready"), true);
});

test("underwrite start gate blocks on verify or lifecycle", () => {
  const blocked = buildUnderwriteStartGate({
    lifecycleStage: "collecting",
    verifyOk: false,
    authOk: true,
    testMode: false,
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "lifecycle_blocked");

  const lifecycleBlocked = buildUnderwriteStartGate({
    lifecycleStage: "intake",
    verifyOk: true,
    authOk: true,
    testMode: false,
  });
  assert.equal(lifecycleBlocked.allowed, false);
  assert.equal(lifecycleBlocked.reason, "lifecycle_blocked");
});

test("underwrite start gate allows when ready", () => {
  const allowed = buildUnderwriteStartGate({
    lifecycleStage: "ready",
    verifyOk: true,
    authOk: true,
    testMode: false,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reason, "ok");
});
