import { test } from "node:test";
import assert from "node:assert/strict";

import { seedIntakePrereqsCore } from "@/lib/intake/seedIntakePrereqsCoreImpl";

type Row = Record<string, any>;

type FakeSupabase = {
  upsertedRows: Row[];
  from: (table: string) => any;
};

function createFakeSupabase(): FakeSupabase {
  const upsertedRows: Row[] = [];

  return {
    upsertedRows,
    from(table: string) {
      const builder: any = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle: async () => {
          if (table === "deals") {
            return {
              data: { id: "deal-1", bank_id: "bank-1" },
              error: null,
            };
          }
          if (table === "deal_intake") {
            return {
              data: { id: "intake-1", loan_type: "CRE_OWNER_OCCUPIED" },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        update: async () => ({ error: null }),
        upsert: async (rows: Row[]) => {
          upsertedRows.push(...rows);
          return { error: null };
        },
      };
      return builder;
    },
  };
}

test("seedIntakePrereqsCore materializes required checklist items", async () => {
  const fake = createFakeSupabase();

  const result = await seedIntakePrereqsCore(
    {
      dealId: "deal-1",
      bankId: "bank-1",
      source: "builder",
      ensureBorrower: false,
      ensureFinancialSnapshot: false,
      setStageCollecting: false,
    },
    {
      sb: fake as any,
      initializeIntake: async () => ({ ok: true, loanType: "CRE_OWNER_OCCUPIED" } as any),
      buildChecklistForLoanType: () => [
        { checklist_key: "PFS_CURRENT", title: "PFS", required: true },
      ],
      logLedgerEvent: async () => undefined,
    },
  );

  assert.equal(result.ok, true);
  assert.ok(
    fake.upsertedRows.some(
      (row) => row.checklist_key === "PFS_CURRENT" && row.required === true,
    ),
  );
  assert.ok(
    result.diagnostics.steps.some(
      (step) => step.name === "materialize_required_checklist" && step.ok,
    ),
  );
});
