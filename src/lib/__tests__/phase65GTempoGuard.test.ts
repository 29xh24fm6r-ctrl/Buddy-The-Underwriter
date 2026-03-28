import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// ── Guard 1: SLA/tempo modules exist ─────────────────────────
test("SLA and tempo modules exist", () => {
  const files = [
    "src/core/sla/types.ts",
    "src/core/sla/slaPolicy.ts",
    "src/core/sla/deriveDealAgingSnapshot.ts",
    "src/core/sla/deriveDealUrgency.ts",
    "src/core/sla/detectDealStuckness.ts",
    "src/core/sla/deriveEscalationCandidates.ts",
    "src/core/sla/persistEscalationCandidates.ts",
    "src/core/sla/writeSlaSnapshot.ts",
    "src/lib/tempo/getStageStartedAt.ts",
    "src/lib/tempo/getPrimaryActionStartedAt.ts",
    "src/lib/tempo/getBorrowerCampaignAging.ts",
    "src/lib/tempo/getReviewQueueAging.ts",
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  }
});

// ── Guard 2: Auto-advance modules exist ──────────────────────
test("auto-advance modules exist", () => {
  const files = [
    "src/core/auto-advance/types.ts",
    "src/core/auto-advance/autoAdvancePolicy.ts",
    "src/core/auto-advance/evaluateAutoAdvance.ts",
    "src/core/auto-advance/executeAutoAdvance.ts",
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  }
});

// ── Guard 3: Migration exists ────────────────────────────────
test("SLA/tempo/auto-advance migration exists", () => {
  const f = "supabase/migrations/20260328_sla_tempo_auto_advance.sql";
  assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  const content = fs.readFileSync(path.resolve(root, f), "utf8");
  assert.ok(content.includes("deal_sla_snapshots"), "Must create deal_sla_snapshots table");
  assert.ok(content.includes("deal_escalation_events"), "Must create deal_escalation_events table");
  assert.ok(content.includes("deal_auto_advance_events"), "Must create deal_auto_advance_events table");
  assert.ok(content.includes("deal_primary_action_history"), "Must create deal_primary_action_history table");
});

// ── Guard 4: Tempo processor exists ──────────────────────────
test("tempo processor route exists", () => {
  const f = "src/app/api/admin/tempo/process/route.ts";
  assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  const content = fs.readFileSync(path.resolve(root, f), "utf8");
  assert.ok(content.includes("CRON_SECRET"), "Must auth via CRON_SECRET");
  assert.ok(content.includes("deriveDealAgingSnapshot"), "Must derive aging snapshot");
  assert.ok(content.includes("persistEscalationCandidates"), "Must persist escalations");
  assert.ok(content.includes("writeSlaSnapshot"), "Must write SLA snapshot");
});

// ── Guard 5: Auto-advance processor exists ───────────────────
test("auto-advance processor route exists", () => {
  const f = "src/app/api/admin/auto-advance/process/route.ts";
  assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  const content = fs.readFileSync(path.resolve(root, f), "utf8");
  assert.ok(content.includes("CRON_SECRET"), "Must auth via CRON_SECRET");
  assert.ok(content.includes("evaluateAutoAdvance"), "Must evaluate auto-advance");
  assert.ok(content.includes("executeAutoAdvance"), "Must execute auto-advance");
});

// ── Guard 6: Deal tempo API exists ───────────────────────────
test("deal tempo API route exists", () => {
  const f = "src/app/api/deals/[dealId]/tempo/route.ts";
  assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  const content = fs.readFileSync(path.resolve(root, f), "utf8");
  assert.ok(content.includes("ensureDealBankAccess"), "Must authenticate");
  assert.ok(content.includes("deriveDealAgingSnapshot"), "Must derive aging snapshot");
  assert.ok(content.includes("evaluateAutoAdvance"), "Must evaluate auto-advance");
});

