import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// ── Guard 1: Canonical state adapter exists ───────────────
test("BuddyCanonicalStateAdapter exists and exports getBuddyCanonicalState", () => {
  const filePath = path.resolve(root, "src/core/state/BuddyCanonicalStateAdapter.ts");
  assert.ok(fs.existsSync(filePath), "Missing: src/core/state/BuddyCanonicalStateAdapter.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("getBuddyCanonicalState"), "Must export getBuddyCanonicalState");
  assert.ok(content.includes("deriveLifecycleState"), "Must use existing deriveLifecycleState");
  assert.ok(content.includes("getNextAction"), "Must use existing getNextAction");
});

// ── Guard 2: State adapter does NOT contain new business logic ──
test("state adapter only extracts/normalizes — no new business logic", () => {
  const filePath = path.resolve(root, "src/core/state/BuddyCanonicalStateAdapter.ts");
  const content = fs.readFileSync(filePath, "utf8");
  // Should NOT contain stage transition logic
  assert.ok(!content.includes("ALLOWED_STAGE_TRANSITIONS"), "Must not import stage transition logic");
  // Should NOT contain blocker computation
  assert.ok(!content.includes("computeBlockers"), "Must not import computeBlockers — lifecycle handles this");
});

// ── Guard 3: Omega adapter exists and is read-only ────────
test("OmegaAdvisoryAdapter exists and is read-only", () => {
  const filePath = path.resolve(root, "src/core/omega/OmegaAdvisoryAdapter.ts");
  assert.ok(fs.existsSync(filePath), "Missing: src/core/omega/OmegaAdvisoryAdapter.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("getOmegaAdvisoryState"), "Must export getOmegaAdvisoryState");
  // Must NOT mutate deal state
  assert.ok(!content.includes("supabaseAdmin"), "Omega adapter must NOT write to database");
  assert.ok(!content.includes(".update("), "Omega adapter must NOT update records");
  assert.ok(!content.includes(".insert("), "Omega adapter must NOT insert records");
});

// ── Guard 4: Omega adapter handles stale state ────────────
test("Omega adapter returns stale flag when unavailable", () => {
  const filePath = path.resolve(root, "src/core/omega/OmegaAdvisoryAdapter.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("stale: true"), "Must set stale=true when Omega unavailable");
  assert.ok(content.includes("OMEGA_MCP_ENABLED"), "Must check OMEGA_MCP_ENABLED");
  assert.ok(content.includes("OMEGA_MCP_KILL_SWITCH"), "Must check kill switch");
});

// ── Guard 5: State API route exists ───────────────────────
test("state API route exists at /api/deals/[dealId]/state", () => {
  const filePath = path.resolve(root, "src/app/api/deals/[dealId]/state/route.ts");
  assert.ok(fs.existsSync(filePath), "Missing: /api/deals/[dealId]/state/route.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("getBuddyCanonicalState"), "Must call getBuddyCanonicalState");
  assert.ok(content.includes("getOmegaAdvisoryState"), "Must call getOmegaAdvisoryState");
  assert.ok(content.includes("Promise.all"), "Must fetch state and omega in parallel");
});

// ── Guard 6: Type contracts are locked ────────────────────
test("canonical state type contract is locked", () => {
  const filePath = path.resolve(root, "src/core/state/types.ts");
  assert.ok(fs.existsSync(filePath), "Missing: src/core/state/types.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("BuddyCanonicalState"), "Must define BuddyCanonicalState");
  assert.ok(content.includes("SystemAction"), "Must define SystemAction");
  assert.ok(content.includes("PricingState"), "Must define PricingState");
  assert.ok(content.includes("CommitteeState"), "Must define CommitteeState");
  assert.ok(content.includes("ExceptionSummary"), "Must define ExceptionSummary");
  assert.ok(content.includes("ChecklistReadiness"), "Must define ChecklistReadiness");
});

test("omega advisory type contract is locked", () => {
  const filePath = path.resolve(root, "src/core/omega/types.ts");
  assert.ok(fs.existsSync(filePath), "Missing: src/core/omega/types.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("OmegaAdvisoryState"), "Must define OmegaAdvisoryState");
  assert.ok(content.includes("confidence"), "Must include confidence field");
  assert.ok(content.includes("stale"), "Must include stale field");
  assert.ok(content.includes("advisory"), "Must include advisory field");
});

// ── Guard 7: UI components exist ──────────────────────────
test("UI components for state and omega exist", () => {
  const files = [
    "src/components/deal/DealStateHeader.tsx",
    "src/components/deal/OmegaConfidenceBadge.tsx",
    "src/components/deal/OmegaAdvisoryPanel.tsx",
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  }
});

// ── Guard 8: OmegaConfidenceBadge degrades when stale ─────
test("OmegaConfidenceBadge shows stale state visually", () => {
  const filePath = path.resolve(root, "src/components/deal/OmegaConfidenceBadge.tsx");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("omega.stale"), "Must check stale flag");
  assert.ok(content.includes("Advisory outdated") || content.includes("may be outdated"),
    "Must show stale label");
});

// ── Guard 9: Next action is Buddy-owned, not Omega ────────
test("next required action derivation has no Omega dependency", () => {
  const adapterContent = fs.readFileSync(
    path.resolve(root, "src/core/state/BuddyCanonicalStateAdapter.ts"), "utf8"
  );
  // nextRequiredAction must come from getNextAction, not Omega
  assert.ok(adapterContent.includes("getNextAction"), "nextRequiredAction must use getNextAction");
  assert.ok(!adapterContent.includes("omega") && !adapterContent.includes("Omega"),
    "State adapter must not reference Omega for action derivation");
});

// ── Guard 10: State API validates auth and tenant ─────────
test("state API validates authentication and tenant access", () => {
  const content = fs.readFileSync(
    path.resolve(root, "src/app/api/deals/[dealId]/state/route.ts"), "utf8"
  );
  assert.ok(content.includes("clerkAuth"), "Must validate auth");
  assert.ok(content.includes("ensureDealBankAccess"), "Must validate tenant access");
});
