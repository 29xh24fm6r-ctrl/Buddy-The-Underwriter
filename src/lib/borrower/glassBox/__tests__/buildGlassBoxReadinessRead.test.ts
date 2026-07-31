/**
 * SPEC-M3 GLASS-BOX-1 — buildGlassBoxReadinessRead unit tests.
 *
 * Mocks the gateway's anthropic provider (both `translator` and `verifier`
 * default to it) via gateway.ts's test-only seam — no live network call.
 * The mock branches on systemInstruction content to distinguish a
 * translator call from a verifier call, since both hit the same provider.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { buildGlassBoxReadinessRead } =
  require("../buildGlassBoxReadinessRead") as typeof import("../buildGlassBoxReadinessRead");
const { __setProviderImplForTests, __setLogGatewayCallForTests, __resetGatewayTestOverrides } =
  require("../../../ai/gateway") as typeof import("../../../ai/gateway");
const { __setVendorApprovalForTests, __resetVendorApprovalForTests } =
  require("../../../ai/vendorApproval") as typeof import("../../../ai/vendorApproval");

function fakeSnapshotClient(
  computedMetrics: Record<string, number | null> | null,
  loggedEvents?: Array<{ event_type: string; metadata: any }>,
) {
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
            return Promise.resolve({
              data:
                computedMetrics === null
                  ? null
                  : { computed_metrics: computedMetrics, risk_flags: [], calculated_at: "2026-07-01T00:00:00.000Z" },
              error: null,
            });
          },
        };
      }
      // brokerage_conversion_events (emitReadinessReadRendered / emitReadinessReadDegraded)
      return {
        insert(row: { event_type: string; metadata: any }) {
          loggedEvents?.push(row);
          return Promise.resolve({ data: [{}], error: null });
        },
      };
    },
  };
}

function isTranslatorCall(req: { systemInstruction?: string }): boolean {
  return (req.systemInstruction ?? "").includes("translating");
}

afterEach(() => {
  __resetGatewayTestOverrides();
  __resetVendorApprovalForTests();
});

describe("buildGlassBoxReadinessRead", () => {
  it("returns 'unavailable' when no snapshot exists", async () => {
    const result = await buildGlassBoxReadinessRead("deal-1", fakeSnapshotClient(null));
    assert.equal(result.status, "unavailable");
  });

  it("returns 'degraded' when a snapshot exists but has no numeric metrics, and emits readiness_read_degraded:no_computed_metrics", async () => {
    const logged: Array<{ event_type: string; metadata: any }> = [];
    const result = await buildGlassBoxReadinessRead(
      "deal-2",
      fakeSnapshotClient({ DSCR: null, EBITDA: null }, logged),
    );
    assert.equal(result.status, "degraded");
    if (result.status === "degraded") {
      assert.deepEqual(result.missingMetrics.sort(), ["DSCR", "EBITDA"]);
    }
    assert.equal(logged.length, 1);
    assert.equal(logged[0].event_type, "readiness_read_degraded");
    assert.equal(logged[0].metadata.reason, "no_computed_metrics");
  });

  it("returns 'ready' with narrated sections when translator+verifier both succeed", async () => {
    __setVendorApprovalForTests("anthropic", "APPROVED");
    __setLogGatewayCallForTests(async () => {});
    __setProviderImplForTests("anthropic", async (req) => {
      if (isTranslatorCall(req)) {
        return {
          text: JSON.stringify({
            sections: [{ metricKey: "DSCR", narrative: "Your DSCR is 1.35, above the typical 1.25 minimum." }],
          }),
          tokensIn: 50,
          tokensOut: 30,
        };
      }
      return { text: JSON.stringify({ flaggedClaims: [] }), tokensIn: 20, tokensOut: 5 };
    });

    const result = await buildGlassBoxReadinessRead("deal-3", fakeSnapshotClient({ DSCR: 1.35 }));
    assert.equal(result.status, "ready");
    if (result.status === "ready") {
      assert.equal(result.sections.length, 1);
      assert.equal(result.sections[0].metricKey, "DSCR");
      assert.equal(result.sections[0].label, "Debt Service Coverage Ratio");
      assert.ok(result.disclaimer.length > 0);
    }
  });

  it("returns 'degraded' when the verifier flags a critical mismatch", async () => {
    __setVendorApprovalForTests("anthropic", "APPROVED");
    __setLogGatewayCallForTests(async () => {});
    __setProviderImplForTests("anthropic", async (req) => {
      if (isTranslatorCall(req)) {
        return {
          text: JSON.stringify({
            sections: [{ metricKey: "DSCR", narrative: "Your DSCR is 4.0, exceptionally strong." }],
          }),
          tokensIn: 50,
          tokensOut: 30,
        };
      }
      return {
        text: JSON.stringify({
          flaggedClaims: [{ claim: "DSCR is 4.0", reason: "Facts show DSCR is 1.35, not 4.0.", severity: "critical" }],
        }),
        tokensIn: 20,
        tokensOut: 10,
      };
    });

    const logged: Array<{ event_type: string; metadata: any }> = [];
    const result = await buildGlassBoxReadinessRead("deal-4", fakeSnapshotClient({ DSCR: 1.35 }, logged));
    assert.equal(result.status, "degraded");
    assert.equal(logged.length, 1);
    assert.equal(logged[0].event_type, "readiness_read_degraded");
    assert.equal(logged[0].metadata.reason, "verifier_flagged");
  });

  it("does not degrade on a non-critical (warning) flag", async () => {
    __setVendorApprovalForTests("anthropic", "APPROVED");
    __setLogGatewayCallForTests(async () => {});
    __setProviderImplForTests("anthropic", async (req) => {
      if (isTranslatorCall(req)) {
        return {
          text: JSON.stringify({
            sections: [{ metricKey: "DSCR", narrative: "Your DSCR is 1.35." }],
          }),
          tokensIn: 50,
          tokensOut: 30,
        };
      }
      return {
        text: JSON.stringify({
          flaggedClaims: [{ claim: "minor phrasing nit", reason: "could be clearer", severity: "warning" }],
        }),
        tokensIn: 20,
        tokensOut: 10,
      };
    });

    const result = await buildGlassBoxReadinessRead("deal-5", fakeSnapshotClient({ DSCR: 1.35 }));
    assert.equal(result.status, "ready");
  });

  it("returns 'degraded' (not a throw) on the real NPI gate — anthropic is PENDING by default", async () => {
    __setLogGatewayCallForTests(async () => {});
    // Deliberately NOT calling __setVendorApprovalForTests here — exercises
    // the real, un-mocked gate (anthropic defaults to PENDING), proving
    // this is what actually happens today against a real deal, not just a
    // simulated failure.
    const logged: Array<{ event_type: string; metadata: any }> = [];
    const result = await buildGlassBoxReadinessRead("deal-6", fakeSnapshotClient({ DSCR: 1.35 }, logged));
    assert.equal(result.status, "degraded");
    // Audit fix regression guard: this is the actual production path today
    // (all vendors PENDING) — it must be observable as a distinct metric,
    // not just a console.error, since it's the only path most deals hit.
    assert.equal(logged.length, 1);
    assert.equal(logged[0].event_type, "readiness_read_degraded");
    assert.equal(logged[0].metadata.reason, "call_failed");
  });

  it("returns 'degraded' (not a throw) when the translator call fails for a reason other than the NPI gate", async () => {
    __setVendorApprovalForTests("anthropic", "APPROVED");
    __setLogGatewayCallForTests(async () => {});
    __setProviderImplForTests("anthropic", async () => {
      throw new Error("simulated provider outage");
    });

    const logged: Array<{ event_type: string; metadata: any }> = [];
    const result = await buildGlassBoxReadinessRead("deal-7", fakeSnapshotClient({ DSCR: 1.35 }, logged));
    assert.equal(result.status, "degraded");
    assert.equal(logged[0]?.metadata.reason, "call_failed");
  });
});
