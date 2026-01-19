import test from "node:test";
import assert from "node:assert/strict";

import { computeNextStep } from "@/core/nextStep/computeNextStep";

type Row = Record<string, any>;

type FakeTables = {
  deal_checklist_items: Row[];
};

function createFakeSupabase(seed: FakeTables) {
  const tables: FakeTables = {
    deal_checklist_items: [...seed.deal_checklist_items],
  };

  function applyFilters(rows: Row[], filters: Array<{ key: string; value: any }>) {
    return rows.filter((row) => filters.every((f) => row[f.key] === f.value));
  }

  return {
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
        then: (resolve: any) => {
          const rows = applyFilters(tables[tableName], filters);
          return Promise.resolve(resolve({ data: rows, error: null }));
        },
      };
      return builder;
    },
  };
}

test("computeNextStep returns open_underwriting when verify ok", async () => {
  const result = await computeNextStep({
    dealId: "deal-1",
    deps: {
      sb: createFakeSupabase({ deal_checklist_items: [] }) as any,
      verifyUnderwrite: async () => ({
        ok: true,
        dealId: "deal-1",
        redirectTo: "/underwrite/deal-1",
        ledgerEventsWritten: [],
      }),
    },
  });

  assert.deepEqual(result, {
    key: "open_underwriting",
    deepLink: "/underwrite/deal-1",
  });
});

test("computeNextStep returns run_pricing when pricing is required", async () => {
  const result = await computeNextStep({
    dealId: "deal-2",
    deps: {
      sb: createFakeSupabase({ deal_checklist_items: [] }) as any,
      verifyUnderwrite: async () => ({
        ok: false,
        dealId: "deal-2",
        auth: true,
        recommendedNextAction: "pricing_required",
        diagnostics: {},
        ledgerEventsWritten: [],
      }),
    },
  });

  assert.deepEqual(result, {
    key: "run_pricing",
    deepLink: "/deals/deal-2/pricing",
  });
});

test("computeNextStep returns request_docs with missing checklist codes", async () => {
  const result = await computeNextStep({
    dealId: "deal-3",
    deps: {
      sb: createFakeSupabase({
        deal_checklist_items: [
          { deal_id: "deal-3", required: true, checklist_key: "PFS", received_at: null },
          { deal_id: "deal-3", required: true, checklist_key: "TAX", received_at: "2024-01-01" },
        ],
      }) as any,
      verifyUnderwrite: async () => ({
        ok: false,
        dealId: "deal-3",
        auth: true,
        recommendedNextAction: "checklist_incomplete",
        diagnostics: {},
        ledgerEventsWritten: [],
      }),
    },
  });

  assert.equal(result.key, "request_docs");
  if (result.key === "request_docs") {
    assert.deepEqual(result.missingDocCodes, ["PFS"]);
    assert.ok(result.deepLink.includes("docs=PFS"));
  }
});

test("computeNextStep returns complete_intake with intake deep link", async () => {
  const result = await computeNextStep({
    dealId: "deal-4",
    deps: {
      sb: createFakeSupabase({ deal_checklist_items: [] }) as any,
      verifyUnderwrite: async () => ({
        ok: false,
        dealId: "deal-4",
        auth: true,
        recommendedNextAction: "complete_intake",
        diagnostics: { missing: ["deal_name"] },
        ledgerEventsWritten: [],
      }),
      intakeDeepLinkForMissing: () => ({
        href: "/deals/deal-4/cockpit#deal-name",
        hash: "deal-name",
        tab: "overview",
      }),
    },
  });

  assert.deepEqual(result, {
    key: "complete_intake",
    missing: ["deal_name"],
    deepLink: "/deals/deal-4/cockpit#deal-name",
  });
});
