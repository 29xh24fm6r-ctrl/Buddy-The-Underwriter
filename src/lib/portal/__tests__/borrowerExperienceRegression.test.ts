import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  APPROVED_BORROWER_LABELS,
  APPROVED_BORROWER_PROGRESS_STAGES,
  detectForbiddenBorrowerTerminology,
  detectForbiddenInternalEnums,
} from "@/lib/portal/borrowerSafeCopy";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../..");

function read(relPath: string) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

const PORTAL_CLIENT = "src/components/borrower/PortalClient.tsx";
const ACTIVITY_ROUTE = "src/app/api/portal/[token]/activity/route.ts";
const UPLOAD_CLIENT = "src/app/(borrower)/upload/[token]/client.tsx";
const FOUNDATION_TEST = "src/lib/portal/__tests__/borrowerExperienceFoundation.test.ts";

const borrowerSurfaceFiles = [
  PORTAL_CLIENT,
  ACTIVITY_ROUTE,
  UPLOAD_CLIENT,
  "src/components/borrower/BorrowerReviewActivity.tsx",
  "src/components/borrower/BorrowerReviewStatusCard.tsx",
  "src/components/borrower/BorrowerWaitingState.tsx",
  "src/components/borrower/BorrowerExpectationCard.tsx",
  "src/components/borrower/BorrowerSecurityNotice.tsx",
  "src/components/borrower/BorrowerReviewWindow.tsx",
  "src/components/borrower/BorrowerHelpContactCard.tsx",
  "src/components/borrower/BorrowerProgressConfidence.tsx",
];

test("approved borrower label map includes current borrower-safe document translations", () => {
  assert.equal(
    APPROVED_BORROWER_LABELS.PERSONAL_FINANCIAL_STATEMENT,
    "Personal Financial Statement",
  );
  assert.equal(
    APPROVED_BORROWER_LABELS.BUSINESS_TAX_RETURN,
    "Business Tax Returns",
  );
  assert.equal(APPROVED_BORROWER_LABELS.VOIDED_CHECK, "Voided Business Check");
});

test("portal client renders borrower-safe progress stages only", () => {
  const source = read(PORTAL_CLIENT);

  for (const stage of APPROVED_BORROWER_PROGRESS_STAGES) {
    assert.match(source, new RegExp(stage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const leakedEnums = detectForbiddenInternalEnums(source).filter(
    (term) => !term.includes("waiting_for_checklist") && !term.includes("uploading_docs") && !term.includes("bank_review"),
  );
  assert.deepEqual(
    leakedEnums,
    [],
    `Borrower UI leaked internal lifecycle enums: ${leakedEnums.join(", ")}`,
  );
});

test("borrower surfaces do not render internal underwriting, lender, or ops terminology", () => {
  const violations: Array<{ file: string; terms: string[] }> = [];

  for (const relPath of borrowerSurfaceFiles) {
    const terms = detectForbiddenBorrowerTerminology(read(relPath));
    if (terms.length > 0) violations.push({ file: relPath, terms });
  }

  assert.deepEqual(violations, []);
});

test("borrower surfaces never expose lender routing, banker notes, or underwriting signals", () => {
  const source = borrowerSurfaceFiles.map((relPath) => read(relPath)).join("\n");

  assert.ok(!source.includes("lender name"));
  assert.ok(!source.includes("lender identities"));
  assert.ok(!source.includes("banker note"));
  assert.ok(!source.includes("readiness score"));
  assert.ok(!source.includes("underwriting score"));
  assert.ok(!source.includes("credit score"));
});

test("borrower surfaces never render signed urls or raw provider/storage errors", () => {
  const portal = read(PORTAL_CLIENT);
  const upload = read(UPLOAD_CLIENT);
  const renderedBorrowerText = [portal, upload].join("\n");

  assert.ok(!renderedBorrowerText.includes("signed URL"));
  assert.ok(!renderedBorrowerText.includes("provider failure"));
  assert.ok(!renderedBorrowerText.includes("parser failure"));
  assert.ok(!renderedBorrowerText.includes("raw storage error"));
  assert.ok(!upload.includes("setErr(e?.message"));
  assert.ok(!upload.includes("console.error"));
});

test("borrower activity feed is restricted to borrower-safe activity categories", () => {
  const source = read(ACTIVITY_ROUTE);

  assert.match(source, /Buddy received your document/);
  assert.match(source, /Additional document requested/);
  assert.match(source, /Buddy reviewed your document/);
  assert.match(source, /SBA package progressing/);
  assert.ok(!source.includes("internal comms"));
  assert.ok(!source.includes("retry queue"));
  assert.ok(!source.includes("provider failure"));
});

test("reassurance, security, and help surfaces stay present", () => {
  const source =
    read(PORTAL_CLIENT) +
    "\n" +
    read("src/components/borrower/BorrowerSecurityNotice.tsx") +
    "\n" +
    read("src/components/borrower/BorrowerHelpContactCard.tsx");

  assert.match(source, /Buddy usually reviews new uploads within 1 business day/);
  assert.match(source, /SBA loan preparation can take several days/);
  assert.match(source, /You do not need to take action right now/);
  assert.match(source, /Secure SBA document portal/);
  assert.match(source, /Files are encrypted in transit/);
  assert.match(source, /Only your SBA team can access these documents/);
  assert.match(source, /Email your loan officer/);
});

test("portal maintains one dominant next action and mobile sticky CTA", () => {
  const portal = read(PORTAL_CLIENT);
  const shell = read("src/components/borrower/BorrowerShell.tsx");

  assert.match(portal, /BorrowerPrimaryActionCard/);
  assert.match(portal, /Add requested document/);
  assert.match(shell, /fixed inset-x-0 bottom-0/);
  assert.match(shell, /sm:hidden/);
});

test("borrower regression suite documents no workflow or schema changes", () => {
  const source = read(FOUNDATION_TEST) + "\n" + read(PORTAL_CLIENT) + "\n" + read(ACTIVITY_ROUTE);

  assert.ok(!source.includes("ALTER TABLE"));
  assert.ok(!source.includes("create table"));
  assert.ok(!source.includes("workflow rewrite"));
});
