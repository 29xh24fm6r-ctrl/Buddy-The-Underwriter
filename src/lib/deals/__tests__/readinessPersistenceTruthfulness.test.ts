import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  requireCountResult,
  requireDataResult,
  requireMutationRow,
  requireNoError,
  requireWriteEventResult,
} from "../readinessPersistence";

test("rejects returned PostgREST errors with operation and code", () => {
  assert.throws(
    () =>
      requireNoError(
        {
          error: {
            message: "permission denied for table deals",
            code: "42501",
          },
        },
        "readiness_ready_update_failed",
      ),
    /readiness_ready_update_failed: permission denied for table deals \[42501\]/,
  );
});

test("rejects silent zero-row mutations", () => {
  assert.throws(
    () =>
      requireMutationRow(
        { data: null, error: null },
        "readiness_clear_update_failed",
      ),
    /readiness_clear_update_failed: row_missing/,
  );
});

test("rejects missing count evidence instead of treating it as zero", () => {
  assert.throws(
    () =>
      requireCountResult(
        { count: null, error: null },
        "readiness_upload_count_failed",
      ),
    /readiness_upload_count_failed: count_unavailable/,
  );
});

test("returns proven data and zero counts", () => {
  assert.deepEqual(
    requireDataResult(
      { data: { id: "deal-1" }, error: null },
      "readiness_deal_read_failed",
    ),
    { id: "deal-1" },
  );
  assert.equal(
    requireCountResult(
      { count: 0, error: null },
      "readiness_upload_count_failed",
    ),
    0,
  );
});

test("rejects canonical event persistence failures", () => {
  assert.throws(
    () =>
      requireWriteEventResult(
        { ok: false, error: "insert denied" },
        "readiness_reverted_event_failed",
      ),
    /readiness_reverted_event_failed: insert denied/,
  );
});

test("canonical readiness writer wires every authoritative failure guard", () => {
  const source = readFileSync(
    join(process.cwd(), "src/lib/deals/readiness.ts"),
    "utf8",
  );

  for (const token of [
    "readiness_upload_count_failed",
    "readiness_artifact_count_failed",
    "readiness_spread_invariant_failed",
    "readiness_entity_binding_failed",
    "readiness_checklist_read_failed",
    "readiness_pfs_count_failed",
    "readiness_deal_read_failed",
    "readiness_checklist_reconcile_failed",
    "readiness_ready_update_failed",
    "readiness_ready_readback_failed",
    "readiness_ready_persistence_unproven",
    "readiness_pipeline_insert_failed",
    "readiness_ready_rollback_failed",
    "readiness_clear_update_failed",
    "readiness_clear_persistence_unproven",
    "readiness_reverted_event_failed",
    "readiness_regression_rollback_failed",
    "readiness_cached_read_failed",
  ]) {
    assert.match(source, new RegExp(token));
  }

  assert.match(
    source,
    /readiness_regressed[\s\S]*?scheduleReadinessRefresh\(/,
  );
});
