import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require_ = createRequire(import.meta.url);
const { isRetryableBIEDiagnostic } =
  require_("@/lib/research/buddyIntelligenceEngine") as typeof import("@/lib/research/buddyIntelligenceEngine");

/**
 * Regression for specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md (round 4): only
 * genuinely transient BIE thread failures should be retried in-process —
 * retrying a content-policy refusal or a malformed-JSON response (already
 * repair-attempted) wastes an API call chasing a likely-deterministic
 * outcome.
 */

const diag = (over: Partial<Parameters<typeof isRetryableBIEDiagnostic>[0]>) =>
  ({ thread: "borrower", ok: false, prompt_chars: 10, source_count: 0, model: "m", created_at: "t", ...over }) as any;

test("network_error is retryable", () => {
  assert.equal(isRetryableBIEDiagnostic(diag({ error_type: "network_error" })), true);
});

test("empty_candidate / empty_text are retryable", () => {
  assert.equal(isRetryableBIEDiagnostic(diag({ error_type: "empty_candidate" })), true);
  assert.equal(isRetryableBIEDiagnostic(diag({ error_type: "empty_text" })), true);
});

test("http_error is retryable for 429/5xx/408/unknown-status, not for 4xx client errors", () => {
  assert.equal(isRetryableBIEDiagnostic(diag({ error_type: "http_error", http_status: 429 })), true);
  assert.equal(isRetryableBIEDiagnostic(diag({ error_type: "http_error", http_status: 503 })), true);
  assert.equal(isRetryableBIEDiagnostic(diag({ error_type: "http_error", http_status: 408 })), true);
  assert.equal(isRetryableBIEDiagnostic(diag({ error_type: "http_error", http_status: null })), true);
  assert.equal(isRetryableBIEDiagnostic(diag({ error_type: "http_error", http_status: 404 })), false);
  assert.equal(isRetryableBIEDiagnostic(diag({ error_type: "http_error", http_status: 400 })), false);
});

test("safety_block and json_parse_error are NOT retryable (likely deterministic)", () => {
  assert.equal(isRetryableBIEDiagnostic(diag({ error_type: "safety_block" })), false);
  assert.equal(isRetryableBIEDiagnostic(diag({ error_type: "json_parse_error" })), false);
});

test("thread_threw, fallback_used, skipped, finish_reason, unknown_error are NOT retryable", () => {
  for (const error_type of ["thread_threw", "fallback_used", "skipped", "finish_reason", "unknown_error"] as const) {
    assert.equal(isRetryableBIEDiagnostic(diag({ error_type })), false, `${error_type} should not be retryable`);
  }
});
