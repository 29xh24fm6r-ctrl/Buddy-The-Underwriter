import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const PACKET_ROUTE = readFileSync(
  join(
    REPO_ROOT,
    "src/app/api/deals/[dealId]/committee/packet/generate/route.ts",
  ),
  "utf8",
);
const SUBMISSION = readFileSync(
  join(
    REPO_ROOT,
    "src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts",
  ),
  "utf8",
);
const SUBMIT_ROUTE = readFileSync(
  join(REPO_ROOT, "src/app/api/deals/[dealId]/credit-memo/submit/route.ts"),
  "utf8",
);

test("[committee-truth-1] packet requires a canonical memo query result", () => {
  assert.match(
    PACKET_ROUTE,
    /data:\s*memoNarrative,\s*error:\s*memoNarrativeError/,
  );
  assert.match(PACKET_ROUTE, /if\s*\(memoNarrativeError\)/);
  assert.match(PACKET_ROUTE, /if\s*\(!memoNarrative\)/);
  assert.match(PACKET_ROUTE, /canonical_memo_required/);
});

test("[committee-truth-2] financial validation is a hard decision gate", () => {
  assert.match(PACKET_ROUTE, /financial_validation_load_failed/);
  assert.match(
    PACKET_ROUTE,
    /!financialValidation\.decisionSafe\s*\|\|\s*financialValidation\.status\s*===\s*"stale"/,
  );
  assert.match(PACKET_ROUTE, /financial_validation_not_decision_safe/);
  assert.doesNotMatch(
    PACKET_ROUTE,
    /Financial validation summary failed \(non-fatal\)/,
  );
});

test("[committee-truth-3] a locked quote cannot masquerade as an attached appendix", () => {
  assert.match(PACKET_ROUTE, /let appendixAttached = false/);
  assert.match(PACKET_ROUTE, /appendixAttached = true/);
  assert.match(PACKET_ROUTE, /hasAppendix:\s*appendixAttached/);
  assert.match(PACKET_ROUTE, /pricing_appendix_generation_failed/);
  assert.doesNotMatch(PACKET_ROUTE, /hasAppendix:\s*!!appendixQuoteId/);
});

test("[committee-truth-4] packet readiness requires durable ledger acknowledgement", () => {
  assert.match(PACKET_ROUTE, /const readyEvent = await writeEvent/);
  assert.match(PACKET_ROUTE, /if\s*\(!readyEvent\.ok\)/);
  assert.match(PACKET_ROUTE, /packet_ready_event_persist_failed/);
});

test("[submission-truth-1] override and version reads fail closed", () => {
  assert.match(
    SUBMISSION,
    /const \{ data, error \} = await sb[\s\S]*?from\("deal_memo_overrides"\)/,
  );
  assert.match(SUBMISSION, /throw new Error\("memo_overrides_load_failed"\)/);
  assert.match(
    SUBMISSION,
    /from\("credit_memo_snapshots"\)[\s\S]*?throw new Error\("memo_version_load_failed"\)/,
  );
});

test("[submission-truth-2] failed supersede compensates the new live snapshot", () => {
  assert.match(SUBMISSION, /let supersedeFailure: string \| null = null/);
  assert.match(
    SUBMISSION,
    /from\("credit_memo_snapshots"\)[\s\S]*?\.delete\(\)[\s\S]*?\.eq\("id", snapshotId\)/,
  );
  assert.match(SUBMISSION, /prior_snapshot_supersede_failed/);
  assert.match(SUBMISSION, /submission_reconciliation_required/);
  assert.doesNotMatch(
    SUBMISSION,
    /failed to supersede prior snapshot\(s\)"[\s\S]{0,500}?\n\s*}\s*catch/,
  );
});

test("[submission-truth-3] client failures are sanitized and non-cacheable", () => {
  assert.match(SUBMIT_ROUTE, /memo_submission_unavailable/);
  assert.match(SUBMIT_ROUTE, /finengine_submission_gate_failed/);
  assert.doesNotMatch(SUBMIT_ROUTE, /error:\s*String\(e\)/);
  assert.match(SUBMIT_ROUTE, /"Cache-Control": "no-store"/);
  assert.doesNotMatch(
    SUBMISSION,
    /reason:\s*"persist_failed",[\s\S]{0,100}?error:\s*dbError/,
  );
});
