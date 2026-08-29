import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("IAL2 and legal-review admission preserve authoritative read failures", () => {
  const identity = source("src/lib/identity/kyc/service.ts");
  const legal = source("src/lib/sba/legalReview/service.ts");

  const ial2Helper = identity.indexOf("export async function readIal2AdmissionState");
  const ial2Read = identity.indexOf("const { data, error }", ial2Helper);
  const ial2Failure = identity.indexOf("return { ok: false, detail:", ial2Read);
  const ial2Negative = identity.indexOf("return { ok: true, valid: false }", ial2Failure);
  assert.ok(ial2Helper >= 0);
  assert.ok(ial2Read > ial2Helper);
  assert.ok(ial2Failure > ial2Read, "database errors must remain unavailable");
  assert.ok(ial2Negative > ial2Failure, "missing verification must stay distinct from read failure");

  const legalHelper = legal.indexOf("export async function readLegalReviewAdmissionState");
  const legalRead = legal.indexOf("const { data, error }", legalHelper);
  const legalFailure = legal.indexOf("return { ok: false, detail:", legalRead);
  const legalNegative = legal.indexOf("complete: Boolean(data?.id)", legalFailure);
  assert.ok(legalHelper >= 0);
  assert.ok(legalRead > legalHelper);
  assert.ok(legalFailure > legalRead, "legal-review database errors must remain unavailable");
  assert.ok(legalNegative > legalFailure, "unapproved review must stay distinct from read failure");
});

test("signature request fails before provider handoff when gate state is unavailable", () => {
  const service = source("src/lib/esign/signwell/service.ts");
  const request = service.indexOf("export async function requestSignature");
  const ial2Read = service.indexOf("readIal2AdmissionState(", request);
  const ial2Unavailable = service.indexOf('"SIGNING_STATE_UNAVAILABLE"', ial2Read);
  const legalRead = service.indexOf("readLegalReviewAdmissionState(", ial2Unavailable);
  const legalUnavailable = service.indexOf('"SIGNING_STATE_UNAVAILABLE"', legalRead);
  const providerCreate = service.indexOf("signwell.createSignwellDocumentFromFile(", legalUnavailable);

  assert.ok(request >= 0);
  assert.ok(ial2Read > request);
  assert.ok(ial2Unavailable > ial2Read);
  assert.ok(legalRead > ial2Unavailable);
  assert.ok(legalUnavailable > legalRead);
  assert.ok(providerCreate > legalUnavailable, "no SignWell document may be created before both gates are proven");
});

test("completion and route preserve retryable unavailable-state semantics", () => {
  const service = source("src/lib/esign/signwell/service.ts");
  const route = source("src/app/api/deals/[dealId]/esign/route.ts");

  const completion = service.indexOf("export async function handleSignwellWebhook");
  const ial2Read = service.indexOf("readIal2AdmissionState(", completion);
  const readFailure = service.indexOf('"SIGNING_STATE_READ_FAILED"', ial2Read);
  const anomaly = service.indexOf('"IAL2_GATE_FAILED_AT_COMPLETION"', readFailure);
  assert.ok(ial2Read > completion);
  assert.ok(readFailure > ial2Read);
  assert.ok(anomaly > readFailure, "unavailable identity state must not be logged as a proven IAL2 anomaly");

  assert.match(route, /SIGNING_STATE_UNAVAILABLE"[\s\S]*?\? 503/);
  assert.match(route, /IAL2_NOT_COMPLETED"[\s\S]*?LEGAL_REVIEW_NOT_COMPLETED"[\s\S]*?\? 403/);
});