// ── Guard 7: No Omega imports ────────────────────────────────
test("no Omega imports in SLA/auto-advance layers", () => {
  const files = [
    "src/core/sla/types.ts",
    "src/core/sla/slaPolicy.ts",
    "src/core/sla/deriveDealAgingSnapshot.ts",
    "src/core/sla/deriveDealUrgency.ts",
    "src/core/sla/detectDealStuckness.ts",
    "src/core/sla/deriveEscalationCandidates.ts",
    "src/core/auto-advance/autoAdvancePolicy.ts",
    "src/core/auto-advance/evaluateAutoAdvance.ts",
    "src/core/auto-advance/executeAutoAdvance.ts",
    "src/app/api/deals/[dealId]/tempo/route.ts",
    "src/app/api/admin/tempo/process/route.ts",
    "src/app/api/admin/auto-advance/process/route.ts",
  ];
  for (const f of files) {
    const content = fs.readFileSync(path.resolve(root, f), "utf8");
    assert.ok(!content.includes("@/core/omega"), `${f} must not import Omega`);
  }
});

// ── Guard 8: UI components exist ─────────────────────────────
test("cockpit UI components exist", () => {
  const files = [
    "src/components/deals/DealTempoBadge.tsx",
    "src/components/deals/DealUrgencyBanner.tsx",
    "src/components/deals/DealSlaPanel.tsx",
    "src/components/deals/DealEscalationTimeline.tsx",
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  }
});

// ── Guard 9: UI consumes /tempo API ──────────────────────────
test("UI components fetch from /tempo API", () => {
  const slaPanelContent = fs.readFileSync(
    path.resolve(root, "src/components/deals/DealSlaPanel.tsx"),
    "utf8",
  );
  assert.ok(slaPanelContent.includes("/api/deals/"), "SlaPanel must fetch from API");
  assert.ok(slaPanelContent.includes("/tempo"), "SlaPanel must use tempo endpoint");

  const timelineContent = fs.readFileSync(
    path.resolve(root, "src/components/deals/DealEscalationTimeline.tsx"),
    "utf8",
  );
  assert.ok(timelineContent.includes("/tempo"), "EscalationTimeline must use tempo endpoint");
});

// ── Guard 10: SLA policy uses real canonical stages ──────────
test("SLA policy covers real canonical stages", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/sla/slaPolicy.ts"),
    "utf8",
  );
  const stages = [
    "intake_created", "docs_requested", "docs_in_progress",
    "docs_satisfied", "underwrite_ready", "underwrite_in_progress",
    "committee_ready", "committee_decisioned", "closing_in_progress",
    "closed", "workout",
  ];
  for (const stage of stages) {
    assert.ok(content.includes(stage), `SLA policy missing stage: ${stage}`);
  }
});

// ── Guard 11: Auto-advance policy uses real stages ───────────
test("auto-advance policy uses real canonical stages", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/auto-advance/autoAdvancePolicy.ts"),
    "utf8",
  );
  assert.ok(content.includes("docs_in_progress"), "Must have docs_in_progress rule");
  assert.ok(content.includes("docs_satisfied"), "Must have docs_satisfied rule");
  assert.ok(content.includes("underwrite_ready"), "Must have underwrite_ready rule");
  assert.ok(content.includes("committee_decisioned"), "Must have committee_decisioned rule");
});

// ── Guard 12: Stuckness detector exports all reason codes ────
test("stuckness detector covers all stuck reason codes", () => {
  const typesContent = fs.readFileSync(
    path.resolve(root, "src/core/sla/types.ts"),
    "utf8",
  );
  const detectorContent = fs.readFileSync(
    path.resolve(root, "src/core/sla/detectDealStuckness.ts"),
    "utf8",
  );
  const reasonBlock = typesContent.match(/export type StuckReasonCode\s*=([\s\S]*?);/)?.[1] ?? "";
  const reasons = (reasonBlock.match(/"\w+"/g) ?? []).map(m => m.replace(/"/g, ""));

  for (const reason of reasons) {
    assert.ok(
      detectorContent.includes(`"${reason}"`),
      `Stuckness detector missing reason: ${reason}`,
    );
  }
});

// ── Guard 13: Escalation persistence is stable ───────────────
test("escalation persistence deduplicates and resolves", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/core/sla/persistEscalationCandidates.ts"),
    "utf8",
  );
  assert.ok(content.includes("last_triggered_at"), "Must update last_triggered_at for existing");
  assert.ok(content.includes("resolved_at"), "Must resolve cleared escalations");
  assert.ok(content.includes("is_active"), "Must check active state");
});
