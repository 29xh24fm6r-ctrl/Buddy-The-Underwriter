import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(path, "utf8");
}

test("SignWell terminal events are canonicalized and durably persisted", () => {
  const service = source("src/lib/esign/signwell/service.ts");

  for (const event of [
    "document_expired",
    "document_canceled",
    "document_declined",
    "document_bounced",
    "document_error",
  ]) {
    assert.match(service, new RegExp(`${event}: "[A-Z]`));
  }

  const terminalBranch = service.indexOf("if (terminalStatus)");
  const canonicalFetch = service.indexOf("signwell.fetchSignwellDocument(documentId)", terminalBranch);
  const durableWrite = service.indexOf("persistSignwellRequestStatus(", canonicalFetch);
  assert.ok(terminalBranch >= 0, "terminal event branch must exist");
  assert.ok(canonicalFetch > terminalBranch, "terminal events must fetch canonical provider state");
  assert.ok(durableWrite > canonicalFetch, "canonical state must be verified before persistence");
  assert.match(service, /SIGNING_REQUEST_STATUS_UPDATE_FAILED/);
  assert.match(service, /raw_last_event/);
});

test("banker and borrower status lookups bind provider ids to the current deal", () => {
  const bankerRoute = source("src/app/api/deals/[dealId]/esign/route.ts");
  const borrowerRoute = source(
    "src/app/api/brokerage/deals/[dealId]/borrower-actions/[action]/route.ts",
  );

  for (const route of [bankerRoute, borrowerRoute]) {
    const ownershipCheck = route.indexOf('.from("signing_requests")');
    const dealFilter = route.indexOf('.eq("deal_id", dealId)', ownershipCheck);
    const documentFilter = route.indexOf(
      '.eq("signwell_document_id", submissionId)',
      dealFilter,
    );
    const providerFetch = route.indexOf("fetchSignwellDocument(submissionId)", documentFilter);
    assert.ok(ownershipCheck >= 0);
    assert.ok(dealFilter > ownershipCheck);
    assert.ok(documentFilter > dealFilter);
    assert.ok(providerFetch > documentFilter, "provider fetch must follow deal ownership proof");
    assert.match(route, /submission_not_found/);
  }
});

test("terminal requests leave pending lists and borrower polling converges", () => {
  const portalRoute = source("src/app/api/borrower/portal/[token]/esign/route.ts");
  const borrowerRoute = source(
    "src/app/api/brokerage/deals/[dealId]/borrower-actions/[action]/route.ts",
  );
  const panel = source("src/components/brokerage/SigningPanel.tsx");

  assert.match(portalRoute, /!isTerminalSigningRequestStatus\(row\.status\)/);
  assert.match(borrowerRoute, /!isTerminalSigningRequestStatus\(row\.status\)/);
  assert.match(panel, /FAILED_TERMINAL_STATUSES\.has\(normalizedStatus\)/);
  assert.match(panel, /submissionId: null/);
  assert.match(panel, /if \(document\.hidden\) return/);
});
