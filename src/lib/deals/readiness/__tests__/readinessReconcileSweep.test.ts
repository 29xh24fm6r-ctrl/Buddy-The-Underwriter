import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require_ = createRequire(import.meta.url);
const { selectStaleReadiness } = require_(
  "@/lib/deals/readiness/readinessReconcileSweep",
) as typeof import("@/lib/deals/readiness/readinessReconcileSweep");

const DEAL = "c0f6caab-573a-44d1-ba5d-6bf21a852701";

test("a passing research gate written after the readiness row marks the deal stale", () => {
  // Production 2026-09-08: row evaluated 17:11:22, gate written 17:12:09 by a
  // worker whose refresh hook was refused; the row kept a stale research blocker.
  const stale = selectStaleReadiness(
    [{ deal_id: DEAL, bank_id: "bank-1", evaluated_at: "2026-09-08T17:11:22.300Z" }],
    [{ deal_id: DEAL, at: "2026-09-08T17:12:09.521Z", source: "research_gate" }],
  );
  assert.equal(stale.length, 1);
  assert.equal(stale[0].dealId, DEAL);
  assert.equal(stale[0].newestWriteSource, "research_gate");
});

test("a write inside the grace window is the event that produced the row, not drift", () => {
  const stale = selectStaleReadiness(
    [{ deal_id: DEAL, bank_id: "bank-1", evaluated_at: "2026-09-08T17:12:10.000Z" }],
    [{ deal_id: DEAL, at: "2026-09-08T17:12:09.521Z", source: "research_gate" }],
  );
  assert.equal(stale.length, 0);
});

test("a row newer than every authoritative write is fresh", () => {
  const stale = selectStaleReadiness(
    [{ deal_id: DEAL, bank_id: "bank-1", evaluated_at: "2026-09-08T18:00:00.000Z" }],
    [
      { deal_id: DEAL, at: "2026-09-08T17:12:09.521Z", source: "research_gate" },
      { deal_id: DEAL, at: "2026-09-03T22:45:00.081Z", source: "financial_snapshot" },
    ],
  );
  assert.equal(stale.length, 0);
});

test("deals with writes but no readiness row are ignored; oldest stale rows come first", () => {
  const stale = selectStaleReadiness(
    [
      { deal_id: "newer", bank_id: "b", evaluated_at: "2026-09-08T12:00:00.000Z" },
      { deal_id: "older", bank_id: "b", evaluated_at: "2026-09-01T12:00:00.000Z" },
      { deal_id: "never-evaluated", bank_id: "b", evaluated_at: null },
    ],
    [
      { deal_id: "newer", at: "2026-09-08T13:00:00.000Z", source: "spread" },
      { deal_id: "older", at: "2026-09-08T13:00:00.000Z", source: "financial_fact" },
      { deal_id: "never-evaluated", at: "2026-09-08T13:00:00.000Z", source: "spread" },
      { deal_id: "no-row", at: "2026-09-08T13:00:00.000Z", source: "spread" },
    ],
  );
  assert.deepEqual(stale.map((s) => s.dealId), ["never-evaluated", "older", "newer"]);
});

test("the newest write per deal decides staleness, regardless of input order", () => {
  const stale = selectStaleReadiness(
    [{ deal_id: DEAL, bank_id: "b", evaluated_at: "2026-09-08T17:11:22.300Z" }],
    [
      { deal_id: DEAL, at: "2026-09-03T22:45:00.081Z", source: "financial_snapshot" },
      { deal_id: DEAL, at: "2026-09-08T17:12:09.521Z", source: "research_gate" },
      { deal_id: DEAL, at: "2026-09-03T17:19:00.553Z", source: "financial_fact" },
    ],
  );
  assert.equal(stale.length, 1);
  assert.equal(stale[0].newestWriteAt, "2026-09-08T17:12:09.521Z");
});
