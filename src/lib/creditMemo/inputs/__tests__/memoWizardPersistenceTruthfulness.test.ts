import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROUTE = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/app/api/deals/[dealId]/memo-inputs/route.ts",
  ),
  "utf-8",
);
const WIZARD = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/components/creditMemo/MemoCompletionWizard.tsx",
  ),
  "utf-8",
);
const REVIEW = fs.readFileSync(
  path.join(
    process.cwd(),
    "src/components/creditMemo/BankerReviewPanel.tsx",
  ),
  "utf-8",
);

function functionBody(source: string, startToken: string, endToken: string) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  assert.ok(start >= 0, `${startToken} must exist`);
  assert.ok(end > start, `${endToken} must follow ${startToken}`);
  return source.slice(start, end);
}

test("[memo-wizard.truth-1] owner lookup failures cannot collapse into an empty owner list", () => {
  const body = functionBody(
    ROUTE,
    "async function postFromWizard(",
    "// ── Verb dispatchers",
  );
  assert.match(body, /data:\s*ownersRaw,\s*error:\s*ownersError/);
  assert.match(body, /if\s*\(ownersError\)/);
  assert.match(body, /const lookupFailures = \["management_owner_lookup"\]/);
  assert.match(body, /const lookupAudit = await writeEvent/);
  assert.match(body, /failedOperations:\s*lookupFailures/);
  assert.match(body, /status:\s*500/);
});

test("[memo-wizard.truth-2] every canonical writer failure is accumulated", () => {
  const body = functionBody(
    ROUTE,
    "async function postFromWizard(",
    "// ── Verb dispatchers",
  );
  assert.match(body, /failedOperations\.push\("borrower_story"\)/);
  assert.match(body, /failedOperations\.push\("management_profile"\)/);
  assert.match(body, /failedOperations\.push\("audit_event"\)/);
});

test("[memo-wizard.truth-3] success is returned only after the failure gate", () => {
  const body = functionBody(
    ROUTE,
    "async function postFromWizard(",
    "// ── Verb dispatchers",
  );
  const failureGate = body.indexOf("if (failedOperations.length > 0)");
  const successResponse = body.lastIndexOf("ok: true");
  assert.ok(failureGate >= 0, "failure gate must exist");
  assert.ok(
    successResponse > failureGate,
    "the success response must follow the persistence failure gate",
  );
  assert.match(body, /error:\s*"memo_input_persistence_failed"/);
  assert.match(body, /"Cache-Control":\s*"no-store"/);
});

test("[memo-wizard.truth-4] audit metadata records requested and failed work", () => {
  const body = functionBody(
    ROUTE,
    "async function postFromWizard(",
    "// ── Verb dispatchers",
  );
  assert.match(body, /requested_management_writes:\s*managementInputs\.length/);
  assert.match(body, /failed_operations:\s*failedOperations/);
  assert.match(body, /save_ok:\s*failedOperations\.length === 0/);
  assert.match(body, /if\s*\(!auditResult\.ok\)/);
});

test("[memo-wizard.truth-5] completion wizard requires transport and body success", () => {
  const body = functionBody(WIZARD, "const save = async ()", "return (");
  assert.match(body, /const data = await res\.json\(\)\.catch/);
  assert.match(body, /!res\.ok \|\| !data\?\.ok/);
  assert.match(body, /setSaveError/);
  assert.match(WIZARD, /role=\{saveError \? "alert" : undefined\}/);
});

test("[memo-wizard.truth-6] failed review saves block underwriting submission", () => {
  const saveBody = functionBody(
    REVIEW,
    "const saveOverrides = useCallback",
    "// Debounced auto-save",
  );
  assert.match(saveBody, /return false/);
  assert.match(saveBody, /return true/);

  const flushBody = functionBody(
    REVIEW,
    "const flushPendingTextSave = useCallback",
    "// Mark a tab as viewed",
  );
  assert.match(flushBody, /if\s*\(!saved\)/);
  assert.match(flushBody, /if\s*\(!attemptedFreshSave && saveError\)/);
  assert.match(flushBody, /Unsaved memo changes blocked submission/);
});
