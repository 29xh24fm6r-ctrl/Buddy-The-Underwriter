/**
 * SPEC-LOAN-REQUEST-JOURNEY-RAIL-STALE-CTA-FIX-1
 *
 * The Journey Rail kept showing "Add Loan Request" after a request was created/submitted because the
 * lifecycle state is memoized for 30s and was never invalidated by loan-request mutations. These tests
 * pin every half of the fix. Placed under src/lib (the `test:unit` gate globs src/lib|scripts|src/app,
 * not src/buddy/src/hooks) so the acceptance gate actually exercises them.
 *
 *   1. computeBlockers only emits `loan_request_missing` when loanRequestCount === 0 → a fresh derivation
 *      after a request exists never shows the CTA (the stale rail came purely from the cache).
 *   2. lifecycleCache.invalidateLifecycleCache(dealId) drops the memoized entry so the next read derives
 *      fresh (get/set/invalidate/scope contract).
 *   3. Client invalidateJourneyState(dealId) clears the shared client cache and broadcasts the event the
 *      hook subscribes to.
 *   4. Wiring guards: actions invalidate the server cache on every mutation; the component fires the
 *      client signal on save/submit/delete; the hook subscribes to the event.
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import { computeBlockers } from "@/buddy/lifecycle/computeBlockers";
import type { LifecycleDerived, LifecycleState } from "@/buddy/lifecycle/model";

const baseDerived: LifecycleDerived = {
  readinessMode: "disabled",
  documentsReady: false,
  documentsReadinessPct: 0,
  underwriteStarted: false,
  financialSnapshotExists: false,
  committeePacketReady: false,
  decisionPresent: false,
  committeeRequired: false,
  pricingQuoteReady: false,
  riskPricingFinalized: false,
  attestationSatisfied: true,
  aiPipelineComplete: true,
  spreadsComplete: true,
  structuralPricingReady: false,
  hasPricingAssumptions: false,
  hasSubmittedLoanRequest: false,
  hasLoanRequestWithAmount: false,
  researchComplete: true,
  criticalFlagsResolved: true,
};

// ── 1. computeBlockers: loan_request_missing only at zero requests ────────────────────────────────
describe("computeBlockers — loan_request_missing only when zero requests", () => {
  it("emits loan_request_missing at docs_in_progress with ZERO requests", () => {
    const codes = computeBlockers("docs_in_progress", baseDerived, 5, 0, false).map((b) => b.code);
    assert.ok(codes.includes("loan_request_missing"));
  });

  it("does NOT emit loan_request_missing once a request exists (rail stops showing Add Loan Request)", () => {
    const codes = computeBlockers("docs_in_progress", baseDerived, 5, 1, false).map((b) => b.code);
    assert.ok(!codes.includes("loan_request_missing"), `unexpected: ${codes.join(",")}`);
  });

  it("a submitted request with an amount yields no loan-request blocker at docs_satisfied", () => {
    const derived = { ...baseDerived, hasSubmittedLoanRequest: true, hasLoanRequestWithAmount: true };
    const codes = computeBlockers("docs_satisfied", derived, 5, 1, false).map((b) => b.code);
    assert.ok(!codes.includes("loan_request_missing"));
    assert.ok(!codes.includes("loan_request_incomplete"));
  });
});

// ── 2. lifecycleCache invalidation ────────────────────────────────────────────────────────────────
describe("lifecycleCache — invalidation drops the memoized lifecycle state", () => {
  let cacheMod: typeof import("@/buddy/lifecycle/lifecycleCache");

  before(async () => {
    mockServerOnly(); // lifecycleCache imports "server-only"
    cacheMod = await import("@/buddy/lifecycle/lifecycleCache");
    cacheMod.__clearLifecycleCacheForTests();
  });

  const state = (stage: LifecycleState["stage"]): LifecycleState => ({
    stage,
    lastAdvancedAt: null,
    blockers: [],
    derived: baseDerived,
  });

  it("get returns null before any set", () => {
    assert.equal(cacheMod.getCachedLifecycleState("deal-x"), null);
  });

  it("set then get returns the cached value", () => {
    cacheMod.setCachedLifecycleState("deal-x", state("docs_satisfied"));
    assert.equal(cacheMod.getCachedLifecycleState("deal-x")?.stage, "docs_satisfied");
  });

  it("invalidate drops the entry so the next read is a miss (re-derives fresh)", () => {
    cacheMod.setCachedLifecycleState("deal-y", state("memo_inputs_required"));
    assert.ok(cacheMod.getCachedLifecycleState("deal-y") !== null);
    cacheMod.invalidateLifecycleCache("deal-y");
    assert.equal(cacheMod.getCachedLifecycleState("deal-y"), null);
  });

  it("invalidate is scoped to the given deal (does not clear others)", () => {
    cacheMod.setCachedLifecycleState("deal-a", state("docs_satisfied"));
    cacheMod.setCachedLifecycleState("deal-b", state("docs_satisfied"));
    cacheMod.invalidateLifecycleCache("deal-a");
    assert.equal(cacheMod.getCachedLifecycleState("deal-a"), null);
    assert.ok(cacheMod.getCachedLifecycleState("deal-b") !== null);
  });

  it("invalidate with an empty dealId is a no-op (never throws)", () => {
    cacheMod.setCachedLifecycleState("deal-keep", state("docs_satisfied"));
    cacheMod.invalidateLifecycleCache("");
    assert.ok(cacheMod.getCachedLifecycleState("deal-keep") !== null);
  });
});

// ── 3. Client invalidateJourneyState event + cache drop ───────────────────────────────────────────
describe("invalidateJourneyState — client signal", () => {
  let hook: typeof import("@/hooks/useJourneyState");
  let setWindow = false;

  before(async () => {
    if (typeof (globalThis as any).window === "undefined") {
      (globalThis as any).window = new EventTarget(); // has add/remove/dispatchEvent
      setWindow = true;
    }
    hook = await import("@/hooks/useJourneyState");
  });

  beforeEach(() => hook.__resetJourneyStateCacheForTests());

  it("dispatches the lifecycle-invalidate event carrying the dealId", () => {
    let received: string | null = null;
    const handler = (e: Event) => { received = (e as CustomEvent).detail?.dealId ?? null; };
    (globalThis as any).window.addEventListener(hook.LIFECYCLE_INVALIDATE_EVENT, handler);
    try {
      hook.invalidateJourneyState("deal-123");
    } finally {
      (globalThis as any).window.removeEventListener(hook.LIFECYCLE_INVALIDATE_EVENT, handler);
    }
    assert.equal(received, "deal-123");
  });

  it("drops the client cache entry for that deal", () => {
    hook.__seedJourneyStateCacheForTests("deal-123", null);
    assert.equal(hook.__hasJourneyStateCacheEntryForTests("deal-123"), true);
    hook.invalidateJourneyState("deal-123");
    assert.equal(hook.__hasJourneyStateCacheEntryForTests("deal-123"), false);
  });

  it("is a no-op for an empty dealId (never throws, never dispatches)", () => {
    let fired = false;
    const handler = () => { fired = true; };
    (globalThis as any).window.addEventListener(hook.LIFECYCLE_INVALIDATE_EVENT, handler);
    try {
      assert.doesNotThrow(() => hook.invalidateJourneyState(""));
    } finally {
      (globalThis as any).window.removeEventListener(hook.LIFECYCLE_INVALIDATE_EVENT, handler);
    }
    assert.equal(fired, false);
  });

  // Restore global so a shared test process is never left with a polyfilled window.
  it("cleanup", () => { if (setWindow) delete (globalThis as any).window; });
});

// ── 4. Wiring guards (source-level) ───────────────────────────────────────────────────────────────
describe("wiring guards", () => {
  const root = path.resolve(__dirname, "../../../..");
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");

  it("loan request actions invalidate the server lifecycle cache on every mutation", () => {
    const src = read("src/lib/loanRequests/actions.ts");
    assert.match(src, /import\s*\{\s*invalidateLifecycleCache\s*\}\s*from\s*"@\/buddy\/lifecycle\/lifecycleCache"/);
    const calls = (src.match(/invalidateLifecycleCache\(/g) ?? []).length;
    assert.ok(calls >= 3, `expected >=3 invalidateLifecycleCache calls (create/update/delete), found ${calls}`);
  });

  it("deriveLifecycleState reads + writes through the shared invalidatable cache", () => {
    const src = read("src/buddy/lifecycle/deriveLifecycleState.ts");
    assert.match(src, /getCachedLifecycleState|setCachedLifecycleState/);
    assert.ok(!/new Map<string,\s*\{\s*expiresAt/.test(src), "the private lifecycle Map must be removed");
  });

  it("LoanRequestsSection fires the client signal after save, submit, and delete", () => {
    const src = read("src/components/loanRequests/LoanRequestsSection.tsx");
    assert.match(src, /import\s*\{\s*invalidateJourneyState\s*\}\s*from\s*"@\/hooks\/useJourneyState"/);
    const calls = (src.match(/invalidateJourneyState\(dealId\)/g) ?? []).length;
    assert.ok(calls >= 3, `expected >=3 invalidateJourneyState(dealId) calls, found ${calls}`);
  });

  it("useJourneyState subscribes to + cleans up the invalidate event", () => {
    const src = read("src/hooks/useJourneyState.ts");
    assert.match(src, /addEventListener\(\s*LIFECYCLE_INVALIDATE_EVENT/);
    assert.match(src, /removeEventListener\(\s*LIFECYCLE_INVALIDATE_EVENT/);
  });

  it("ordinary loan-request list reload is preserved (component still calls load())", () => {
    const src = read("src/components/loanRequests/LoanRequestsSection.tsx");
    assert.match(src, /await load\(\)/);
  });
});
