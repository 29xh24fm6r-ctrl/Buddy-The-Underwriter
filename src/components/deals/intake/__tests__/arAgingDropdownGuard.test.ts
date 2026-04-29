/**
 * Manual document-type dropdown guard for AR_AGING.
 *
 * Bankers can manually classify (or reclassify) a document via the intake
 * review row's type dropdown and via DealFilesCard's manual override
 * dropdown. AR_AGING must appear in both lists so AR aging documents that
 * the auto-classifier missed can be corrected without going through the
 * pipeline a second time.
 *
 * Pure file-content guard — no React rendering, no DOM. Mirrors the pattern
 * used in financialIntegrityGuard.test.ts and other CI guards in this repo.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CHECKLIST_KEY_OPTIONS } from "../../../../lib/checklist/checklistKeyOptions";

const INTAKE_REVIEW_TABLE = resolve(
  __dirname,
  "../IntakeReviewTable.tsx",
);
const DEAL_FILES_CARD = resolve(
  __dirname,
  "../../DealFilesCard.tsx",
);
const CONFIRM_ROUTE = resolve(
  __dirname,
  "../../../../app/api/deals/[dealId]/intake/documents/[documentId]/confirm/route.ts",
);

describe("AR_AGING manual dropdown guard", () => {
  test("IntakeReviewTable DOC_TYPE_OPTIONS includes AR_AGING", () => {
    const src = readFileSync(INTAKE_REVIEW_TABLE, "utf-8");
    // The constant is module-private; assert the literal entry instead.
    assert.match(
      src,
      /value:\s*"AR_AGING"/,
      "IntakeReviewTable must include AR_AGING in DOC_TYPE_OPTIONS",
    );
  });

  test("IntakeReviewTable AR_AGING uses 'Accounts Receivable Aging' label", () => {
    const src = readFileSync(INTAKE_REVIEW_TABLE, "utf-8");
    assert.match(
      src,
      /"AR_AGING".*"Accounts Receivable Aging"/s,
      "IntakeReviewTable must label AR_AGING as 'Accounts Receivable Aging'",
    );
  });

  test("CHECKLIST_KEY_OPTIONS includes AR_AGING (source of DealFilesCard dropdown)", () => {
    // DealFilesCard derives its dropdown from CHECKLIST_KEY_OPTIONS, so
    // verifying AR_AGING is present here covers that surface.
    const arAging = CHECKLIST_KEY_OPTIONS.find((o) => o.docType === "AR_AGING");
    assert.ok(
      arAging,
      "CHECKLIST_KEY_OPTIONS must include an entry with docType=AR_AGING",
    );
  });

  test("DealFilesCard applies AR_AGING label override", () => {
    const src = readFileSync(DEAL_FILES_CARD, "utf-8");
    assert.match(
      src,
      /AR_AGING:\s*"Accounts Receivable Aging"/,
      "DealFilesCard must override AR_AGING label to 'Accounts Receivable Aging'",
    );
  });

  test("Manual confirm route exempts AR_AGING from checklist-key requirement", () => {
    // Without this, a banker's manual confirm of an AR_AGING-classified doc
    // fails finalization because resolveChecklistKey returns null for it.
    const src = readFileSync(CONFIRM_ROUTE, "utf-8");
    // Look for AR_AGING inside the CHECKLIST_KEY_EXEMPT Set literal.
    assert.match(
      src,
      /CHECKLIST_KEY_EXEMPT[\s\S]*?"AR_AGING"[\s\S]*?\]/,
      "confirm/route.ts must list AR_AGING in CHECKLIST_KEY_EXEMPT",
    );
  });
});
