import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SURFACE_WIRING_LEDGER } from "@/stitch/surface_wiring_ledger";
import { getAllMappedActionKeys, getAffectedSurfaces } from "@/core/reflection/affectedSurfaces";

const root = process.cwd();

// ── Guard 1: Every P0 interactive action declares affected surfaces ──
test("every P0 interactive action has affected surface mappings", () => {
  const requiredActionKeys = [
    "committee.decision.approved",
    "committee.decision.declined",
    "exception.decision.approve",
    "exception.decision.reject",
    "exception.decision.escalate",
    "pricing.decision.made",
    "checklist.status.set",
  ];
  const missing: string[] = [];
  for (const key of requiredActionKeys) {
    const surfaces = getAffectedSurfaces(key);
    if (surfaces.length === 0) {
      missing.push(key);
    }
  }
  assert.equal(missing.length, 0, `Actions without affected surfaces: ${missing.join(", ")}`);
});

// ── Guard 2: Command bridge is affected by all P0 action types ──
test("command bridge is affected by committee, exception, pricing, and checklist actions", () => {
  const actionPrefixes = ["committee.decision", "exception.decision", "pricing.", "checklist."];
  const allKeys = getAllMappedActionKeys();

  for (const prefix of actionPrefixes) {
    const matching = allKeys.filter((k) => k.startsWith(prefix));
    const affectsCommandBridge = matching.some((k) =>
      getAffectedSurfaces(k).includes("deals_command_bridge"),
    );
    assert.ok(
      affectsCommandBridge,
      `No ${prefix}* action declares deals_command_bridge as affected`,
    );
  }
});

// ── Guard 3: P0 interactive surfaces have history panels declared ──
test("P0 interactive surfaces declare history panel support", () => {
  const p0Interactive = [
    "credit_committee_view",
    "exceptions_change_review",
    "pricing_memo_command_center",
    "borrower_task_inbox",
    "deals_command_bridge",
    "borrower_portal",
  ];
  const noHistory = SURFACE_WIRING_LEDGER.filter(
    (e) => p0Interactive.includes(e.key) && !e.hasHistoryPanel,
  );
  assert.equal(
    noHistory.length,
    0,
    `Interactive surfaces without history panel: ${noHistory.map((e) => e.key).join(", ")}`,
  );
});

// ── Guard 4: Routed vs direct classification is explicit ──────
test("every interactive surface has explicit interactiveType", () => {
  const interactive = SURFACE_WIRING_LEDGER.filter(
    (e) => e.status === "wired_interactive",
  );
  const misclassified = interactive.filter(
    (e) => e.interactiveType !== "direct" && e.interactiveType !== "routed",
  );
  assert.equal(
    misclassified.length,
    0,
    `Interactive surfaces without direct/routed classification: ${misclassified.map((e) => e.key).join(", ")}`,
  );
});

// ── Guard 5: Reflection map module exists ─────────────────────
test("reflection infrastructure modules exist", () => {
  const files = [
    "src/core/reflection/types.ts",
    "src/core/reflection/affectedSurfaces.ts",
    "src/core/reflection/buildActionReceipt.ts",
    "src/core/reflection/invalidateAfterAction.ts",
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  }
});

// ── Guard 6: Action receipt builder returns valid receipts ────
test("action receipt builder includes affected surfaces", () => {
  const receiptPath = path.resolve(root, "src/core/reflection/buildActionReceipt.ts");
  const content = fs.readFileSync(receiptPath, "utf8");
  assert.ok(content.includes("getAffectedSurfaces"), "Must use getAffectedSurfaces");
  assert.ok(content.includes("ActionReceipt"), "Must return ActionReceipt type");
});

// ── Guard 7: Deal activity API route exists ───────────────────
test("deal activity API route exists", () => {
  const routePath = path.resolve(root, "src/app/api/deals/[dealId]/activity/route.ts");
  assert.ok(fs.existsSync(routePath), "Missing: /api/deals/[dealId]/activity/route.ts");
  const content = fs.readFileSync(routePath, "utf8");
  assert.ok(content.includes("deal_events"), "Activity API must read from deal_events");
  assert.ok(content.includes("timeline"), "Activity API must return timeline");
});

// ── Guard 8: Interactive surfaces have reflection maps ────────
test("interactive surfaces declare hasReflectionMap: true", () => {
  const interactive = SURFACE_WIRING_LEDGER.filter(
    (e) => e.status === "wired_interactive" || e.status === "wired_readonly",
  );
  const noReflection = interactive.filter((e) => !e.hasReflectionMap);
  assert.equal(
    noReflection.length,
    0,
    `Wired surfaces without reflection map: ${noReflection.map((e) => e.key).join(", ")}`,
  );
});

// ── Guard 9: Committee history is fetched in activation ───────
test("committee activation fetches history from deal_events", () => {
  const filePath = path.resolve(root, "src/lib/stitch/activations/creditCommitteeViewActivation.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("deal_events"), "Committee activation must query deal_events for history");
  assert.ok(content.includes("history"), "Committee activation must return history array");
});

// ── Guard 10: Exception activation fetches history ────────────
test("exception activation fetches history from deal_events", () => {
  const filePath = path.resolve(root, "src/lib/stitch/activations/exceptionsChangeReviewActivation.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("deal_events"), "Exception activation must query deal_events for history");
  assert.ok(content.includes("history"), "Exception activation must return history array");
});
