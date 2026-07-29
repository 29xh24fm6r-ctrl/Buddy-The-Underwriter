/**
 * SPEC-M4 FIX-CARDS-1 — buildFixCards integration tests (fake DB + mocked
 * copy generation).
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { buildFixCards } = require("../buildFixCards") as typeof import("../buildFixCards");
const { __setProviderImplForTests, __setLogGatewayCallForTests, __resetGatewayTestOverrides } =
  require("../../../ai/gateway") as typeof import("../../../ai/gateway");

type Row = Record<string, any>;

function fakeDb(opts: {
  snapshot?: Row | null;
  checklistRows?: Row[];
  reconRow?: Row | null;
}) {
  return {
    from(table: string) {
      if (table === "deal_model_snapshots") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          order() {
            return this;
          },
          limit() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: opts.snapshot ?? null, error: null });
          },
        };
      }
      if (table === "deal_checklist_items") {
        return {
          select() {
            return this;
          },
          eq() {
            return Promise.resolve({ data: opts.checklistRows ?? [], error: null });
          },
        };
      }
      if (table === "deal_reconciliation_results") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({ data: opts.reconRow ?? null, error: null });
          },
        };
      }
      // fix_card_copy_cache
      const rows: Row[] = [];
      return {
        select() {
          return this;
        },
        eq(_c: string, v: string) {
          (this as any)._v = v;
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: rows.find((r) => r.issue_type === (this as any)._v) ?? null, error: null });
        },
        upsert(row: Row) {
          rows.push(row);
          return Promise.resolve({ data: [row], error: null });
        },
      };
    },
  };
}

afterEach(() => {
  __resetGatewayTestOverrides();
});

describe("buildFixCards", () => {
  it("returns no cards for a clean deal", async () => {
    const cards = await buildFixCards("deal-1", fakeDb({ snapshot: null, checklistRows: [], reconRow: null }));
    assert.deepEqual(cards, []);
  });

  it("builds a card from a quality flag, attaching generated copy", async () => {
    __setLogGatewayCallForTests(async () => {});
    __setProviderImplForTests("google", async () => ({
      text: "Lenders want your statements to be internally consistent.",
      tokensIn: 5,
      tokensOut: 10,
    }));

    const cards = await buildFixCards(
      "deal-2",
      fakeDb({
        snapshot: { computed_metrics: {}, risk_flags: [], quality_flags: ["MISSING_REVENUE"], calculated_at: "2026-07-01" },
        checklistRows: [],
        reconRow: null,
      }),
    );

    assert.equal(cards.length, 1);
    assert.equal(cards[0].issueType, "quality_flag:MISSING_REVENUE");
    assert.equal(cards[0].whyItMatters, "Lenders want your statements to be internally consistent.");
  });

  it("builds a card from a checklist gap, carrying checklistKey", async () => {
    __setLogGatewayCallForTests(async () => {});
    __setProviderImplForTests("google", async () => ({ text: "Documentation helps verify your business.", tokensIn: 1, tokensOut: 1 }));

    const cards = await buildFixCards(
      "deal-3",
      fakeDb({
        snapshot: null,
        checklistRows: [
          { checklist_key: "tax_return_2024", label: "2024 Tax Return", required: true, status: "missing" },
          { checklist_key: "bank_statements", label: "Bank Statements", required: true, status: "received" },
          { checklist_key: "optional_doc", label: "Optional Doc", required: false, status: "missing" },
        ],
        reconRow: null,
      }),
    );

    assert.equal(cards.length, 1);
    assert.equal(cards[0].checklistKey, "tax_return_2024");
  });

  it("builds cards from ownership/K-1 reconciliation hard and soft failures", async () => {
    __setLogGatewayCallForTests(async () => {});
    __setProviderImplForTests("google", async () => ({ text: "Ownership consistency matters to lenders.", tokensIn: 1, tokensOut: 1 }));

    const cards = await buildFixCards(
      "deal-4",
      fakeDb({
        snapshot: null,
        checklistRows: [],
        reconRow: {
          hard_failures: [{ checkId: "K1_TO_ENTITY", description: "K-1 doesn't reconcile", severity: "HARD", notes: "" }],
          soft_flags: [{ checkId: "OWNERSHIP_INTEGRITY", description: "Ownership sums to 90%", severity: "SOFT", notes: "" }],
        },
      }),
    );

    assert.equal(cards.length, 2);
    const hard = cards.find((c) => c.issueType === "reconciliation:K1_TO_ENTITY");
    const soft = cards.find((c) => c.issueType === "reconciliation:OWNERSHIP_INTEGRITY");
    assert.equal(hard?.severity, "critical");
    assert.equal(soft?.severity, "warning");
  });

  it("combines all four sources into one deal's card list", async () => {
    __setLogGatewayCallForTests(async () => {});
    __setProviderImplForTests("google", async () => ({ text: "generic copy", tokensIn: 1, tokensOut: 1 }));

    const cards = await buildFixCards(
      "deal-5",
      fakeDb({
        snapshot: {
          computed_metrics: {},
          risk_flags: [{ key: "DSCR", value: 1.1, threshold: 1.25, severity: "high" }],
          quality_flags: ["MISSING_REVENUE"],
          calculated_at: "2026-07-01",
        },
        checklistRows: [{ checklist_key: "tax_return_2024", label: "2024 Tax Return", required: true, status: "missing" }],
        reconRow: {
          hard_failures: [],
          soft_flags: [{ checkId: "OWNERSHIP_INTEGRITY", description: "desc", severity: "SOFT", notes: "" }],
        },
      }),
    );

    assert.equal(cards.length, 4);
  });
});
