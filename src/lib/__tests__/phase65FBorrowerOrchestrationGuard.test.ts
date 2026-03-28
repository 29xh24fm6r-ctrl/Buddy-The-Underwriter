import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// ── Guard 1: Core orchestration modules exist ────────────────
test("borrower orchestration modules exist", () => {
  const files = [
    "src/core/borrower-orchestration/types.ts",
    "src/core/borrower-orchestration/borrowerRequestCatalog.ts",
    "src/core/borrower-orchestration/mapCanonicalActionToBorrowerPlan.ts",
    "src/core/borrower-orchestration/createBorrowerCampaign.ts",
    "src/core/borrower-orchestration/sendBorrowerCampaign.ts",
    "src/core/borrower-orchestration/scheduleBorrowerReminders.ts",
    "src/core/borrower-orchestration/reconcileBorrowerProgress.ts",
    "src/core/borrower-orchestration/deriveBorrowerPortalStatus.ts",
    "src/core/borrower-orchestration/completeBorrowerCampaign.ts",
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  }
});

// ── Guard 2: Migration exists ────────────────────────────────
test("borrower orchestration migration exists", () => {
  const f = "supabase/migrations/20260328_borrower_orchestration.sql";
  assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  const content = fs.readFileSync(path.resolve(root, f), "utf8");
  assert.ok(content.includes("borrower_request_campaigns"), "Must create campaigns table");
  assert.ok(content.includes("borrower_request_items"), "Must create items table");
  assert.ok(content.includes("borrower_request_events"), "Must create events table");
  assert.ok(content.includes("borrower_reminder_schedule"), "Must create reminder schedule table");
});

// ── Guard 3: No Omega imports in orchestration layer ─────────
test("no Omega imports in borrower orchestration", () => {
  const files = [
    "src/core/borrower-orchestration/types.ts",
    "src/core/borrower-orchestration/borrowerRequestCatalog.ts",
    "src/core/borrower-orchestration/mapCanonicalActionToBorrowerPlan.ts",
    "src/core/borrower-orchestration/createBorrowerCampaign.ts",
    "src/core/borrower-orchestration/sendBorrowerCampaign.ts",
    "src/core/borrower-orchestration/reconcileBorrowerProgress.ts",
    "src/core/borrower-orchestration/deriveBorrowerPortalStatus.ts",
  ];
  for (const f of files) {
    const content = fs.readFileSync(path.resolve(root, f), "utf8");
    assert.ok(!content.includes("@/core/omega"), `${f} must not import Omega`);
  }
});

// ── Guard 4: Campaign creation requires canonical execution ──
test("campaign creation requires canonical execution source", () => {
  const serviceContent = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/createBorrowerCampaign.ts"),
    "utf8",
  );
  assert.ok(
    serviceContent.includes("canonicalExecutionId"),
    "Must require canonical execution ID",
  );
  assert.ok(
    serviceContent.includes("canonical_execution_id"),
    "Must store canonical execution reference",
  );

  const routeContent = fs.readFileSync(
    path.resolve(root, "src/app/api/deals/[dealId]/borrower-campaigns/route.ts"),
    "utf8",
  );
  assert.ok(
    routeContent.includes("canonical_action_executions"),
    "Campaign route must validate against canonical executions",
  );
});

// ── Guard 5: Borrower endpoints do not expose blocker codes ──
test("portal request-status does not expose blocker codes", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/app/api/portal/[token]/request-status/route.ts"),
    "utf8",
  );
  assert.ok(!content.includes("blocker_code"), "Must not return blocker_code to borrower");
  assert.ok(!content.includes("blockerCode"), "Must not return blockerCode to borrower");
});

// ── Guard 6: Reminder processor route exists ─────────────────
test("reminder processor route exists", () => {
  const f = "src/app/api/admin/borrower-reminders/process/route.ts";
  assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  const content = fs.readFileSync(path.resolve(root, f), "utf8");
  assert.ok(content.includes("processBorrowerReminders"), "Must call processor");
  assert.ok(content.includes("CRON_SECRET"), "Must auth via CRON_SECRET");
});

// ── Guard 7: Portal request-status route exists ──────────────
test("portal request-status route exists", () => {
  const f = "src/app/api/portal/[token]/request-status/route.ts";
  assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  const content = fs.readFileSync(path.resolve(root, f), "utf8");
  assert.ok(content.includes("deriveBorrowerPortalStatus"), "Must derive borrower status");
  assert.ok(content.includes("borrower_portal_links"), "Must validate portal token");
});

