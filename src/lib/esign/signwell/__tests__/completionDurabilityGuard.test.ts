import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("provider completion is reconciled into Buddy storage before either status API reports success", () => {
  const routes = [
    source("src/app/api/deals/[dealId]/esign/route.ts"),
    source("src/app/api/brokerage/deals/[dealId]/borrower-actions/[action]/route.ts"),
  ];

  for (const route of routes) {
    const providerFetch = route.indexOf("fetchSignwellDocument(submissionId)");
    const completionCheck = route.indexOf(
      "isCompletedSigningRequestStatus(document.status)",
      providerFetch,
    );
    const reconciliation = route.indexOf("reconcileSignwellCompletion(", completionCheck);
    const failure = route.indexOf('"completion_persistence_failed"', reconciliation);
    const durableSuccess = route.indexOf("signedDocument: reconciled.signedDocument", failure);
    const rawProviderReturn = route.indexOf(
      "status: document.status, submission: document",
      durableSuccess,
    );

    assert.ok(providerFetch >= 0, "status route must read canonical provider state");
    assert.ok(completionCheck > providerFetch, "completed provider states need an explicit branch");
    assert.ok(reconciliation > completionCheck, "completion must run durable reconciliation");
    assert.ok(failure > reconciliation, "reconciliation failures must be visible");
    assert.ok(durableSuccess > failure, "success must return the persisted signed document");
    assert.ok(rawProviderReturn > durableSuccess, "only non-completed states may return provider status");
    assert.match(route, /completion_persistence_failed[\s\S]*status: 503/);
  }
});

test("completion reconciliation confirms the signed_documents row after the webhook pipeline", () => {
  const service = source("src/lib/esign/signwell/service.ts");
  const helper = service.indexOf("export async function reconcileSignwellCompletion");
  const completionGuard = service.indexOf("isCompletedSigningRequestStatus", helper);
  const webhookPipeline = service.indexOf("handleSignwellWebhook(", completionGuard);
  const durableRead = service.indexOf('.from("signed_documents")', webhookPipeline);
  const dealScope = service.indexOf('.eq("deal_id", args.dealId)', durableRead);
  const documentScope = service.indexOf('.eq("esign_document_id", documentId)', dealScope);
  const failClosed = service.indexOf("signed_document_not_durable_after_reconciliation", documentScope);

  assert.ok(helper >= 0);
  assert.ok(completionGuard > helper);
  assert.ok(webhookPipeline > completionGuard);
  assert.ok(durableRead > webhookPipeline, "webhook persistence must finish before the durable read");
  assert.ok(dealScope > durableRead);
  assert.ok(documentScope > dealScope);
  assert.ok(failClosed > documentScope);
});
