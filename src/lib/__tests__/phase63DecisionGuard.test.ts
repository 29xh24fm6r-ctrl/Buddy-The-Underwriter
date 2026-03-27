import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SURFACE_WIRING_LEDGER } from "@/stitch/surface_wiring_ledger";

const root = process.cwd();

// ── Guard 1: P0 interactive surfaces are wired_interactive ──
test("P0 decision surfaces are wired_interactive", () => {
  const p0Interactive = [
    "credit_committee_view",
    "exceptions_change_review",
    "pricing_memo_command_center",
    "borrower_task_inbox",
  ];
  const notInteractive = SURFACE_WIRING_LEDGER.filter(
    (e) => p0Interactive.includes(e.key) && e.status !== "wired_interactive",
  );
  assert.equal(
    notInteractive.length,
    0,
    `P0 surfaces not wired_interactive: ${notInteractive.map((e) => `${e.key}=${e.status}`).join(", ")}`,
  );
});

// ── Guard 2: Interactive surfaces declare write actions ──────
test("wired_interactive surfaces declare at least one write action", () => {
  const interactive = SURFACE_WIRING_LEDGER.filter((e) => e.status === "wired_interactive");
  const noWrites = interactive.filter((e) => e.writeActionsExpected.length === 0);
  assert.equal(
    noWrites.length,
    0,
    `Interactive surfaces with no declared write actions: ${noWrites.map((e) => e.key).join(", ")}`,
  );
});

// ── Guard 3: Exception decision API route exists ─────────────
test("exception decision API route exists", () => {
  const routePath = path.resolve(root, "src/app/api/exceptions/decide/route.ts");
  assert.ok(fs.existsSync(routePath), "Missing: src/app/api/exceptions/decide/route.ts");
  const content = fs.readFileSync(routePath, "utf8");
  assert.ok(content.includes("changeExceptionStatus"), "Route must call changeExceptionStatus");
  assert.ok(content.includes("writeEvent"), "Route must write ledger event");
});

// ── Guard 4: Decision types module exists ─────────────────────
test("canonical decision types module exists", () => {
  const typesPath = path.resolve(root, "src/core/decisions/types.ts");
  assert.ok(fs.existsSync(typesPath), "Missing: src/core/decisions/types.ts");
  const content = fs.readFileSync(typesPath, "utf8");
  assert.ok(content.includes("DecisionActor"), "Must export DecisionActor");
  assert.ok(content.includes("DecisionResult"), "Must export DecisionResult");
  assert.ok(content.includes("CommitteeAction"), "Must export CommitteeAction");
  assert.ok(content.includes("ExceptionAction"), "Must export ExceptionAction");
  assert.ok(content.includes("PricingAction"), "Must export PricingAction");
  assert.ok(content.includes("ChecklistAction"), "Must export ChecklistAction");
});

// ── Guard 5: Activation scripts include action wiring ────────
test("P0 activation scripts include action button injection", () => {
  const actionSurfaces = [
    { key: "exceptions_change_review", file: "src/lib/stitch/activations/exceptionsChangeReviewActivation.ts", pattern: "/api/exceptions/decide" },
    { key: "pricing_memo_command_center", file: "src/lib/stitch/activations/pricingMemoActivation.ts", pattern: "/api/deals/" },
    { key: "borrower_task_inbox", file: "src/lib/stitch/activations/borrowerTaskInboxActivation.ts", pattern: "/checklist/set-status" },
    { key: "credit_committee_view", file: "src/lib/stitch/activations/creditCommitteeViewActivation.ts", pattern: "Review" },
  ];

  const missing: string[] = [];
  for (const s of actionSurfaces) {
    const filePath = path.resolve(root, s.file);
    if (!fs.existsSync(filePath)) {
      missing.push(`${s.key}: file missing`);
      continue;
    }
    const content = fs.readFileSync(filePath, "utf8");
    if (!content.includes(s.pattern)) {
      missing.push(`${s.key}: missing action pattern "${s.pattern}"`);
    }
  }

  assert.equal(missing.length, 0, `Missing action wiring:\n${missing.join("\n")}`);
});

// ── Guard 6: Exception API uses ledger event taxonomy ────────
test("exception decision API emits correct ledger event keys", () => {
  const routePath = path.resolve(root, "src/app/api/exceptions/decide/route.ts");
  const content = fs.readFileSync(routePath, "utf8");
  assert.ok(content.includes("exception.decision."), "Must emit exception.decision.* event keys");
});

// ── Guard 7: No surface marked interactive without activation script ──
test("no surface is wired_interactive without hasActivationScript", () => {
  const violations = SURFACE_WIRING_LEDGER.filter(
    (e) => e.status === "wired_interactive" && !e.hasActivationScript,
  );
  assert.equal(
    violations.length,
    0,
    `Interactive surfaces without activation: ${violations.map((e) => e.key).join(", ")}`,
  );
});

// ── Guard 8: Activation scripts disable buttons during submission ──
test("action activation scripts implement button disable pattern", () => {
  const actionFiles = [
    "src/lib/stitch/activations/exceptionsChangeReviewActivation.ts",
    "src/lib/stitch/activations/pricingMemoActivation.ts",
    "src/lib/stitch/activations/borrowerTaskInboxActivation.ts",
  ];

  const missing: string[] = [];
  for (const file of actionFiles) {
    const filePath = path.resolve(root, file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf8");
    if (!content.includes(".disabled = true")) {
      missing.push(file);
    }
  }

  assert.equal(missing.length, 0, `Scripts missing button disable pattern: ${missing.join(", ")}`);
});
