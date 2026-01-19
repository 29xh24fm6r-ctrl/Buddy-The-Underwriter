import test from "node:test";
import assert from "node:assert/strict";

import { buildBorrowerTasksFromChecklist } from "@/lib/portal/tasks";
import { isBorrowerUploadAllowed } from "@/lib/deals/lifecycleGuards";
import { buildUnderwritingGate } from "@/lib/deals/underwritingGate";
import { narrateLedgerEvent } from "@/buddy/ledgerNarration";

test("borrower upload satisfies multiple checklist items", () => {
  const tasks = buildBorrowerTasksFromChecklist([
    {
      id: "1",
      checklist_key: "IRS_BUSINESS_3Y",
      title: "Business tax returns (3 years)",
      required: true,
      status: "satisfied",
      required_years: [2021, 2022, 2023],
      satisfied_years: [2021, 2022, 2023],
    },
    {
      id: "2",
      checklist_key: "IRS_PERSONAL_3Y",
      title: "Personal tax returns (3 years)",
      required: true,
      status: "received",
    },
  ]);

  const completed = tasks.filter((t) => t.status === "received");
  assert.equal(completed.length, 2);
});

test("borrower cannot upload after underwriting start", () => {
  assert.equal(isBorrowerUploadAllowed("underwriting"), false);
  assert.equal(isBorrowerUploadAllowed("ready"), false);
});

test("underwriting CTA disabled until ready", () => {
  const blocked = buildUnderwritingGate({
    lifecycleStage: "collecting",
    missingRequiredTitles: ["Rent Roll"],
  });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.blockers.length > 0);

  const allowed = buildUnderwritingGate({
    lifecycleStage: "collecting",
    missingRequiredTitles: [],
  });
  assert.equal(allowed.allowed, true);
});

test("buddy narration emitted on borrower upload/checklist update/underwriting start", () => {
  assert.ok(narrateLedgerEvent("deal.document.uploaded"));
  assert.ok(narrateLedgerEvent("deal.checklist.updated", { received: 2, total: 5 }));
  assert.ok(narrateLedgerEvent("deal.underwriting.started"));
});
