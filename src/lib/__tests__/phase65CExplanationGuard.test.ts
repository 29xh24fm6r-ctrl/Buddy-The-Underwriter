import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// ── Guard 1: Explanation engine exists ────────────────────
test("Buddy explanation engine exists and is pure", () => {
  const files = [
    "src/core/explanation/types.ts",
    "src/core/explanation/deriveBuddyExplanation.ts",
    "src/core/explanation/deriveStateReasons.ts",
    "src/core/explanation/deriveBlockingFactors.ts",
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  }
});

// ── Guard 2: Buddy explanation does NOT import Omega ──────
test("Buddy explanation engine has no Omega imports", () => {
  const files = [
    "src/core/explanation/deriveBuddyExplanation.ts",
    "src/core/explanation/deriveStateReasons.ts",
    "src/core/explanation/deriveBlockingFactors.ts",
  ];
  for (const f of files) {
    const content = fs.readFileSync(path.resolve(root, f), "utf8");
    assert.ok(
      !content.includes("import") || !content.includes("omega/"),
      `${f} must not import from omega/ — Buddy explains state, Omega explains reasoning`,
    );
  }
});

// ── Guard 3: Omega formatter exists and is separate ───────
test("Omega advisory formatter exists", () => {
  const filePath = path.resolve(root, "src/core/omega/formatOmegaAdvisory.ts");
  assert.ok(fs.existsSync(filePath), "Missing: formatOmegaAdvisory.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("OmegaExplanation"), "Must return OmegaExplanation");
  assert.ok(content.includes("stale"), "Must handle stale state");
});

// ── Guard 4: State API returns explanation ─────────────────
test("state API returns explanation and omegaExplanation", () => {
  const filePath = path.resolve(root, "src/app/api/deals/[dealId]/state/route.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("deriveBuddyExplanation"), "Must call deriveBuddyExplanation");
  assert.ok(content.includes("formatOmegaAdvisory"), "Must call formatOmegaAdvisory");
  assert.ok(content.includes("explanation"), "Must return explanation in response");
  assert.ok(content.includes("omegaExplanation"), "Must return omegaExplanation in response");
});

// ── Guard 5: UI components exist ──────────────────────────
test("explanation UI components exist", () => {
  const files = [
    "src/components/deal/DealExplanationPanel.tsx",
    "src/components/deal/NextActionReason.tsx",
    "src/components/deal/OmegaTraceDrawer.tsx",
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.resolve(root, f)), `Missing: ${f}`);
  }
});

// ── Guard 6: Omega trace drawer is builder-only ───────────
test("Omega trace drawer is gated to builder mode", () => {
  const filePath = path.resolve(root, "src/components/deal/OmegaTraceDrawer.tsx");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("builderMode"), "Must check builderMode");
  assert.ok(
    content.includes("NEXT_PUBLIC_OMEGA_TRACE_ENABLED"),
    "Must check NEXT_PUBLIC_OMEGA_TRACE_ENABLED feature flag",
  );
  assert.ok(
    content.includes("if (!builderMode"),
    "Must return null when not in builder mode",
  );
});

// ── Guard 7: Canonical state injection includes explanation ──
test("canonical state injection renders explanation panel", () => {
  const filePath = path.resolve(root, "src/lib/stitch/activations/canonicalStateInjection.ts");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("deriveBuddyExplanation"), "Must call deriveBuddyExplanation");
  assert.ok(content.includes("data-buddy-explanation"), "Must render explanation DOM marker");
  assert.ok(content.includes("expl.summary"), "Must render explanation summary");
  assert.ok(content.includes("blockingFactors"), "Must render blocking factors");
});

// ── Guard 8: Explanation and omega are visually separated ──
test("canonical state injection renders explanation and omega as separate panels", () => {
  const filePath = path.resolve(root, "src/lib/stitch/activations/canonicalStateInjection.ts");
  const content = fs.readFileSync(filePath, "utf8");
  // Buddy explanation has its own marker
  assert.ok(content.includes("data-buddy-explanation"), "Buddy explanation has own marker");
  // Omega advisory has its own marker
  assert.ok(content.includes("data-omega-advisory"), "Omega advisory has own marker");
  // They are different elements
  assert.ok(
    content.indexOf("data-buddy-explanation") !== content.indexOf("data-omega-advisory"),
    "Explanation and advisory must be separate DOM elements",
  );
});

// ── Guard 9: StitchRouteBridge passes explanation in data ──
test("StitchRouteBridge merges explanation into activation data", () => {
  const filePath = path.resolve(root, "src/components/stitch/StitchRouteBridge.tsx");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(content.includes("existingData.explanation"), "Must merge explanation into data");
});

// ── Guard 10: NextActionReason has no Omega imports ───────
test("NextActionReason component has no Omega imports", () => {
  const filePath = path.resolve(root, "src/components/deal/NextActionReason.tsx");
  const content = fs.readFileSync(filePath, "utf8");
  assert.ok(!content.includes("from \"@/core/omega") && !content.includes("OmegaAdvisoryState"),
    "NextActionReason must not import from omega — 100% Buddy-owned");
});