// ── Guard 8: Borrower request catalog has no internal jargon ─
test("borrower request catalog uses plain language", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/borrowerRequestCatalog.ts"),
    "utf8",
  );
  assert.ok(!content.includes("Omega"), "Must not mention Omega");
  assert.ok(!content.includes("blocker"), "Must not use blocker terminology");
  assert.ok(!content.includes("lifecycle"), "Must not use lifecycle terminology");
  assert.ok(!content.includes("canonical"), "Must not use canonical terminology");
});

// ── Guard 9: Campaign API routes exist ───────────────────────
test("campaign API routes exist", () => {
  const routes = [
    "src/app/api/deals/[dealId]/borrower-campaigns/route.ts",
    "src/app/api/deals/[dealId]/borrower-campaigns/[campaignId]/resend/route.ts",
    "src/app/api/deals/[dealId]/borrower-campaigns/[campaignId]/pause/route.ts",
    "src/app/api/deals/[dealId]/borrower-campaigns/[campaignId]/cancel/route.ts",
  ];
  for (const f of routes) {
    assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  }
});

// ── Guard 10: Campaign routes authenticate ───────────────────
test("campaign routes use ensureDealBankAccess", () => {
  const routes = [
    "src/app/api/deals/[dealId]/borrower-campaigns/route.ts",
    "src/app/api/deals/[dealId]/borrower-campaigns/[campaignId]/resend/route.ts",
    "src/app/api/deals/[dealId]/borrower-campaigns/[campaignId]/pause/route.ts",
    "src/app/api/deals/[dealId]/borrower-campaigns/[campaignId]/cancel/route.ts",
  ];
  for (const f of routes) {
    const content = fs.readFileSync(path.resolve(root, f), "utf8");
    assert.ok(
      content.includes("ensureDealBankAccess"),
      `${f} must authenticate via ensureDealBankAccess`,
    );
  }
});

// ── Guard 11: Borrower UI components exist ───────────────────
test("borrower UI components exist", () => {
  const files = [
    "src/components/borrower/BorrowerRequestChecklist.tsx",
    "src/components/borrower/BorrowerRequestStatusBanner.tsx",
    "src/components/borrower/BorrowerPortalProgress.tsx",
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  }
});

// ── Guard 12: Banker cockpit components exist ────────────────
test("banker cockpit components exist", () => {
  const files = [
    "src/components/deals/BorrowerCampaignPanel.tsx",
    "src/components/deals/BorrowerCampaignTimeline.tsx",
    "src/components/deals/BorrowerReminderControls.tsx",
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  }
});

// ── Guard 13: Planner only maps safe actions ─────────────────
test("planner only maps borrower-safe actions", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/mapCanonicalActionToBorrowerPlan.ts"),
    "utf8",
  );
  // These should NOT be borrower-orchestratable
  assert.ok(!content.includes('"review_credit_memo"'), "review_credit_memo must not be borrower-mapped");
  assert.ok(!content.includes('"record_committee_decision"'), "record_committee_decision must not be borrower-mapped");
  assert.ok(!content.includes('"start_closing"'), "start_closing must not be borrower-mapped in 65F");
});

// ── Guard 14: Reconciliation is safe to repeat ───────────────
test("reconciliation handles terminal statuses", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/reconcileBorrowerProgress.ts"),
    "utf8",
  );
  assert.ok(content.includes("isTerminalStatus"), "Must check terminal status to prevent re-processing");
  assert.ok(content.includes('"completed"'), "Must handle completed status");
  assert.ok(content.includes('"waived"'), "Must handle waived status");
});

// ── Guard 15: Delivery uses existing SMS/email plumbing ──────
test("delivery uses existing notification infrastructure", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/borrower-orchestration/sendBorrowerCampaign.ts"),
    "utf8",
  );
  assert.ok(content.includes("sendSmsWithConsent"), "Must use existing SMS function");
  assert.ok(content.includes("getEmailProvider"), "Must use existing email provider");
  assert.ok(content.includes("borrower_request_events"), "Must record delivery events");
});

// ── Guard 16: Reminder processor module exists ───────────────
test("reminder processor module exists and works with campaign system", () => {
  const f = "src/lib/borrower-reminders/processor.ts";
  assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  const content = fs.readFileSync(path.resolve(root, f), "utf8");
  assert.ok(content.includes("borrower_reminder_schedule"), "Must read reminder schedule");
  assert.ok(content.includes("sendBorrowerCampaign"), "Must use campaign delivery");
  assert.ok(content.includes("advanceReminderSchedule"), "Must advance cadence after send");
});
