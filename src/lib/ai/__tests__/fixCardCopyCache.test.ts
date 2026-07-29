/**
 * SPEC-M4 FIX-CARDS-1 — fixCardCopyCache unit tests.
 * Mocks the gateway's generator provider via gateway.ts's test-only seam —
 * no live network call.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { getOrGenerateFixCardCopy } = require("../fixCardCopyCache") as typeof import("../fixCardCopyCache");
const { __setProviderImplForTests, __setLogGatewayCallForTests, __resetGatewayTestOverrides } =
  require("../gateway") as typeof import("../gateway");

type Row = Record<string, any>;
function fakeCacheClient(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  return {
    rows,
    from() {
      return {
        _filterVal: undefined as string | undefined,
        select() {
          return this;
        },
        eq(_col: string, val: string) {
          this._filterVal = val;
          return this;
        },
        maybeSingle() {
          const found = rows.find((r) => r.issue_type === this._filterVal);
          return Promise.resolve({ data: found ?? null, error: null });
        },
        upsert(row: Row) {
          const idx = rows.findIndex((r) => r.issue_type === row.issue_type);
          if (idx >= 0) rows[idx] = row;
          else rows.push(row);
          return Promise.resolve({ data: [row], error: null });
        },
      };
    },
  };
}

afterEach(() => {
  __resetGatewayTestOverrides();
});

describe("getOrGenerateFixCardCopy", () => {
  it("cache miss: calls the generator, caches the result, returns it", async () => {
    let callCount = 0;
    __setLogGatewayCallForTests(async () => {});
    __setProviderImplForTests("google", async () => {
      callCount++;
      return { text: "Lenders check this to confirm your reported figures are consistent.", tokensIn: 10, tokensOut: 15 };
    });

    const client = fakeCacheClient();
    const copy = await getOrGenerateFixCardCopy("quality_flag:BALANCE_SHEET_IMBALANCE", "example", client);

    assert.equal(callCount, 1);
    assert.equal(copy, "Lenders check this to confirm your reported figures are consistent.");
    assert.equal(client.rows.length, 1);
    assert.equal(client.rows[0].issue_type, "quality_flag:BALANCE_SHEET_IMBALANCE");
  });

  it("cache hit: never calls the generator", async () => {
    let callCount = 0;
    __setProviderImplForTests("google", async () => {
      callCount++;
      return { text: "should not be used", tokensIn: 1, tokensOut: 1 };
    });

    const client = fakeCacheClient([
      { issue_type: "checklist_gap:tax_return_2024", copy: "Cached copy already here.", model: "x", verified: false },
    ]);
    const copy = await getOrGenerateFixCardCopy("checklist_gap:tax_return_2024", "example", client);

    assert.equal(callCount, 0);
    assert.equal(copy, "Cached copy already here.");
  });

  it("falls back to generic copy (never throws) when the gateway call fails", async () => {
    __setLogGatewayCallForTests(async () => {});
    __setProviderImplForTests("google", async () => {
      throw new Error("simulated outage");
    });
    __setProviderImplForTests("openai", async () => {
      throw new Error("simulated outage");
    });

    const client = fakeCacheClient();
    const copy = await getOrGenerateFixCardCopy("risk_flag:DSCR", "example", client);

    assert.ok(copy.length > 0);
    assert.equal(client.rows.length, 0, "should not cache a failure");
  });

  it("different issueTypes cache independently", async () => {
    __setLogGatewayCallForTests(async () => {});
    let n = 0;
    __setProviderImplForTests("google", async () => {
      n++;
      return { text: `copy #${n}`, tokensIn: 1, tokensOut: 1 };
    });

    const client = fakeCacheClient();
    const a = await getOrGenerateFixCardCopy("risk_flag:DSCR", "example a", client);
    const b = await getOrGenerateFixCardCopy("risk_flag:CURRENT_RATIO", "example b", client);

    assert.notEqual(a, b);
    assert.equal(client.rows.length, 2);
  });
});
