import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// P0 activation files that should NOT compute lifecycle/stage/next-step locally
const P0_ACTIVATION_FILES = [
  "src/lib/stitch/activations/underwriteCommandBridgeActivation.ts",
  "src/lib/stitch/activations/creditCommitteeViewActivation.ts",
  "src/lib/stitch/activations/exceptionsChangeReviewActivation.ts",
  "src/lib/stitch/activations/borrowerTaskInboxActivation.ts",
  "src/lib/stitch/activations/pricingMemoActivation.ts",
];

// Patterns that indicate local state computation (forbidden in activation files)
const FORBIDDEN_LOCAL_STATE_PATTERNS = [
  "deriveLifecycleState",     // must use canonical state adapter
  "computeBlockers",          // must use canonical state adapter
  "computeDealReadiness",     // must use canonical state adapter
  "advanceDealLifecycle",     // must never advance from activation
];

// ── Guard 1: No P0 activation file computes lifecycle locally ──
test("no P0 activation file imports lifecycle derivation directly", () => {
  const violations: string[] = [];
  for (const file of P0_ACTIVATION_FILES) {
    const filePath = path.resolve(root, file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf8");
    for (const pattern of FORBIDDEN_LOCAL_STATE_PATTERNS) {
      if (content.includes(pattern)) {
        violations.push(`${file}: contains forbidden pattern "${pattern}"`);
      }
    }
  }
  assert.equal(violations.length, 0, `Local state computation found:\n${violations.join("\n")}`);
});

// ── Guard 2: StitchRouteBridge injects canonical state for P0 slugs ──
test("StitchRouteBridge injects canonical state for all P0 slugs", () => {
  const bridgePath = path.resolve(root, "src/components/stitch/StitchRouteBridge.tsx");
  const content = fs.readFileSync(bridgePath, "utf8");

  assert.ok(content.includes("fetchCanonicalStatePayload"), "Must import fetchCanonicalStatePayload");
  assert.ok(content.includes("buildCanonicalStateRenderScript"), "Must import buildCanonicalStateRenderScript");
  assert.ok(content.includes("canonicalState"), "Must merge canonicalState into activation data");
  assert.ok(content.includes("omega"), "Must merge omega into activation data");

  // Verify all P0 slugs are in the set
  const p0Slugs = [
    "deals-command-bridge",
    "credit-committee-view",
    "exceptions-change-review",
    "borrower-task-inbox",
    "pricing-memo-command-center",
  ];
  for (const slug of p0Slugs) {
    assert.ok(
      content.includes(`"${slug}"`),
      `P0 slug "${slug}" not found in StitchRouteBridge`,
    );
  }
});

// ── Guard 3: Canonical state injection module exists ──────────
test("canonical state injection module exists and exports correctly", () => {
  const filePath = path.resolve(root, "src/lib/stitch/activations/canonicalStateInjection.ts");
  assert.ok(fs.existsSync(filePath), "Missing: canonicalStateInjection.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("fetchCanonicalStatePayload"), "Must export fetchCanonicalStatePayload");
  assert.ok(content.includes("buildCanonicalStateRenderScript"), "Must export buildCanonicalStateRenderScript");
  assert.ok(content.includes("getBuddyCanonicalState"), "Must use canonical state adapter");
  assert.ok(content.includes("getOmegaAdvisoryState"), "Must use omega adapter");
});

// ── Guard 4: Canonical state render script handles stale Omega ──
test("canonical state render script shows stale degradation", () => {
  const filePath = path.resolve(root, "src/lib/stitch/activations/canonicalStateInjection.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("omega.stale"), "Must check omega.stale flag");
  assert.ok(
    content.includes("Advisory outdated") || content.includes("may be outdated"),
    "Must show stale label when omega is stale",
  );
});

// ── Guard 5: Canonical state render script shows blockers ─────
test("canonical state render script shows blocker count", () => {
  const filePath = path.resolve(root, "src/lib/stitch/activations/canonicalStateInjection.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("blockers"), "Must render blocker information");
  assert.ok(content.includes("nextRequiredAction"), "Must render next required action");
});

// ── Guard 6: No activation file uses getNextAction directly ───
test("no activation file calls getNextAction directly", () => {
  const violations: string[] = [];
  for (const file of P0_ACTIVATION_FILES) {
    const filePath = path.resolve(root, file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf8");
    if (content.includes("getNextAction")) {
      violations.push(`${file}: calls getNextAction directly — should use canonical state`);
    }
  }
  assert.equal(violations.length, 0, `Direct getNextAction calls:\n${violations.join("\n")}`);
});

// ── Guard 7: Omega never mutates state in injection script ────
test("canonical state injection script never mutates deal state", () => {
  const filePath = path.resolve(root, "src/lib/stitch/activations/canonicalStateInjection.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(!content.includes(".update("), "Must not update records");
  assert.ok(!content.includes(".insert("), "Must not insert records");
  assert.ok(!content.includes("advanceDealLifecycle"), "Must not advance lifecycle");
});

// ── Guard 8: State bar has data-canonical-state marker ────────
test("canonical state bar has machine-verifiable marker", () => {
  const filePath = path.resolve(root, "src/lib/stitch/activations/canonicalStateInjection.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(
    content.includes('data-canonical-state'),
    "State bar must have data-canonical-state attribute",
  );
});
